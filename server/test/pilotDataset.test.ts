import assert from "node:assert/strict";
import test from "node:test";
import {
  importPilotDataset,
  pilotDatasetMarkdown,
  PilotDatasetValidationError,
} from "../src/pilotDataset.js";

const rooms = `venue_code,room_code,city,venue_type,room_type,capacity_min,capacity_max,opens_at,closes_at,start_step_minutes,minimum_duration_minutes,buffer_before_minutes,buffer_after_minutes,price_per_hour_rub,can_combine_with_room_codes
V001,R001,Voronezh,karaoke,karaoke_room,2,12,12:00,02:00,15,120,15,15,2000,R002
V001,R002,Voronezh,karaoke,lounge,2,8,12:00,02:00,30,120,15,15,1600,R001
`;
const blocks = `block_code,venue_code,room_code,event_date,starts_at,duration_minutes,block_type,recorded_at,released_at
B0001,V001,R001,2026-09-15,16:00,120,confirmed,2026-09-01T11:30:00+03:00,
`;
const requests = `request_code,venue_code,room_codes,event_date,preferred_start,duration_minutes,guest_count,request_source,created_at,first_response_at,exact_start_available,offered_start,offered_duration_minutes,alternative_accepted,final_status,decline_reason_category,confirmed_at,selected_start,selected_duration_minutes,actual_visit
Q0001,V001,R001|R002,2026-09-15,18:00,180,8,phone,2026-09-01T12:00:00+03:00,2026-09-01T12:08:00+03:00,false,19:00,180,true,confirmed,,2026-09-01T12:12:00+03:00,19:00,180,unknown
`;

test("imports a linked anonymized pilot dataset and produces a stable hash", () => {
  const first = importPilotDataset({ rooms, blocks, requests });
  const second = importPilotDataset({ rooms, blocks, requests });
  assert.equal(first.datasetHash, second.datasetHash);
  assert.equal(first.summary.venueCount, 1);
  assert.equal(first.summary.roomCount, 2);
  assert.equal(first.summary.alternativesAccepted, 1);
  assert.equal(first.summary.medianFirstResponseMinutes, 8);
  assert.equal(first.summary.privacyFindings, 0);
  assert.match(pilotDatasetMarkdown(first), /не заменяет ручную проверку/u);
});

test("rejects columns and values that look like personal data", () => {
  const unsafeRooms = rooms
    .replace("city,venue_type", "client_phone,city,venue_type")
    .replace("V001,R001,Voronezh", "V001,R001,+79095557465,Voronezh")
    .replace("V001,R002,Voronezh", "V001,R002,,Voronezh");
  assert.throws(
    () => importPilotDataset({ rooms: unsafeRooms, blocks, requests }),
    (error: unknown) => error instanceof PilotDatasetValidationError
      && error.issues.some((issue) => issue.column === "client_phone")
      && error.issues.some((issue) => issue.message.includes("телефон")),
  );
  const unsafeRequests = requests.replace("Q0001,V001", "=SUM(1),V001");
  assert.throws(
    () => importPilotDataset({ rooms, blocks, requests: unsafeRequests }),
    (error: unknown) => error instanceof PilotDatasetValidationError
      && error.issues.some((issue) => issue.message.includes("формулы")),
  );
});

test("rejects unknown rooms and intervals outside opening hours", () => {
  const badBlocks = blocks
    .replace("B0001,V001,R001", "B0001,V001,R999")
    .concat("B0002,V001,R002,2026-09-15,03:00,120,manual,2026-09-01T11:30:00+03:00,\n");
  assert.throws(
    () => importPilotDataset({ rooms, blocks: badBlocks, requests }),
    (error: unknown) => error instanceof PilotDatasetValidationError
      && error.issues.some((issue) => issue.message.includes("Неизвестное помещение R999"))
      && error.issues.some((issue) => issue.message.includes("рабочие часы")),
  );
});

test("rejects an impossible block lifecycle and empty research requests", () => {
  const badLifecycle = blocks.replace(",2026-09-01T11:30:00+03:00,", ",2026-09-01T11:30:00+03:00,2026-09-01T10:30:00+03:00");
  const emptyRequests = requests.split("\n")[0] ?? "";
  assert.throws(
    () => importPilotDataset({ rooms, blocks: badLifecycle, requests: emptyRequests }),
    (error: unknown) => error instanceof PilotDatasetValidationError
      && error.issues.some((issue) => issue.column === "released_at")
      && error.issues.some((issue) => issue.message.includes("хотя бы одна строка запроса")),
  );
});
