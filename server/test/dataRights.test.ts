import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository } from "../src/auth.js";
import { MemoryDataRightsRepository } from "../src/dataRights.js";

test("client exports personal data and a password-confirmed request moves through the admin queue", async () => {
  const adminPassword = "admin-data-rights-2026";
  const authRepository = new MemoryAuthRepository([{
    id: "70000000-0000-4000-8000-000000000001",
    role: "admin",
    name: "Data Rights Admin",
    email: "privacy.admin@rooms.test",
    phone: null,
    city: "Воронеж",
    passwordHash: await hashPassword(adminPassword),
    passwordResetRequired: false,
    blockedAt: null,
  }]);
  const dataRightsRepository = new MemoryDataRightsRepository(() => new Date("2026-09-04T10:00:00.000Z"));
  const app = buildApp({ logger: false, authRepository, dataRightsRepository });
  await app.ready();
  try {
    const clientPassword = "client-data-rights-2026";
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/client/register",
      payload: {
        name: "Ирина",
        email: "irina.data@rooms.test",
        phone: "+7 900 111-22-33",
        city: "Воронеж",
        password: clientPassword,
        legal: { termsVersion: "test-v1", privacyVersion: "test-v1", acceptedAt: "2026-09-04T09:55:00.000Z" },
      },
    });
    assert.equal(registration.statusCode, 201, registration.body);
    const clientToken = registration.json().accessToken as string;

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/me/personal-data-requests",
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { type: "erasure", message: "Закрыть кабинет", currentPassword: "wrong-password" },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().code, "CURRENT_PASSWORD_INVALID");

    const created = await app.inject({
      method: "POST",
      url: "/v1/me/personal-data-requests",
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { type: "erasure", message: "Закрыть кабинет после завершения обязательного хранения", currentPassword: clientPassword },
    });
    assert.equal(created.statusCode, 202, created.body);
    assert.equal(created.json().status, "new");
    assert.equal(created.json().dueAt, "2026-09-14T10:00:00.000Z");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/me/personal-data-requests",
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { type: "erasure", message: "Не создавать дубль", currentPassword: clientPassword },
    });
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().id, created.json().id);
    assert.match(duplicate.json().message, /обязательного хранения/u);

    const own = await app.inject({ method: "GET", url: "/v1/me/personal-data-requests", headers: { authorization: `Bearer ${clientToken}` } });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().items.length, 1);
    assert.equal(own.json().items[0].assignedTo, undefined);

    const exported = await app.inject({ method: "GET", url: "/v1/me/data-export", headers: { authorization: `Bearer ${clientToken}` } });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.headers["cache-control"], "no-store");
    assert.match(exported.headers["content-disposition"] ?? "", /rooms-personal-data-/u);
    assert.equal(exported.json().format, "rooms-personal-data-export-v1");
    assert.equal(exported.json().user.email, "irina.data@rooms.test");
    assert.equal(exported.json().requests.length, 1);
    assert.equal(exported.json().requests[0].assignedTo, undefined);
    assert.doesNotMatch(exported.body, /client-data-rights-2026|passwordHash|refreshToken/u);

    const adminLogin = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { login: "privacy.admin@rooms.test", password: adminPassword } });
    assert.equal(adminLogin.statusCode, 200);
    const adminToken = adminLogin.json().accessToken as string;
    const queue = await app.inject({ method: "GET", url: "/v1/admin/personal-data-requests?status=new", headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.json().items.length, 1);

    const decided = await app.inject({
      method: "PATCH",
      url: `/v1/admin/personal-data-requests/${created.json().id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "processing", resolution: "Проверяем обязательные сроки хранения финансовых документов." },
    });
    assert.equal(decided.statusCode, 200, decided.body);
    assert.equal(decided.json().status, "processing");
    assert.equal(decided.json().assignedTo, "70000000-0000-4000-8000-000000000001");
  } finally {
    await app.close();
  }
});
