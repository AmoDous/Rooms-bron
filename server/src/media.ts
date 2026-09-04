import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60_000_000;
const MIN_PHOTO_SIDE = 320;
const supportedFormats = new Set(["jpeg", "png", "webp"]);

export type PhotoVariant = "original" | "landscape" | "portrait";

export interface ProcessedPhoto {
  original: Buffer;
  landscape: Buffer;
  portrait: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
}

export interface StoredPhoto {
  storageKey: string;
  originalUrl: string;
  landscapeUrl: string;
  portraitUrl: string;
}

export interface PhotoStorage {
  readonly storage: "memory" | "local" | "s3";
  save(photo: ProcessedPhoto): Promise<StoredPhoto>;
  read(storageKey: string, variant: PhotoVariant): Promise<Buffer | null>;
  remove(storageKey: string): Promise<void>;
}

export class PhotoUploadError extends Error {
  readonly statusCode = 400;

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function orientedDimensions(width: number, height: number, orientation: number | undefined): [number, number] {
  return orientation && orientation >= 5 ? [height, width] : [width, height];
}

export async function processPhoto(buffer: Buffer): Promise<ProcessedPhoto> {
  if (!buffer.length) throw new PhotoUploadError("PHOTO_EMPTY", "Выберите непустой файл фотографии.");
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("PHOTO_TOO_LARGE", "Фотография должна весить не больше 12 МБ.");
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new PhotoUploadError("PHOTO_INVALID", "Файл не удалось распознать как фотографию.");
  }
  if (!metadata.format || !supportedFormats.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new PhotoUploadError("PHOTO_FORMAT_UNSUPPORTED", "Поддерживаются фотографии JPEG, PNG и WebP.");
  }
  const [width, height] = orientedDimensions(metadata.width, metadata.height, metadata.orientation);
  if (Math.min(width, height) < MIN_PHOTO_SIDE) {
    throw new PhotoUploadError("PHOTO_TOO_SMALL", "Минимальный размер фотографии: 320 пикселей по короткой стороне.");
  }

  const source = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
  const [original, landscape, portrait] = await Promise.all([
    source().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88, effort: 4 }).toBuffer(),
    source().resize(1600, 1000, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 86, effort: 4 }).toBuffer(),
    source().resize(1080, 1350, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 86, effort: 4 }).toBuffer(),
  ]);
  return { original, landscape, portrait, width, height, mimeType: "image/webp" };
}

