import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const frontendUrl = new URL("../../index.html", import.meta.url);

test("frontend runtime script remains valid JavaScript", async () => {
  const html = await readFile(frontendUrl, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)];
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    const source = script[1];
    assert.ok(source);
    assert.doesNotThrow(() => new Function(source));
  }
});

test("room windows discard elapsed starts every time the cache is read", async () => {
  const html = await readFile(frontendUrl, "utf8");
  const source = html.slice(html.indexOf("function cachedApiWindows("), html.indexOf("function capacityAtHour("));
  let now = Date.parse("2026-09-02T09:30:00+03:00");
  const cached = new Function("apiState", "apiBookingDateTime", "Date", `${source}; return cachedApiWindows;`)(
    { connected: true }, (value: string) => ({ time: value.slice(11, 16) }), { parse: Date.parse, now: () => now },
  );
  const room = { apiId: "room", apiAvailabilityByDate: { "2026-09-02": [
    { startsAt: "2026-09-02T09:00:00+03:00", maximumDurationMinutes: 180 },
    { startsAt: "2026-09-02T10:00:00+03:00", maximumDurationMinutes: 120 },
  ] } };
  assert.deepEqual(cached(room, "2026-09-02").map((item: { time: string }) => item.time), ["10:00"]);
  now = Date.parse("2026-09-02T10:01:00+03:00");
  assert.deepEqual(cached(room, "2026-09-02"), []);
  assert.equal(cached(room, "2026-09-03"), null);
});

test("catalog delegates timed search and interval pricing to the planner", async () => {
  const html = await readFile(frontendUrl, "utf8");
  assert.match(html, /apiRequest\("\/v1\/planning\/preview",\{method:"POST",body\}\)/u);
  assert.match(html, /maxVariantsPerRoomSet:1/u);
  assert.match(html, /catalogPlanning\.variants\.has\(r\.id\)/u);
  assert.match(html, /planned-total/u);
  assert.match(html, /function plannedVenuePath\(g\)/u);
  assert.match(html, /plannedContextFromElement\(venueLink\)/u);
  assert.match(html, /function ensureRoomAvailabilityWeek\(r,start=state\.date/u);
  assert.match(html, /function fetchRoomAvailabilityDate\(r,date/u);
  assert.match(html, /Свободное время проверено по календарю площадки/u);
});

test("production frontend fails closed and keeps sensitive state out of localStorage", async () => {
  const html = await readFile(frontendUrl, "utf8");
  const directStorageCalls = [...html.matchAll(/localStorage\.(getItem|setItem|removeItem)/gu)].map((match) => match[1]);

  assert.deepEqual(directStorageCalls, ["getItem", "setItem", "getItem", "setItem", "removeItem"]);
  assert.match(html, /localStorage\.getItem\("rooms_theme_v1"\)/u);
  assert.match(html, /localStorage\.setItem\(themeStorageKey,next\)/u);
  assert.match(html, /const apiRequired=runtimeMode==="production"/u);
  assert.match(html, /productionPersistentKeys=new Set\(\[store\.favorites,store\.cityPreference\]\)/u);
  assert.match(html, /function ensureProductionApi\(\)\{if\(!apiState\.required\|\|apiState\.connected\)return true/u);
  assert.match(html, /if\(apiState\.required\)\{purgeProductionLocalData\(\);showApiGate\("loading"\)\}/u);
  assert.match(html, /if\(apiState\.required\)\{document\.documentElement\.dataset\.api="offline";showApiGate\("error"\)/u);
  assert.match(html, /if\(!apiState\.required\)Object\.assign\(pendingPayment/u);
  assert.ok((html.match(/if\(!ensureProductionApi\(\)\)return;/gu) ?? []).length >= 8);
});

test("partner application sections stay in normal flow on wide screens", async () => {
  const html = await readFile(frontendUrl, "utf8");

  assert.match(html, /\.partner-onboarding-copy\{position:relative;min-width:0;align-self:start\}/u);
  assert.match(html, /\.partner-process\{position:relative;grid-column:1\/-1;clear:both;/u);
  assert.doesNotMatch(html, /\.partner-onboarding-copy\{[^}]*position:sticky/u);
});
