import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/app.js";
import { AuthService, hashPassword, MemoryAuthRepository, type AuthUser } from "../src/auth.js";
import { MemoryTwoFactorRepository } from "../src/twoFactor.js";

const authSecret = "rooms-two-factor-auth-test-secret-2026";
const encryptionKey = "rooms-two-factor-encryption-test-key-2026";
const partnerPassword = "partner-secure-2026";

function totp(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "Rooms",
    label: "partner@rooms.test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

async function protectedUsers(): Promise<AuthUser[]> {
  return [
    {
      id: "11111111-1111-4111-8111-111111111111",
      role: "partner",
      name: "Защищённый партнёр",
      email: "partner@rooms.test",
      phone: "+79001000001",
      city: "Воронеж",
      passwordHash: await hashPassword(partnerPassword),
      passwordResetRequired: false,
      blockedAt: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      role: "client",
      name: "Обычный клиент",
      email: "client@rooms.test",
      phone: "+79001000002",
      city: "Воронеж",
      passwordHash: await hashPassword("client-secure-2026"),
      passwordResetRequired: false,
      blockedAt: null,
    },
  ];
}

test("protected roles receive a short-lived 2FA challenge before any session", async () => {
  const authRepository = new MemoryAuthRepository(await protectedUsers());
  const twoFactorRepository = new MemoryTwoFactorRepository();
  const app = buildApp({
    logger: false,
    authRepository,
    twoFactorRepository,
    authTokenSecret: authSecret,
    twoFactorEncryptionKey: encryptionKey,
    enforceTwoFactor: true,
  });
  await app.ready();
  try {
    const passwordStep = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "partner@rooms.test", password: partnerPassword },
    });
    assert.equal(passwordStep.statusCode, 202);
    assert.equal(passwordStep.json().twoFactorRequired, true);
    assert.equal(passwordStep.json().setupRequired, true);
    assert.equal("accessToken" in passwordStep.json(), false);
    assert.equal(passwordStep.headers["set-cookie"], undefined);

    const setup = passwordStep.json().setup;
    assert.match(setup.secret, /^[A-Z2-7]+$/u);
    assert.match(setup.otpAuthUrl, /^otpauth:\/\/totp\//u);
    assert.match(setup.qrDataUrl, /^data:image\/svg\+xml;base64,/u);
    const challenge = await twoFactorRepository.getChallenge(
      createHash("sha256").update(passwordStep.json().challengeToken).digest("hex"),
    );
    const encryptedSecret = challenge?.pendingSecretCiphertext;
    assert.ok(encryptedSecret);
    assert.match(encryptedSecret, /^enc:v1:/u);
    assert.equal(encryptedSecret.includes(setup.secret), false);

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: passwordStep.json().challengeToken, code: "000000" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().code, "TWO_FACTOR_CODE_INVALID");

    const completed = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: passwordStep.json().challengeToken, code: totp(setup.secret) },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().user.role, "partner");
    assert.equal(completed.json().recoveryCodes.length, 8);
    assert.match(String(completed.headers["set-cookie"]), /rooms_refresh=.*HttpOnly/u);
    const accessToken = completed.json().accessToken;

    const profile = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(profile.statusCode, 200);
    const status = await app.inject({
      method: "GET",
      url: "/v1/me/two-factor",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.deepEqual(status.json(), {
      required: true,
      enabled: true,
      enabledAt: status.json().enabledAt,
      recoveryCodesRemaining: 8,
    });

    const nextPasswordStep = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "partner@rooms.test", password: partnerPassword },
    });
    assert.equal(nextPasswordStep.statusCode, 202);
    assert.equal(nextPasswordStep.json().setupRequired, false);
    assert.equal(nextPasswordStep.json().setup, undefined);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: nextPasswordStep.json().challengeToken, code: totp(setup.secret) },
    });
    assert.equal(replay.statusCode, 401);

    const recoveryCode = completed.json().recoveryCodes[0];
    const recovered = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: nextPasswordStep.json().challengeToken, code: recoveryCode },
    });
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().usedRecoveryCode, true);
    assert.equal(recovered.json().recoveryCodes, null);

    const thirdPasswordStep = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "partner@rooms.test", password: partnerPassword },
    });
    const reusedRecovery = await app.inject({
      method: "POST",
      url: "/v1/auth/2fa/complete",
      payload: { challengeToken: thirdPasswordStep.json().challengeToken, code: recoveryCode },
    });
    assert.equal(reusedRecovery.statusCode, 401);

    const clientLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "client@rooms.test", password: "client-secure-2026" },
    });
    assert.equal(clientLogin.statusCode, 200);
    assert.equal(clientLogin.json().user.role, "client");
  } finally {
    await app.close();
  }
});

test("protected roles cannot reuse a legacy session without verified 2FA", async () => {
  const repository = new MemoryAuthRepository(await protectedUsers());
  const permissive = new AuthService(repository, authSecret);
  const legacy = await permissive.login("partner@rooms.test", partnerPassword, null, null);
  assert.ok(legacy);

  const protectedAuth = new AuthService(repository, authSecret, ["partner", "admin", "accountant"]);
  const authenticated = await protectedAuth.authenticate(`Bearer ${legacy.accessToken}`);
  assert.equal(authenticated, null);
});
