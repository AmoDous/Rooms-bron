import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository } from "../src/auth.js";
import {
  AuthRateLimiter,
  MemoryRateLimitRepository,
} from "../src/rateLimits.js";

const hashKey = "rooms-rate-limit-test-secret-with-32-bytes";

test("rate limiter expires, clears and never stores its raw lookup key", async () => {
  let now = Date.parse("2026-07-24T10:00:00.000Z");
  const repository = new MemoryRateLimitRepository();
  const limiter = new AuthRateLimiter(
    repository,
    "test_login_ip",
    hashKey,
    2,
    1_000,
    () => new Date(now),
  );
  const rawKey = "198.51.100.42";

  assert.equal(await limiter.blocked(rawKey), false);
  assert.equal(await limiter.fail(rawKey), 1);
  assert.equal(await limiter.fail(rawKey), 2);
  assert.equal(await limiter.blocked(rawKey), true);

  const storedKeys = [
    ...(repository as unknown as { entries: Map<string, unknown> }).entries.keys(),
  ];
  assert.equal(storedKeys.length, 1);
  assert.doesNotMatch(storedKeys[0] ?? "", /198\.51\.100\.42/u);
  assert.match(storedKeys[0] ?? "", /^test_login_ip\|[0-9a-f]{64}$/u);

  await limiter.clear(rawKey);
  assert.equal(await limiter.blocked(rawKey), false);
  assert.equal(storedKeys.some((key) => key.includes(rawKey)), false);

  await limiter.fail(rawKey);
  now += 1_001;
  assert.equal(await limiter.blocked(rawKey), false);
});

test("shared limiter blocks an account across API instances and a restart", async () => {
  const password = "distributed-rate-limit-2026";
  const authRepository = new MemoryAuthRepository([{
    id: "74000000-0000-4000-8000-000000000001",
    role: "client",
    name: "Shared limiter client",
    email: "shared.limiter@rooms.test",
    phone: "+79001110099",
    city: "Воронеж",
    passwordHash: await hashPassword(password),
    passwordResetRequired: false,
    blockedAt: null,
  }]);
  const rateLimitRepository = new MemoryRateLimitRepository();
  const commonConfig = {
    logger: false,
    authRepository,
    rateLimitRepository,
    rateLimitHashKey: hashKey,
  };
  const first = buildApp(commonConfig);
  const second = buildApp(commonConfig);
  await Promise.all([first.ready(), second.ready()]);

  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const instance = attempt % 2 === 0 ? second : first;
      const response = await instance.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: `198.51.100.${attempt}`,
        payload: {
          login: attempt % 2 === 0 ? "SHARED.LIMITER@ROOMS.TEST" : "shared.limiter@rooms.test",
          password: `wrong-${attempt}`,
        },
      });
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }

  const restarted = buildApp(commonConfig);
  await restarted.ready();
  try {
    const blocked = await restarted.inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: "203.0.113.75",
      payload: { login: "shared.limiter@rooms.test", password },
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().code, "LOGIN_RATE_LIMITED");
    assert.equal(blocked.headers["retry-after"], "600");
  } finally {
    await restarted.close();
  }
});