function validStorageKey(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function variantUrl(storageKey: string, variant: PhotoVariant): string {
  return `/media/${storageKey}/${variant}.webp`;
}

export class LocalPhotoStorage implements PhotoStorage {
  readonly storage = "local" as const;

  constructor(private readonly root: string) {}

  async save(photo: ProcessedPhoto): Promise<StoredPhoto> {
    const storageKey = randomUUID();
    const directory = resolve(this.root, storageKey);
    await mkdir(directory, { recursive: true });
    try {
      await Promise.all(([
        ["original", photo.original],
        ["landscape", photo.landscape],
        ["portrait", photo.portrait],
      ] as const).map(([variant, data]) => writeFile(resolve(directory, `${variant}.webp`), data, { flag: "wx" })));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return {
      storageKey,
      originalUrl: variantUrl(storageKey, "original"),
      landscapeUrl: variantUrl(storageKey, "landscape"),
      portraitUrl: variantUrl(storageKey, "portrait"),
    };
  }

  async read(storageKey: string, variant: PhotoVariant): Promise<Buffer | null> {
    if (!validStorageKey(storageKey)) return null;
    try {
      return await readFile(resolve(this.root, storageKey, `${variant}.webp`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    if (!validStorageKey(storageKey)) return;
    await rm(resolve(this.root, storageKey), { recursive: true, force: true });
  }
}

export class MemoryPhotoStorage implements PhotoStorage {
  readonly storage = "memory" as const;
  private readonly files = new Map<string, Record<PhotoVariant, Buffer>>();

  async save(photo: ProcessedPhoto): Promise<StoredPhoto> {
    const storageKey = randomUUID();
    this.files.set(storageKey, {
      original: Buffer.from(photo.original),
      landscape: Buffer.from(photo.landscape),
      portrait: Buffer.from(photo.portrait),
    });
    return {
      storageKey,
      originalUrl: variantUrl(storageKey, "original"),
      landscapeUrl: variantUrl(storageKey, "landscape"),
      portraitUrl: variantUrl(storageKey, "portrait"),
    };
  }

  async read(storageKey: string, variant: PhotoVariant): Promise<Buffer | null> {
    const buffer = this.files.get(storageKey)?.[variant];
    return buffer ? Buffer.from(buffer) : null;
  }

  async remove(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }
}

type S3StorageCommand = PutObjectCommand | GetObjectCommand | DeleteObjectsCommand;
export type S3CommandSender = (command: S3StorageCommand) => Promise<unknown>;

export interface S3PhotoStorageOptions {
  bucket: string;
  prefix?: string | undefined;
}

const photoVariants: readonly PhotoVariant[] = ["original", "landscape", "portrait"];

function normalizePrefix(value: string | undefined): string {
  return (value?.trim() || "rooms/media").replace(/^\/+|\/+$/gu, "");
}

function isMissingS3Object(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NoSuchKey"
    || candidate.name === "NotFound"
    || candidate.$metadata?.httpStatusCode === 404;
}

export class S3PhotoStorage implements PhotoStorage {
  readonly storage = "s3" as const;
  private readonly prefix: string;

  constructor(
    private readonly options: S3PhotoStorageOptions,
    private readonly send: S3CommandSender,
  ) {
    this.prefix = normalizePrefix(options.prefix);
  }

  private objectKey(storageKey: string, variant: PhotoVariant): string {
    return `${this.prefix}/${storageKey}/${variant}.webp`;
  }

  async save(photo: ProcessedPhoto): Promise<StoredPhoto> {
    const storageKey = randomUUID();
    const data: Record<PhotoVariant, Buffer> = {
      original: photo.original,
      landscape: photo.landscape,
      portrait: photo.portrait,
    };
    const uploads = photoVariants.map((variant) => this.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: this.objectKey(storageKey, variant),
      Body: data[variant],
      ContentType: photo.mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    })));
    const results = await Promise.allSettled(uploads);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      try {
        await this.remove(storageKey);
      } catch {
        // Preserve the upload failure; orphan cleanup can be retried operationally.
      }
      throw failed.reason;
    }
    return {
      storageKey,
      originalUrl: variantUrl(storageKey, "original"),
      landscapeUrl: variantUrl(storageKey, "landscape"),
      portraitUrl: variantUrl(storageKey, "portrait"),
    };
  }

  async read(storageKey: string, variant: PhotoVariant): Promise<Buffer | null> {
    if (!validStorageKey(storageKey)) return null;
    try {
      const output = await this.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: this.objectKey(storageKey, variant),
      })) as GetObjectCommandOutput;
      if (!output.Body) return null;
      return Buffer.from(await output.Body.transformToByteArray());
    } catch (error) {
      if (isMissingS3Object(error)) return null;
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    if (!validStorageKey(storageKey)) return;
    await this.send(new DeleteObjectsCommand({
      Bucket: this.options.bucket,
      Delete: {
        Quiet: true,
        Objects: photoVariants.map((variant) => ({ Key: this.objectKey(storageKey, variant) })),
      },
    }));
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required when PHOTO_STORAGE_MODE=s3.`);
  return value;
}

function optionalBooleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${key} must be true or false.`);
}

export function photoStorageFromEnv(env: NodeJS.ProcessEnv = process.env): PhotoStorage {
  const productionMode = env.NODE_ENV === "production";
  const mode = env.PHOTO_STORAGE_MODE?.trim().toLowerCase() || (productionMode ? "s3" : "local");
  if (mode === "local") {
    if (productionMode) {
      throw new Error("PHOTO_STORAGE_MODE=local is not allowed in production; configure private S3 storage.");
    }
    return new LocalPhotoStorage(resolve(env.MEDIA_STORAGE_DIR?.trim() || "server-data/media"));
  }
  if (mode !== "s3") throw new Error("PHOTO_STORAGE_MODE must be local or s3.");

  const bucket = requiredEnv(env, "S3_BUCKET");
  const region = requiredEnv(env, "S3_REGION");
  const endpoint = env.S3_ENDPOINT?.trim();
  if (productionMode && endpoint && !endpoint.startsWith("https://")) {
    throw new Error("S3_ENDPOINT must use HTTPS in production.");
  }
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  const sessionToken = env.S3_SESSION_TOKEN?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey) || (sessionToken && !accessKeyId)) {
    throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together; session token also requires them.");
  }

  const clientConfig: S3ClientConfig = { region };
  if (endpoint) clientConfig.endpoint = endpoint;
  clientConfig.forcePathStyle = optionalBooleanEnv(env, "S3_FORCE_PATH_STYLE", false);
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = sessionToken
      ? { accessKeyId, secretAccessKey, sessionToken }
      : { accessKeyId, secretAccessKey };
  }
  const client = new S3Client(clientConfig);
  const send: S3CommandSender = (command) => {
    if (command instanceof PutObjectCommand) return client.send(command);
    if (command instanceof GetObjectCommand) return client.send(command);
    return client.send(command);
  };
  return new S3PhotoStorage({ bucket, prefix: env.S3_MEDIA_PREFIX }, send);
}
