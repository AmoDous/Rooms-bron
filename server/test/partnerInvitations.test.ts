import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { hashPassword, MemoryAuthRepository } from "../src/auth.js";
import { MemoryNotificationRepository, NotificationCipher } from "../src/notifications.js";
import { MemoryPartnerLeadRepository } from "../src/partnerLeads.js";

test("approved partner lead activates a real one-time partner account", async () => {
  const staffPassword = "rooms-staff-2026";
  const staffPasswordHash = await hashPassword(staffPassword);
  const adminId = "72000000-0000-4000-8000-000000000001";
  const authRepository = new MemoryAuthRepository([
    {
      id: adminId,
      role: "admin",
      name: "Rooms Admin",
      email: "invite.admin@rooms.test",
      phone: "+79000000201",
      city: "Voronezh",
      passwordHash: staffPasswordHash,
      passwordResetRequired: false,
      blockedAt: null,
    },
    {
      id: "72000000-0000-4000-8000-000000000002",
      role: "client",
      name: "Rooms Client",
      email: "invite.client@rooms.test",
      phone: "+79000000202",
      city: "Voronezh",
      passwordHash: staffPasswordHash,
      passwordResetRequired: false,
      blockedAt: null,
    },
  ]);
  const partnerLeadRepository = new MemoryPartnerLeadRepository();
  const notificationRepository = new MemoryNotificationRepository();
  const notificationEncryptionKey = "rooms-partner-invitation-test-secret-2026";
  const app = buildApp({
    logger: false,
    publicSiteUrl: "https://example.test/rooms",
    authRepository,
    partnerLeadRepository,
    notificationRepository,
    notificationEncryptionKey,
  });
  await app.ready();

  const leadPayload = {
    city: "Voronezh",
    venueTitle: "Invite Loft",
    address: "Test street, 15",
    contactName: "Irina Manager",
    contactPhone: "+7 900 000-22-11",
    contactEmail: "manager@invite-loft.test",
    venueType: "Loft",
    roomCount: 2,
    comment: "Two rooms",
    legal: {
      termsVersion: "2026-07-23",
      privacyVersion: "2026-07-23",
      termsAccepted: true,
      privacyAccepted: true,
    },
  };
  const login = async (email: string, password: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: email, password },
    });
    return response;
  };

  try {
    const created = await app.inject({ method: "POST", url: "/v1/partner-leads", payload: leadPayload });
    assert.equal(created.statusCode, 201);
    const leadId = created.json().id as string;

    const adminLogin = await login("invite.admin@rooms.test", staffPassword);
    const clientLogin = await login("invite.client@rooms.test", staffPassword);
    assert.equal(adminLogin.statusCode, 200);
    assert.equal(clientLogin.statusCode, 200);
    const adminHeaders = { authorization: `Bearer ${adminLogin.json().accessToken as string}` };
    const clientHeaders = { authorization: `Bearer ${clientLogin.json().accessToken as string}` };

    const beforeApproval = await app.inject({
      method: "POST",
      url: `/v1/admin/partner-leads/${leadId}/invitations`,
      headers: adminHeaders,
    });
    assert.equal(beforeApproval.statusCode, 409);
    assert.equal(beforeApproval.json().code, "PARTNER_LEAD_NOT_APPROVED");

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/admin/partner-leads/${leadId}/invitations`,
      headers: clientHeaders,
    });
    assert.equal(forbidden.statusCode, 403);

    const approved = await app.inject({
      method: "PATCH",
      url: `/v1/admin/partner-leads/${leadId}`,
      headers: adminHeaders,
      payload: { status: "approved", comment: "Contacts verified" },
    });
    assert.equal(approved.statusCode, 200);

    const firstIssue = await app.inject({
      method: "POST",
      url: `/v1/admin/partner-leads/${leadId}/invitations`,
      headers: adminHeaders,
    });
    assert.equal(firstIssue.statusCode, 201);
    assert.equal(firstIssue.headers["cache-control"], "no-store");
    assert.equal("temporaryPassword" in firstIssue.json(), false);
    assert.equal(firstIssue.json().delivery.eventKey, "partner_invitation_created");
    assert.equal(firstIssue.json().delivery.status, "queued");
    assert.equal(firstIssue.json().delivery.userId, null);
    assert.notEqual(firstIssue.json().delivery.target, leadPayload.contactEmail);
    assert.match(firstIssue.json().delivery.target, /^ma\*+@invite-loft\.test$/u);
    const firstUrl = new URL(firstIssue.json().activationUrl as string);
    const firstToken = firstUrl.hash.replace("#partner-invite=", "");
    assert.equal(firstUrl.origin, "http://localhost");
    assert.equal(firstUrl.pathname, "/");
    assert.match(firstToken, /^[A-Za-z0-9_-]{40,100}$/u);
    const encryptedQueue = await notificationRepository.claimBatch(10);
    const encryptedInvitation = encryptedQueue.find((item) => item.eventKey === "partner_invitation_created");
    assert.ok(encryptedInvitation);
    assert.match(encryptedInvitation.body, /^enc:v1:/u);
    assert.doesNotMatch(encryptedInvitation.body, new RegExp(firstToken, "u"));
    assert.match(new NotificationCipher(notificationEncryptionKey).decrypt(encryptedInvitation.body), new RegExp(firstToken, "u"));

    const leadAfterFirstIssue = await app.inject({
      method: "GET",
      url: "/v1/admin/partner-leads?status=approved",
      headers: adminHeaders,
    });
    assert.equal(leadAfterFirstIssue.statusCode, 200);
    assert.equal(leadAfterFirstIssue.json()[0].invitation.id, firstIssue.json().invitationId);
    assert.equal(leadAfterFirstIssue.json()[0].invitation.consumedAt, null);

    const secondIssue = await app.inject({
      method: "POST",
      url: `/v1/admin/partner-leads/${leadId}/invitations`,
      headers: adminHeaders,
    });
    assert.equal(secondIssue.statusCode, 201);
    const secondToken = new URL(secondIssue.json().activationUrl as string).hash.replace("#partner-invite=", "");
    assert.notEqual(secondToken, firstToken);

    const leadAfterReissue = await app.inject({
      method: "GET",
      url: "/v1/admin/partner-leads?status=approved",
      headers: adminHeaders,
    });
    assert.equal(leadAfterReissue.statusCode, 200);
    assert.equal(leadAfterReissue.json()[0].invitation.id, secondIssue.json().invitationId);
    assert.equal(leadAfterReissue.json()[0].invitation.revokedAt, null);

    const notificationQueue = await app.inject({
      method: "GET",
      url: "/v1/admin/notification-deliveries?limit=20",
      headers: adminHeaders,
    });
    assert.equal(notificationQueue.statusCode, 200);
    const invitationDeliveries = notificationQueue.json().filter((item: { eventKey: string }) => item.eventKey === "partner_invitation_created");
    assert.equal(invitationDeliveries.length, 2);
    assert.equal(invitationDeliveries.every((item: { userId: string | null }) => item.userId === null), true);
    assert.doesNotMatch(notificationQueue.body, new RegExp(`${firstToken}|${secondToken}`, "u"));

    const revokedPreview = await app.inject({
      method: "POST",
      url: "/v1/auth/partner-invitations/preview",
      payload: { token: firstToken },
    });
    assert.equal(revokedPreview.statusCode, 410);

    const preview = await app.inject({
      method: "POST",
      url: "/v1/auth/partner-invitations/preview",
      payload: { token: secondToken },
    });
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(Object.keys(preview.json()).sort(), ["city", "contactName", "expiresAt", "venueTitle"]);
    assert.equal(preview.json().venueTitle, leadPayload.venueTitle);
    assert.doesNotMatch(preview.body, /manager@invite-loft\.test|\+79000002211/u);

    const weakPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/partner-invitations/accept",
      payload: {
        token: secondToken,
        password: "onlyletters",
        legal: leadPayload.legal,
      },
    });
    assert.equal(weakPassword.statusCode, 400);
    assert.equal(weakPassword.json().code, "WEAK_PASSWORD");

    const partnerPassword = "rooms-partner-2026";
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/auth/partner-invitations/accept",
      payload: {
        token: secondToken,
        password: partnerPassword,
        legal: leadPayload.legal,
      },
    });
    assert.equal(accepted.statusCode, 201);
    assert.equal(accepted.headers["cache-control"], "no-store");
    assert.equal(accepted.json().user.role, "partner");
    assert.equal(accepted.json().user.email, leadPayload.contactEmail);
    assert.equal(accepted.json().venue.title, leadPayload.venueTitle);
    assert.doesNotMatch(accepted.body, /passwordHash|refreshToken|rooms-partner-2026/u);

    const leadAfterActivation = await app.inject({
      method: "GET",
      url: "/v1/admin/partner-leads?status=approved",
      headers: adminHeaders,
    });
    assert.equal(leadAfterActivation.statusCode, 200);
    assert.equal(leadAfterActivation.json()[0].invitation.id, secondIssue.json().invitationId);
    assert.match(leadAfterActivation.json()[0].invitation.consumedAt, /^\d{4}-\d{2}-\d{2}T/u);

    const partnerHeaders = { authorization: `Bearer ${accepted.json().accessToken as string}` };
    const partnerVenue = await app.inject({
      method: "GET",
      url: "/v1/partner/venue",
      headers: partnerHeaders,
    });
    assert.equal(partnerVenue.statusCode, 200);
    assert.equal(partnerVenue.json().title, leadPayload.venueTitle);
    assert.equal(partnerVenue.json().publicationStatus, "review");

    const reused = await app.inject({
      method: "POST",
      url: "/v1/auth/partner-invitations/accept",
      payload: {
        token: secondToken,
        password: partnerPassword,
        legal: leadPayload.legal,
      },
    });
    assert.equal(reused.statusCode, 410);

    const wrongLogin = await login(leadPayload.contactEmail, "rooms-partner-2025");
    assert.equal(wrongLogin.statusCode, 401);
    const correctLogin = await login(leadPayload.contactEmail, partnerPassword);
    assert.equal(correctLogin.statusCode, 200);
    assert.equal(correctLogin.json().user.role, "partner");

    const issueAfterActivation = await app.inject({
      method: "POST",
      url: `/v1/admin/partner-leads/${leadId}/invitations`,
      headers: adminHeaders,
    });
    assert.equal(issueAfterActivation.statusCode, 409);
    assert.equal(issueAfterActivation.json().code, "PARTNER_ACCOUNT_EXISTS");
  } finally {
    await app.close();
  }
});
