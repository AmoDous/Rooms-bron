import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertProductionSafety, deploymentReport, productionSafetyChecks } from "../src/deployment.js";
import { createCatalogStorage } from "../src/storage.js";

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://rooms:private-db-password@database.test/rooms",
    DATABASE_SSL: "verify-full",
    AUTH_TOKEN_SECRET: "a".repeat(40), RATE_LIMIT_HASH_KEY: "b".repeat(40),
    TWO_FACTOR_ENCRYPTION_KEY: "c".repeat(40), NOTIFICATION_ENCRYPTION_KEY: "d".repeat(40),
    FINANCE_ENCRYPTION_KEY: "e".repeat(40),
    PUBLIC_SITE_URL: "https://rooms.test", PUBLIC_API_URL: "https://rooms.test",
    CORS_ORIGINS: "https://rooms.test",
    S3_BUCKET: "rooms-private", S3_REGION: "ru-test-1",
    SMTP_URL: "smtps://account:private-smtp-password@mail.test:465", EMAIL_FROM: "Rooms <noreply@rooms.test>",
    PAYMENT_PROVIDER: "sber", SBER_API_BASE_URL: "https://bank.test/payment/rest",
    SBER_USERNAME: "private-bank-user", SBER_PASSWORD: "private-bank-password",
  };
}

test("production safety accepts secure defaults without performing network requests", () => {
  assert.doesNotThrow(() => assertProductionSafety(productionEnv()));
  assert.ok(productionSafetyChecks(productionEnv()).every((item) => item.status === "pass"));
  assert.doesNotThrow(() => assertProductionSafety({ NODE_ENV: "development" }));
});

test("production storage cannot silently fall back to process memory", async () => {
  await assert.rejects(createCatalogStorage({ NODE_ENV: "production" }), /DATABASE_URL is required in production/);
  const report = productionSafetyChecks({ ...productionEnv(), DATABASE_URL: "" });
  assert.equal(report.find((item) => item.id === "database")?.status, "fail");
  for (const DATABASE_URL of ["https://database.test/rooms", "postgresql://database.test/"]) {
    assert.throws(() => assertProductionSafety({ ...productionEnv(), DATABASE_URL }), /DATABASE_URL/);
  }
});

test("production safety rejects insecure and misspelled flags", () => {
  for (const [key, setting] of Object.entries({ AUTH_COOKIE_SECURE: "false", TWO_FACTOR_REQUIRED: "false",
    ENABLE_DEMO_PAYMENTS: "true", EXPOSE_PASSWORD_RESET_TOKEN: "true", ALLOW_DEMO_SEED: "true",
    NOTIFICATION_DELIVERY_MODE: "log" })) {
    assert.throws(() => assertProductionSafety({ ...productionEnv(), [key]: setting }), new RegExp(key));
    assert.throws(() => assertProductionSafety({ ...productionEnv(), [key]: "typo" }), new RegExp(key));
  }
});

test("production keys must be long and independent", () => {
  assert.throws(() => assertProductionSafety({ ...productionEnv(), AUTH_TOKEN_SECRET: "short" }), /distinct/);
  assert.throws(() => assertProductionSafety({ ...productionEnv(), AUTH_TOKEN_SECRET: "b".repeat(40) }), /distinct/);
});

test("deployment URLs reject credentials, invalid origins and a missing site origin", () => {
  for (const PUBLIC_API_URL of ["http://rooms.test", "https://user:password@rooms.test", "https://", "https://rooms.test/path", "https://rooms.test?x=1"]) {
    assert.throws(() => assertProductionSafety({ ...productionEnv(), PUBLIC_API_URL }), /PUBLIC_API_URL/);
  }
  for (const CORS_ORIGINS of ["", "*", "https://other.test", "https://rooms.test/path", "https://rooms.test,http://local.test"]) {
    assert.throws(() => assertProductionSafety({ ...productionEnv(), CORS_ORIGINS }), /CORS_ORIGINS/);
  }
});

test("production photos require durable S3 configuration with paired credentials", () => {
  for (const override of [{ PHOTO_STORAGE_MODE: "local" }, { S3_BUCKET: "" }, { S3_REGION: "" },
    { S3_ACCESS_KEY_ID: "only-key" }, { S3_SESSION_TOKEN: "only-token" }, { S3_ENDPOINT: "http://s3.test" }]) {
    assert.throws(() => assertProductionSafety({ ...productionEnv(), ...override }), /S3_BUCKET/);
  }
});

test("deployment report does not mistake configured bank credentials for a complete paid launch", () => {
  const report = deploymentReport(productionEnv());
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "payments")?.status, "pass");
  assert.equal(report.checks.find((item) => item.id === "fiscal-receipts")?.status, "fail");
  assert.equal(report.checks.find((item) => item.id === "external-verification")?.status, "warning");
  for (const override of [{ PAYMENT_PROVIDER: "demo" }, { SBER_API_BASE_URL: "https://ecomtest.sberbank.ru" },
    { SBER_PASSWORD: "" }, { REFUND_WORKER_ENABLED: "false" }]) {
    assert.equal(deploymentReport({ ...productionEnv(), ...override }).checks.find((item) => item.id === "payments")?.status, "fail");
  }
});

test("deployment report identifies disabled delivery and missing SMTP settings", () => {
  for (const override of [{ SMTP_URL: "" }, { SMTP_URL: "https://mail.test" }, { EMAIL_FROM: "" },
    { NOTIFICATION_WORKER_ENABLED: "false" }]) {
    assert.equal(deploymentReport({ ...productionEnv(), ...override }).checks.find((item) => item.id === "email")?.status, "fail");
  }
});

test("deployment output and errors never contain supplied secrets or connection strings", () => {
  const env: NodeJS.ProcessEnv = { ...productionEnv(), TWO_FACTOR_REQUIRED: "false" };
  let message = "";
  try { assertProductionSafety(env); } catch (error) { message = String(error); }
  const output = JSON.stringify(deploymentReport(env)) + message;
  for (const key of ["AUTH_TOKEN_SECRET", "RATE_LIMIT_HASH_KEY", "DATABASE_URL", "SMTP_URL", "SBER_USERNAME", "SBER_PASSWORD"]) {
    assert.ok(!output.includes(env[key]!), key);
  }
});

test("deployment CLI returns parseable redacted JSON and a nonzero code for launch blockers", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-deployment.ts", "--json"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15_000, windowsHide: true,
    env: { ...process.env, ...productionEnv(), DOTENV_CONFIG_QUIET: "true",
      DOTENV_CONFIG_PATH: fileURLToPath(new URL("./nonexistent-deployment-test.env", import.meta.url)) },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item: { id: string }) => item.id === "fiscal-receipts").status, "fail");
  assert.ok(!result.stdout.includes("private-bank-password"));
  assert.ok(!result.stdout.includes("private-db-password"));
});
