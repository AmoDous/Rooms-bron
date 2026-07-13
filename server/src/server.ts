import "dotenv/config";
import { buildApp } from "./app.js";
import { createCatalogStorage } from "./storage.js";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const publicSiteUrl = process.env.PUBLIC_SITE_URL?.trim() || "https://amodous.github.io/Rooms-bron";
const corsOrigins = String(process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000,https://amodous.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const storage = await createCatalogStorage();
const app = buildApp({ publicSiteUrl, corsOrigins, logger: true, repository: storage.repository });
app.addHook("onClose", () => storage.close());

const stop = async (signal: string) => {
  app.log.info({ signal }, "stopping Rooms API");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  await app.listen({ host, port });
  app.log.info({ host, port, storage: storage.repository.storage }, "Rooms API is ready");
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
