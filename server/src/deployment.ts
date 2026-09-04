export interface DeploymentCheck {
  id: string;
  status: "pass" | "fail" | "warning";
  message: string;
}

const value = (env: NodeJS.ProcessEnv, key: string) => env[key]?.trim() || "";
const flag = (env: NodeJS.ProcessEnv, key: string, expected: boolean) =>
  env[key] === undefined || value(env, key).toLowerCase() === String(expected);
const requiredFlag = (env: NodeJS.ProcessEnv, key: string) => value(env, key).toLowerCase() === "true";

function url(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}

function httpsUrl(raw: string, originOnly = false): boolean {
  const parsed = url(raw);
  return Boolean(parsed && parsed.protocol === "https:" && !parsed.username && !parsed.password
    && !parsed.search && !parsed.hash && (!originOnly || parsed.origin === raw));
}

function check(id: string, passed: boolean, message: string): DeploymentCheck {
  return { id, status: passed ? "pass" : "fail", message };
}

// Messages intentionally contain setting names only, never their supplied values.
export function productionSafetyChecks(env: NodeJS.ProcessEnv): DeploymentCheck[] {
  const database = url(value(env, "DATABASE_URL"));
  const keys = ["AUTH_TOKEN_SECRET", "RATE_LIMIT_HASH_KEY", "TWO_FACTOR_ENCRYPTION_KEY",
    "NOTIFICATION_ENCRYPTION_KEY", "FINANCE_ENCRYPTION_KEY"].map((key) => value(env, key));
  const site = value(env, "PUBLIC_SITE_URL");
  const api = value(env, "PUBLIC_API_URL");
  const origins = value(env, "CORS_ORIGINS").split(",").map((origin) => origin.trim()).filter(Boolean);
  const mode = value(env, "PHOTO_STORAGE_MODE").toLowerCase() || "s3";
  const s3Key = value(env, "S3_ACCESS_KEY_ID");
  const s3Secret = value(env, "S3_SECRET_ACCESS_KEY");
  return [
    check("database", Boolean(database && ["postgres:", "postgresql:"].includes(database.protocol)
      && database.hostname && database.pathname.length > 1), "DATABASE_URL must identify a persistent PostgreSQL database."),
    check("secrets", keys.every((key) => Buffer.byteLength(key, "utf8") >= 32) && new Set(keys).size === keys.length,
      "AUTH_TOKEN_SECRET, RATE_LIMIT_HASH_KEY, TWO_FACTOR_ENCRYPTION_KEY, NOTIFICATION_ENCRYPTION_KEY and FINANCE_ENCRYPTION_KEY must be distinct and at least 32 bytes each."),
    check("public-urls", httpsUrl(site) && httpsUrl(api, true),
      "PUBLIC_SITE_URL must use HTTPS; PUBLIC_API_URL must be an explicit HTTPS origin without a trailing slash."),
    check("cors", origins.length > 0 && origins.every((origin) => httpsUrl(origin, true))
      && origins.includes(url(site)?.origin || ""), "CORS_ORIGINS must contain explicit HTTPS origins, including the PUBLIC_SITE_URL origin."),
    check("cookies", flag(env, "AUTH_COOKIE_SECURE", true), "AUTH_COOKIE_SECURE must be true or omitted in production."),
    check("demo-payments", flag(env, "ENABLE_DEMO_PAYMENTS", false), "ENABLE_DEMO_PAYMENTS must be false or omitted in production."),
    check("reset-tokens", flag(env, "EXPOSE_PASSWORD_RESET_TOKEN", false), "EXPOSE_PASSWORD_RESET_TOKEN must be false or omitted in production."),
    check("two-factor", flag(env, "TWO_FACTOR_REQUIRED", true), "TWO_FACTOR_REQUIRED must be true or omitted in production."),
    check("demo-seed", flag(env, "ALLOW_DEMO_SEED", false), "ALLOW_DEMO_SEED must be false or omitted in production."),
    check("photos", mode === "s3" && Boolean(value(env, "S3_BUCKET") && value(env, "S3_REGION"))
      && Boolean(s3Key) === Boolean(s3Secret) && (!value(env, "S3_SESSION_TOKEN") || Boolean(s3Key))
      && (!value(env, "S3_ENDPOINT") || httpsUrl(value(env, "S3_ENDPOINT"))),
      "Production photos require S3_BUCKET, S3_REGION, HTTPS S3_ENDPOINT when supplied, and paired S3 credentials (or an infrastructure role)."),
    check("notification-mode", (value(env, "NOTIFICATION_DELIVERY_MODE").toLowerCase() || "live") === "live",
      "NOTIFICATION_DELIVERY_MODE must be live or omitted in production; log mode does not deliver messages."),
    check("legal-documents", requiredFlag(env, "LEGAL_DOCUMENTS_APPROVED"),
      "LEGAL_DOCUMENTS_APPROVED must be true only after the final offer, privacy policy and separate consents have been approved for the registered operator."),
    check("personal-data-notice", requiredFlag(env, "PD_OPERATOR_NOTIFIED"),
      "PD_OPERATOR_NOTIFIED must be true only after the operator has submitted the required personal-data processing notice."),
    check("personal-data-localization", requiredFlag(env, "PD_DATA_LOCALIZED_RU"),
      "PD_DATA_LOCALIZED_RU must be true only after the primary databases and storage for Russian users have been verified as located in Russia."),
  ];
}

export function assertProductionSafety(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") return;
  const failures = productionSafetyChecks(env).filter((item) => item.status === "fail");
  if (failures.length) throw new Error(`Unsafe production configuration:\n${failures.map((item) => `- ${item.message}`).join("\n")}`);
}

export function deploymentReport(env: NodeJS.ProcessEnv) {
  const smtp = url(value(env, "SMTP_URL"));
  const paymentUrl = url(value(env, "SBER_API_BASE_URL"));
  const checks: DeploymentCheck[] = [
    check("environment", env.NODE_ENV === "production", "NODE_ENV must be production for the live deployment."),
    ...productionSafetyChecks(env),
    check("email", Boolean(smtp && ["smtp:", "smtps:"].includes(smtp.protocol) && smtp.hostname
      && value(env, "EMAIL_FROM")) && flag(env, "NOTIFICATION_WORKER_ENABLED", true),
      "SMTP_URL, EMAIL_FROM and the notification worker are required for account emails; delivery still needs an external test."),
    check("payments", value(env, "PAYMENT_PROVIDER").toLowerCase() === "sber"
      && httpsUrl(value(env, "SBER_API_BASE_URL")) && !paymentUrl?.hostname.toLowerCase().includes("ecomtest")
      && Boolean(value(env, "SBER_USERNAME") && value(env, "SBER_PASSWORD")) && flag(env, "REFUND_WORKER_ENABLED", true),
      "Live payments require PAYMENT_PROVIDER=sber, bank-issued production HTTPS endpoint and credentials, and the refund worker. Credentials are not verified by this check."),
    { id: "fiscal-receipts", status: "fail", message: "A production fiscal-receipt adapter is not implemented yet. Disabled/demo receipts are not sufficient for a paid launch." },
    { id: "database-tls", status: value(env, "DATABASE_SSL").toLowerCase() === "verify-full" ? "pass" : "warning",
      message: "Use DATABASE_SSL=verify-full for a remote database; otherwise have the protected network configuration reviewed." },
    { id: "external-verification", status: "warning", message: "Separately verify database migrations and restore, private S3 permissions, actual email delivery, bank payments/refunds, HTTPS and monitoring. This report performs no network requests." },
  ];
  return { ok: !checks.some((item) => item.status === "fail"), checks };
}
