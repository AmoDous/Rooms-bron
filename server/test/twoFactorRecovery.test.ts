import assert from "node:assert/strict";
import { test } from "node:test";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository, type AuthUser } from "../src/auth.js";
import { MemoryNotificationRepository } from "../src/notifications.js";
import { MemoryTwoFactorRepository } from "../src/twoFactor.js";

const authSecret = "rooms-two-factor-recovery-auth-secret-2026";
const encryptionKey = "rooms-two-factor-recovery-encryption-key-2026";
const password = "rooms-secure-2026";

function code(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "Rooms",
    label: "rooms-security-test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

async function users(): Promise<AuthUser[]> {
  const passwordHash = await hashPassword(password);
  return [
    {
      id: "11111111-1111-4111-8111-111111111111",
      role: "partner",
      name: "Партнёр Rooms",
      email: "partner@rooms.test",
      phone: "+79001000001",
      city: "Воронеж",
      passwordHash,
      passwordResetRequired: false,
      blockedAt: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      role: "admin",
      name: "Администратор Один",
      email: "admin-one@rooms.test",
      phone: "+79001000002",
      city: "Воронеж",
      passwordHash,
      passwordResetRequired: false,
      blockedAt: null,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      role: "admin",
      name: "Администратор Два",
      email: "admin-two@rooms.test",
      phone: "+79001000003",
      city: "Воронеж",
      passwordHash,
      passwordResetRequired: false,
      blockedAt: null,
    },
  ];
}

async function setupFactor(app: ReturnType<typeof buildApp>, login: string) {
  const started = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { login, password },
  });
  assert.equal(started.statusCode, 202);
  assert.equal(started.json().setupRequired, true);
  const completed = await app.inject({
    method: "POST",
    url: "/v1/auth/2fa/complete",
    payload: {
      challengeToken: started.json().challengeToken,
      code: code(started.json().setup.secret),
    },
  });
  assert.equal(completed.statusCode, 200);
  return {
    accessToken: completed.json().accessToken as string,
    secret: started.json().setup.secret as string,
  };
}

async function beginRecovery(app: ReturnType<typeof buildApp>, login: string) {
  const started = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { login, password },
  });
  assert.equal(started.statusCode, 202);
  assert.equal(started.json().setupRequired, false);
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/2fa/recovery/request",
    payload: { challengeToken: started.json().challengeToken },
  });
  assert.equal(requested.statusCode, 202);
  return {
    challengeToken: started.json().challengeToken as string,
    requestId: requested.json().requestId as string,
  };
}

test("2FA recovery is reviewed, rejection preserves access and approval revokes every session", async () => {
  const authRepository = new MemoryAuthRepository(await users());
  const notificationRepository = new MemoryNotificationRepository();
  const app = buildApp({
    logger: false,
    authRepository,
    notificationRepository,
    twoFactorRepository: new MemoryTwoFactorRepository(),
    authTokenSecret: authSecret,
    twoFactorEncryptionKey: encryptionKey,
    notificationEncryptionKey: "rooms-two-factor-recovery-notification-key-2026",
    enforceTwoFactor: true,
  });
  await app.ready();
  try {
    const partner = await setupFactor(app, "partner@rooms.test");
    const admin = await setupFactor(app, "admin-one@rooms.test");

    const first = await beginRecovery(app, "partner@rooms.test");
    const duplicate = await beginRecovery(app, "partner@rooms.test");
    assert.equal(duplicate.requestId, first.requestId);

    const consumedChallenge = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: duplicate.challengeToken, code: "000000" },
    });
    assert.equal(consumedChallenge.statusCode, 410);

    const queue = await app.inject({
      method: "GET",
      url: "/v1/admin/two-factor-recovery?status=pending",
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.json().length, 1);
    assert.equal(queue.json()[0].user.email, "partner@rooms.test");
    assert.equal("passwordHash" in queue.json()[0].user, false);

    const rejected = await app.inject({
      method: "PATCH",
      url: `/v1/admin/two-factor-recovery/${first.requestId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: "rejected", comment: "Не удалось подтвердить личность" },
    });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().status, "rejected");

    const partnerStillSignedIn = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${partner.accessToken}` },
    });
    assert.equal(partnerStillSignedIn.statusCode, 200);

    const second = await beginRecovery(app, "partner@rooms.test");
    assert.notEqual(second.requestId, first.requestId);
    const approved = await app.inject({
      method: "PATCH",
      url: `/v1/admin/two-factor-recovery/${second.requestId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: "approved", comment: "Личность подтверждена службой поддержки" },
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().status, "approved");

    const revokedPartnerSession = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${partner.accessToken}` },
    });
    assert.equal(revokedPartnerSession.statusCode, 401);

    const freshLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "partner@rooms.test", password },
    });
    assert.equal(freshLogin.statusCode, 202);
    assert.equal(freshLogin.json().setupRequired, true);

    const deliveries = await notificationRepository.listForUser("11111111-1111-4111-8111-111111111111");
    assert.ok(deliveries.some((item) => item.eventKey === "two_factor_recovery_requested"));
    assert.equal(deliveries.filter((item) => item.eventKey === "two_factor_recovery_decided").length, 2);
  } finally {
    await app.close();
  }
});

