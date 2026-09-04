import assert from "node:assert/strict";
import { test } from "node:test";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository } from "../src/auth.js";
import { MemoryBookingRepository } from "../src/bookings.js";
import { demoVenues, roomIds, venueIds } from "../src/catalog.js";
import {
  MemoryPhotoStorage,
  PhotoUploadError,
  S3PhotoStorage,
  photoStorageFromEnv,
  processPhoto,
  type S3CommandSender,
} from "../src/media.js";
import { MemoryPartnerCatalogRepository } from "../src/partnerCatalog.js";

function multipartPhoto(file: Buffer, filename: string, contentType: string) {
  const boundary = `rooms-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

test("photo processing preserves the gallery orientation and creates both catalog crops", async () => {
  const source = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: { r: 194, g: 92, b: 71 } },
  }).jpeg({ quality: 90 }).toBuffer();
  const processed = await processPhoto(source);
  const [original, landscape, portrait] = await Promise.all([
    sharp(processed.original).metadata(),
    sharp(processed.landscape).metadata(),
    sharp(processed.portrait).metadata(),
  ]);

  assert.deepEqual([processed.width, processed.height], [900, 1600]);
  assert.deepEqual([original.width, original.height], [900, 1600]);
  assert.deepEqual([landscape.width, landscape.height], [1600, 1000]);
  assert.deepEqual([portrait.width, portrait.height], [1080, 1350]);
  assert.equal(original.format, "webp");
});

test("photo processing rejects files that only pretend to be images", async () => {
  await assert.rejects(
    () => processPhoto(Buffer.from("not an image")),
    (error: unknown) => error instanceof PhotoUploadError && error.code === "PHOTO_INVALID",
  );
});

function memoryS3Sender(objects: Map<string, Buffer>): S3CommandSender {
  return async (command) => {
    if (command instanceof PutObjectCommand) {
      assert.ok(command.input.Key);
      objects.set(command.input.Key, Buffer.from(command.input.Body as Uint8Array));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      assert.ok(command.input.Key);
      const object = objects.get(command.input.Key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => Uint8Array.from(object) } };
    }
    assert.ok(command instanceof DeleteObjectsCommand);
    for (const object of command.input.Delete?.Objects ?? []) {
      if (object.Key) objects.delete(object.Key);
    }
    return {};
  };
}

test("S3 photo storage keeps the bucket private behind stable media URLs", async () => {
  const objects = new Map<string, Buffer>();
  const storage = new S3PhotoStorage({ bucket: "rooms-test", prefix: "/production/photos/" }, memoryS3Sender(objects));
  const stored = await storage.save({
    original: Buffer.from("original"),
    landscape: Buffer.from("landscape"),
    portrait: Buffer.from("portrait"),
    width: 1200,
    height: 800,
    mimeType: "image/webp",
  });

  assert.equal(storage.storage, "s3");
  assert.equal(objects.size, 3);
  assert.equal(stored.originalUrl, `/media/${stored.storageKey}/original.webp`);
  assert.ok(objects.has(`production/photos/${stored.storageKey}/portrait.webp`));
  assert.deepEqual(await storage.read(stored.storageKey, "landscape"), Buffer.from("landscape"));
  assert.equal(await storage.read("not-a-storage-key", "original"), null);

  await storage.remove(stored.storageKey);
  assert.equal(objects.size, 0);
  assert.equal(await storage.read(stored.storageKey, "original"), null);
});

test("S3 photo storage removes partial variants after a failed upload", async () => {
  const objects = new Map<string, Buffer>();
  const baseSender = memoryS3Sender(objects);
  let cleanupRequests = 0;
  const sender: S3CommandSender = async (command) => {
    if (command instanceof PutObjectCommand && command.input.Key?.endsWith("/landscape.webp")) {
      throw new Error("simulated S3 failure");
    }
    if (command instanceof DeleteObjectsCommand) cleanupRequests += 1;
    return baseSender(command);
  };
  const storage = new S3PhotoStorage({ bucket: "rooms-test" }, sender);

  await assert.rejects(() => storage.save({
    original: Buffer.from("original"),
    landscape: Buffer.from("landscape"),
    portrait: Buffer.from("portrait"),
    width: 1200,
    height: 800,
    mimeType: "image/webp",
  }), /simulated S3 failure/u);
  assert.equal(cleanupRequests, 1);
  assert.equal(objects.size, 0);
});

test("photo storage configuration fails closed in production", () => {
  assert.equal(photoStorageFromEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv).storage, "local");
  assert.throws(
    () => photoStorageFromEnv({ NODE_ENV: "production", PHOTO_STORAGE_MODE: "local" } as NodeJS.ProcessEnv),
    /not allowed in production/u,
  );
  assert.throws(
    () => photoStorageFromEnv({ NODE_ENV: "production", PHOTO_STORAGE_MODE: "s3" } as NodeJS.ProcessEnv),
    /S3_BUCKET is required/u,
  );
  assert.throws(
    () => photoStorageFromEnv({
      NODE_ENV: "production",
      PHOTO_STORAGE_MODE: "s3",
      S3_BUCKET: "rooms",
      S3_REGION: "ru-central1",
      S3_ENDPOINT: "http://storage.internal",
    } as NodeJS.ProcessEnv),
    /must use HTTPS/u,
  );
});

test("partner uploads a room photo into moderation and the generated file is served", async () => {
  const partnerId = "50000000-0000-4000-8000-000000000031";
  const adminId = "50000000-0000-4000-8000-000000000032";
  const password = "rooms2026";
  const authRepository = new MemoryAuthRepository([
    {
      id: partnerId,
      role: "partner",
      name: "Менеджер Kids Loft",
      email: "photo-manager@kids-loft.test",
      phone: null,
      city: "Воронеж",
      passwordHash: await hashPassword(password),
      passwordResetRequired: false,
      blockedAt: null,
    },
    {
      id: adminId,
      role: "admin",
      name: "Администратор Rooms",
      email: "photo-admin@rooms.test",
      phone: null,
      city: "Воронеж",
      passwordHash: await hashPassword(password),
      passwordResetRequired: false,
      blockedAt: null,
    },
  ]);
  const venue = demoVenues.find((item) => item.id === venueIds.kidsLoft)!;
  const bookingRepository = new MemoryBookingRepository({ partners: [{ userId: partnerId, venue }] });
  const app = buildApp({
    logger: false,
    authRepository,
    bookingRepository,
    partnerCatalogRepository: new MemoryPartnerCatalogRepository(),
    photoStorage: new MemoryPhotoStorage(),
  });
  await app.ready();
  try {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `/v1/partner/rooms/${roomIds.kosmos}/photos`,
      ...multipartPhoto(Buffer.from("x"), "room.jpg", "image/jpeg"),
    });
    assert.equal(unauthenticated.statusCode, 401);

    const partnerLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "photo-manager@kids-loft.test", password },
    });
    const partnerHeaders = { authorization: `Bearer ${partnerLogin.json().accessToken}` };
    const source = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 225, g: 214, b: 205 } },
    }).png().toBuffer();
    const form = multipartPhoto(source, "зал.png", "image/png");
    const upload = await app.inject({
      method: "POST",
      url: `/v1/partner/rooms/${roomIds.kosmos}/photos`,
      headers: { ...form.headers, ...partnerHeaders },
      payload: form.payload,
    });
    assert.equal(upload.statusCode, 202);
    assert.equal(upload.json().status, "review");
    assert.match(upload.json().originalUrl, /^\/media\/[0-9a-f-]+\/original\.webp$/u);

    const generated = await app.inject({ method: "GET", url: upload.json().landscapeUrl });
    assert.equal(generated.statusCode, 200);
    assert.match(generated.headers["content-type"] ?? "", /image\/webp/u);
    assert.deepEqual(
      [((await sharp(generated.rawPayload).metadata()).width), ((await sharp(generated.rawPayload).metadata()).height)],
      [1600, 1000],
    );

    const rooms = await app.inject({ method: "GET", url: "/v1/partner/rooms", headers: partnerHeaders });
    const room = rooms.json().find((item: { id: string }) => item.id === roomIds.kosmos);
    assert.equal(room.photos.at(-1).status, "review");
    assert.ok(room.pendingChange.fields.includes("photos"));

    const incompleteOrder = await app.inject({
      method: "PATCH",
      url: "/v1/partner/photos/order",
      headers: partnerHeaders,
      payload: { photoIds: [upload.json().id] },
    });
    assert.equal(incompleteOrder.statusCode, 409);
    assert.equal(incompleteOrder.json().code, "PHOTO_ORDER_INVALID");

    const photoIds = [
      upload.json().id,
      ...room.photos.filter((photo: { id: string }) => photo.id !== upload.json().id).map((photo: { id: string }) => photo.id),
    ];
    const reordered = await app.inject({
      method: "PATCH",
      url: "/v1/partner/photos/order",
      headers: partnerHeaders,
      payload: { photoIds },
    });
    assert.equal(reordered.statusCode, 202);
    assert.equal(reordered.json().photos[0].id, upload.json().id);
    assert.equal(reordered.json().photos[0].isCover, true);
    const pendingOrder = await app.inject({ method: "GET", url: "/v1/partner/rooms", headers: partnerHeaders });
    const pendingRoom = pendingOrder.json().find((item: { id: string }) => item.id === roomIds.kosmos);
    assert.equal(pendingRoom.photos[0].id, upload.json().id);
    assert.equal(pendingRoom.photos[0].sortOrder, 0);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "photo-admin@rooms.test", password },
    });
    const adminHeaders = { authorization: `Bearer ${adminLogin.json().accessToken}` };
    const queue = await app.inject({ method: "GET", url: "/v1/admin/moderation?status=pending", headers: adminHeaders });
    const request = queue.json().find((item: { targetId: string }) => item.targetId === roomIds.kosmos);
    assert.ok(request);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/admin/moderation/${request.id}/approve`,
      headers: adminHeaders,
      payload: {},
    });
    assert.equal(approved.statusCode, 200);
    const after = await app.inject({ method: "GET", url: "/v1/partner/rooms", headers: partnerHeaders });
    const approvedRoom = after.json().find((item: { id: string }) => item.id === roomIds.kosmos);
    assert.equal(approvedRoom.photos[0].id, upload.json().id);
    assert.equal(approvedRoom.photos[0].status, "published");
    assert.equal(approvedRoom.photos[0].isCover, true);
  } finally {
    await app.close();
  }
});
