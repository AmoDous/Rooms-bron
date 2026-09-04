import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository } from "../src/auth.js";
import { MemoryPartnerLeadRepository } from "../src/partnerLeads.js";

test("partner applications persist securely and remain admin-only", async () => {
  const password = "rooms-partner-leads-2026";
  const passwordHash = await hashPassword(password);
  const adminId = "71000000-0000-4000-8000-000000000001";
  const authRepository = new MemoryAuthRepository([
    { id: adminId, role: "admin", name: "Rooms Admin", email: "leads.admin@rooms.test", phone: "+79000000101", city: "Voronezh", passwordHash, passwordResetRequired: false, blockedAt: null },
    { id: "71000000-0000-4000-8000-000000000002", role: "client", name: "Rooms Client", email: "leads.client@rooms.test", phone: "+79000000102", city: "Voronezh", passwordHash, passwordResetRequired: false, blockedAt: null },
  ]);
  const partnerLeadRepository = new MemoryPartnerLeadRepository();
  const app = buildApp({ logger: false, authRepository, partnerLeadRepository });
  await app.ready();

  const payload = {
    city: "Воронеж",
    venueTitle: "Loft Test",
    address: "ул. Тестовая, 10",
    contactName: "Ирина",
    contactPhone: "+7 900 000-11-22",
    contactEmail: "manager@loft-test.ru",
    venueType: "Лофт",
    roomCount: 3,
    comment: "Три отдельных помещения.",
    legal: {
      termsVersion: "2026-07-23",
      privacyVersion: "2026-07-23",
      termsAccepted: true,
      privacyAccepted: true,
    },
  };

  try {
    const whitespaceOnly = await app.inject({
      method: "POST",
      url: "/v1/partner-leads",
      payload: { ...payload, city: "  " },
    });
    assert.equal(whitespaceOnly.statusCode, 400);
    assert.equal(whitespaceOnly.json().code, "PARTNER_LEAD_FIELDS_REQUIRED");

    const created = await app.inject({ method: "POST", url: "/v1/partner-leads", payload });
    assert.equal(created.statusCode, 201);
    assert.equal(created.headers["cache-control"], "no-store");
    assert.equal(created.json().status, "new");
    assert.equal(typeof created.json().id, "string");
    assert.doesNotMatch(created.body, /manager@loft-test\.ru|900 000-11-22/u);
    const leadId = created.json().id as string;

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/partner-leads",
      payload: { ...payload, venueTitle: "Second title" },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, "PARTNER_LEAD_EXISTS");

    const anonymousQueue = await app.inject({ method: "GET", url: "/v1/admin/partner-leads" });
    assert.equal(anonymousQueue.statusCode, 401);

    const login = async (email: string) => {
      const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { login: email, password } });
      assert.equal(response.statusCode, 200);
      return { authorization: `Bearer ${response.json().accessToken as string}` };
    };
    const clientHeaders = await login("leads.client@rooms.test");
    const clientQueue = await app.inject({ method: "GET", url: "/v1/admin/partner-leads", headers: clientHeaders });
    assert.equal(clientQueue.statusCode, 403);

    const adminHeaders = await login("leads.admin@rooms.test");
    const queue = await app.inject({ method: "GET", url: "/v1/admin/partner-leads?status=all&limit=80", headers: adminHeaders });
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.headers["cache-control"], "no-store");
    assert.equal(queue.json()[0].contactEmail, payload.contactEmail);
    assert.equal(queue.json()[0].contactPhone, "+79000001122");

    const review = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${leadId}`,
      headers: adminHeaders,
      payload: { status: "review" },
    });
    assert.equal(review.statusCode, 200);
    assert.equal(review.json().status, "review");

    const approved = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${leadId}`,
      headers: adminHeaders,
      payload: { status: "approved", comment: "Контакты подтверждены" },
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().reviewedBy, adminId);
    assert.equal(approved.json().status, "approved");

    const changedFinalDecision = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${leadId}`,
      headers: adminHeaders,
      payload: { status: "rejected", comment: "Попытка изменить решение" },
    });
    assert.equal(changedFinalDecision.statusCode, 409);
    assert.equal(changedFinalDecision.json().code, "PARTNER_LEAD_STATE_CHANGED");

    const secondPayload = { ...payload, contactEmail: "second@loft-test.ru", contactPhone: "+7 900 000-22-33" };
    const second = await app.inject({ method: "POST", url: "/v1/partner-leads", payload: secondPayload });
    assert.equal(second.statusCode, 201);
    const rejectionWithoutReason = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${second.json().id as string}`,
      headers: adminHeaders,
      payload: { status: "rejected" },
    });
    assert.equal(rejectionWithoutReason.statusCode, 400);
    assert.equal(rejectionWithoutReason.json().code, "PARTNER_LEAD_REJECTION_REASON_REQUIRED");
    const rejected = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${second.json().id as string}`,
      headers: adminHeaders,
      payload: { status: "rejected", comment: "Контакты площадки не подтвердились" },
    });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().status, "rejected");
    const resubmitted = await app.inject({ method: "POST", url: "/v1/partner-leads", payload: secondPayload });
    assert.equal(resubmitted.statusCode, 201);
  } finally {
    await app.close();
  }
});