test("an administrator cannot approve their own 2FA recovery", async () => {
  const authRepository = new MemoryAuthRepository(await users());
  const app = buildApp({
    logger: false,
    authRepository,
    twoFactorRepository: new MemoryTwoFactorRepository(),
    authTokenSecret: authSecret,
    twoFactorEncryptionKey: encryptionKey,
    notificationEncryptionKey: "rooms-two-factor-recovery-notification-key-2026",
    enforceTwoFactor: true,
  });
  await app.ready();
  try {
    const firstAdmin = await setupFactor(app, "admin-one@rooms.test");
    const secondAdmin = await setupFactor(app, "admin-two@rooms.test");
    const recovery = await beginRecovery(app, "admin-one@rooms.test");

    const selfApproval = await app.inject({
      method: "PATCH",
      url: `/v1/admin/two-factor-recovery/${recovery.requestId}`,
      headers: { authorization: `Bearer ${firstAdmin.accessToken}` },
      payload: { status: "approved" },
    });
    assert.equal(selfApproval.statusCode, 403);
    assert.equal(selfApproval.json().code, "TWO_FACTOR_RECOVERY_SELF_APPROVAL_FORBIDDEN");

    const approvedByColleague = await app.inject({
      method: "PATCH",
      url: `/v1/admin/two-factor-recovery/${recovery.requestId}`,
      headers: { authorization: `Bearer ${secondAdmin.accessToken}` },
      payload: { status: "approved" },
    });
    assert.equal(approvedByColleague.statusCode, 200);

    const revoked = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${firstAdmin.accessToken}` },
    });
    assert.equal(revoked.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("security notifications are emitted for a new session and repeated failures, not refresh rotation", async () => {
  const notificationRepository = new MemoryNotificationRepository();
  const app = buildApp({
    logger: false,
    authRepository: new MemoryAuthRepository(await users()),
    notificationRepository,
    authTokenSecret: authSecret,
    twoFactorEncryptionKey: encryptionKey,
    notificationEncryptionKey: "rooms-two-factor-recovery-notification-key-2026",
    enforceTwoFactor: false,
  });
  await app.ready();
  try {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "partner@rooms.test", password },
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    const firstDeliveries = await notificationRepository.listForUser("11111111-1111-4111-8111-111111111111");
    assert.equal(firstDeliveries.filter((item) => item.eventKey === "security_login").length, 1);

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { cookie },
    });
    assert.equal(refreshed.statusCode, 200);
    const afterRefresh = await notificationRepository.listForUser("11111111-1111-4111-8111-111111111111");
    assert.equal(afterRefresh.filter((item) => item.eventKey === "security_login").length, 1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { login: "partner@rooms.test", password: "wrong-password" },
      });
      assert.equal(failed.statusCode, 401);
    }
    const afterFailures = await notificationRepository.listForUser("11111111-1111-4111-8111-111111111111");
    assert.equal(afterFailures.filter((item) => item.eventKey === "security_login_failed").length, 1);
  } finally {
    await app.close();
  }
});
