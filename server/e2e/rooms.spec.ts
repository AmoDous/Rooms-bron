import { test as base, expect, type Page } from "@playwright/test";
import { TOTP } from "otpauth";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository, type UserRole } from "../src/auth.js";
import { MemoryBookingRepository } from "../src/bookings.js";
import { demoVenues, venueIds } from "../src/catalog.js";

const password = "Rooms-browser-test-2026";
const partnerId = "50000000-0000-4000-8000-000000000091";
const test = base.extend<{ appUrl: string }>({
  appUrl: async ({ page }, use) => {
    const port = Number(process.env.ROOMS_E2E_PORT || 3199);
    const appUrl = `http://127.0.0.1:${port}`;
    const passwordHash = await hashPassword(password);
    const authRepository = new MemoryAuthRepository(([
      ["partner", partnerId],
      ["admin", "50000000-0000-4000-8000-000000000092"],
      ["accountant", "50000000-0000-4000-8000-000000000093"],
      ["client", "50000000-0000-4000-8000-000000000094"],
    ] as [UserRole, string][]).map(([role, id]) => ({
      id, role, name: `Browser ${role}`, email: `${role}@rooms.test`,
      phone: role === "client" ? "+79000000994" : null, city: "Воронеж",
      passwordHash, passwordResetRequired: false, blockedAt: null,
    })));
    const bookingRepository = new MemoryBookingRepository({
      partners: [{ userId: partnerId, venue: demoVenues.find((venue) => venue.id === venueIds.kidsLoft)! }],
    });
    // Deliberately no dotenv or PostgreSQL: every test owns an isolated disposable server.
    const app = buildApp({ authRepository, bookingRepository, enforceTwoFactor: true,
      publicApiUrl: appUrl, publicSiteUrl: appUrl, corsOrigins: [appUrl], logger: false });
    await app.listen({ host: "127.0.0.1", port });
    try { await use(appUrl); } finally {
      // Stop browser requests before waiting for the disposable server to shut down.
      await page.close();
      app.server.closeAllConnections();
      await app.close();
    }
  },
});

async function open(page: Page, appUrl: string, path = "/") {
  await page.route(/^https?:\/\//, (route) => new URL(route.request().url()).origin === appUrl
    ? route.continue() : route.fulfill({ status: 200, body: "", contentType: "text/plain" }));
  await page.goto(`${appUrl}${path}`);
  await expect(page.locator("html")).toHaveAttribute("data-api", "connected");
}

async function login(page: Page, role: UserRole) {
  await page.locator("#accountButton").click();
  const form = page.locator("#loginForm");
  await form.locator('[name="login"]').fill(`${role}@rooms.test`);
  await form.locator('[name="password"]').fill(password);
  await form.locator('[type="submit"]').click();
  if (role !== "client") {
    const secret = page.locator("[data-two-factor-secret]");
    await expect(secret).toBeVisible();
    const totp = new TOTP({ secret: (await secret.innerText()).trim(), digits: 6, period: 30, algorithm: "SHA1" });
    await page.locator('#twoFactorForm [name="code"]').fill(totp.generate());
    await page.locator('#twoFactorForm [type="submit"]').click();
    await page.locator("[data-two-factor-continue]").click();
  }
  await expect(page).toHaveURL(new RegExp(`/${role === "client" ? "account" : role === "accountant" ? "accounting" : role}(?:[?#]|$)`));
}

async function noHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.width + 1);
}

async function themeContrastRatios(page: Page) {
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const rgb = (value: string) => value.match(/[\da-f]{2}/gi)!.map((part) => parseInt(part, 16) / 255)
      .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    const luminance = (value: string) => { const [r, g, b] = rgb(value); return .2126 * r! + .7152 * g! + .0722 * b!; };
    const ratio = (left: string, right: string) => {
      const a = luminance(left), b = luminance(right);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const get = (name: string) => styles.getPropertyValue(name).trim().slice(1);
    const dark = document.documentElement.dataset.theme === "dark";
    return { primary: ratio(get("--ink"), get("--bg")), secondary: ratio(get("--muted"), get("--bg")),
      action: ratio(dark ? "1b100d" : "ffffff", get("--green")) };
  });
}

async function chooseTomorrow(page: Page) {
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  await expect(page.locator("[data-detail-date]")).toBeVisible();
  await expect(page.locator(".availability-sync.loading")).toHaveCount(0);
  await page.locator("[data-detail-date]").fill(tomorrow);
  await expect(page.locator("[data-book]")).toBeEnabled();
}

