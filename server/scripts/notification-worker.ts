import "dotenv/config";
import {
  NotificationCipher,
  NotificationDispatcher,
  notificationProviderConfigFromEnv,
  processNotificationBatch,
} from "../src/notifications.js";
import { createCatalogStorage } from "../src/storage.js";

const storage = await createCatalogStorage();
const secret = process.env.NOTIFICATION_ENCRYPTION_KEY?.trim()
  || process.env.AUTH_TOKEN_SECRET?.trim()
  || "rooms-local-development-secret-change-me-2026";

try {
  const summary = await processNotificationBatch(
    storage.notificationRepository,
    new NotificationCipher(secret),
    new NotificationDispatcher(notificationProviderConfigFromEnv()),
    Number(process.env.NOTIFICATION_WORKER_BATCH_SIZE || 50),
  );
  console.log(JSON.stringify(summary));
} finally {
  await storage.close();
}