test("city selection, scenario catalog and addressable room work without registration", async ({ page, appUrl }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, appUrl);
  await page.locator("#cityButton").click();
  await expect(page.locator("#registerForm")).toHaveCount(0);
  await page.locator('[data-city-choice="Воронеж"]').click();
  await page.locator("#date").fill(new Date(Date.now() + 86400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }));
  await page.locator('[data-scenario="kids"]').click();
  await expect(page).toHaveURL(/\/catalog/);
  await expect(page.locator("[data-venue-link]").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto(`${appUrl}/venues/kids-loft/rooms/kosmos`);
  await expect(page.locator("[data-detail-date]")).toBeVisible();
  await chooseTomorrow(page);
  await expect(page.locator("#reviewForm")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("room.png"), fullPage: true });
  await page.reload();
  await chooseTomorrow(page);
  expect(errors).toEqual([]);
});

test("slow API startup never exposes a temporary demo booking form", async ({ page, appUrl }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appUrl) return route.fulfill({ status: 200, body: "" });
    if (url.pathname === "/health") await gate;
    return route.continue();
  });
  try {
    await page.goto(`${appUrl}/venues/kids-loft/rooms/kosmos`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Открываем площадку" })).toBeVisible();
    await expect(page.locator("[data-book]")).toHaveCount(0);
  } finally { release(); }
  await chooseTomorrow(page);
  await page.locator("[data-book]").click();
  await expect(page.locator("#bookingForm")).toBeVisible();
});

test("light and dark themes persist across responsive public and room views", async ({ page, appUrl }, info) => {
  await open(page, appUrl);
  const toggle = page.locator("#themeButton");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const ratio of Object.values(await themeContrastRatios(page))) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", "Включить светлую тему");
  expect(await page.evaluate(() => localStorage.getItem("rooms_theme_v1"))).toBe("dark");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 19, 17)");
  const colors = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector(".venue-card")!).backgroundColor,
    text: getComputedStyle(document.body).color }));
  expect(colors.body).toBe("rgb(21, 19, 17)");
  expect(colors.card).not.toBe("rgb(255, 255, 255)");
  expect(colors.text).toBe("rgb(246, 240, 236)");
  for (const ratio of Object.values(await themeContrastRatios(page))) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("home-dark.png"), fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto(`${appUrl}/venues/kids-loft/rooms/kosmos`);
  await chooseTomorrow(page);
  await expect(page.locator('.venue-page-actions [data-theme-toggle]')).toHaveAttribute("aria-pressed", "true");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("room-dark.png") });
  await page.locator('.venue-page-actions [data-theme-toggle]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("client creates a booking, partner confirms it, client sees the server payment form", async ({ page, context, browser, appUrl }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, appUrl);
  await login(page, "client");
  await page.goto(`${appUrl}/venues/kids-loft/rooms/kosmos`);
  await chooseTomorrow(page);
  await page.locator("[data-book]").click();
  const form = page.locator("#bookingForm");
  await expect(form.locator('[name="phone"]')).toHaveValue(/9000000994/);
  for (const checkbox of await form.locator('[data-consent-control] input[type="checkbox"]').all()) await checkbox.check();
  const created = page.waitForResponse((response) => response.url().endsWith("/v1/bookings") && response.request().method() === "POST");
  await form.locator('[type="submit"]').click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);
  const booking = await response.json();
  const partnerContext = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const partner = await partnerContext.newPage();
    partner.on("pageerror", (error) => errors.push(error.message));
    await open(partner, appUrl);
    await login(partner, "partner");
    const card = partner.locator(`[data-booking-card="${booking.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("+79000000994");
    await card.locator('[data-booking-status$="|awaiting_payment"]').click();
    await expect(partner.locator(`[data-booking-card="${booking.id}"] .status`).first()).toHaveClass(/awaiting_payment/);
    await noHorizontalOverflow(partner);
    await partner.screenshot({ path: info.outputPath("partner.png") });
    await page.goto(`${appUrl}/account`);
    await page.locator(`[data-pay-booking="${booking.id}"]`).click();
    await expect(page.locator("#paymentForm")).toBeVisible();
    await expect(page.locator('#paymentForm [name="cardNumber"]')).toHaveCount(0);
    await expect(page.locator(".receipt-card")).toContainText("Остаток");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("payment.png") });
  } finally { await partnerContext.close(); }
  expect(await context.cookies()).not.toHaveLength(0);
  expect(errors).toEqual([]);
});

test("invalid password is rejected and staff workspaces survive reload", async ({ page, appUrl }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, appUrl);
  await page.locator("#accountButton").click();
  await page.locator('#loginForm [name="login"]').fill("admin@rooms.test");
  await page.locator('#loginForm [name="password"]').fill("wrong-password");
  const rejected = page.waitForResponse((response) => response.url().endsWith("/v1/auth/login"));
  await page.locator('#loginForm [type="submit"]').click();
  expect((await rejected).status()).toBe(401);
  await expect(page.locator("#loginForm")).toBeVisible();
  await page.goto(appUrl);
  await login(page, "admin");
  await expect(page.locator("[data-operations-health]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-operations-health]")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("admin.png") });
  await page.locator('[data-logout]').first().click();
  await login(page, "accountant");
  await expect(page.getByRole("heading", { name: "Деньги и выплаты" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Деньги и выплаты" })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
