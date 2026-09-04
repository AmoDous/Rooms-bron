import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotBenchmarkReport, pilotBenchmarkMarkdown } from "../src/pilotBenchmark.js";
import { importPilotDataset } from "../src/pilotDataset.js";

const rooms = `venue_code,room_code,city,venue_type,room_type,capacity_min,capacity_max,opens_at,closes_at,start_step_minutes,minimum_duration_minutes,buffer_before_minutes,buffer_after_minutes,price_per_hour_rub,can_combine_with_room_codes
V001,R001,Voronezh,karaoke,karaoke_room,2,12,12:00,02:00,15,120,15,15,2000,
`;
const requests = `request_code,venue_code,room_codes,event_date,preferred_start,duration_minutes,guest_count,request_source,created_at,first_response_at,exact_start_available,offered_start,offered_duration_minutes,alternative_accepted,final_status,decline_reason_category,confirmed_at,selected_start,selected_duration_minutes,actual_visit
Q0001,V001,R001,2026-09-15,18:00,180,8,phone,2026-09-01T12:00:00+03:00,2026-09-01T12:08:00+03:00,false,19:00,180,true,confirmed,,2026-09-01T12:12:00+03:00,19:00,180,unknown
`;

test("pilot benchmark reconstructs only occupancy known when the request arrived", () => {
  const blocks = `block_code,venue_code,room_code,event_date,starts_at,duration_minutes,block_type,recorded_at,released_at
B_ACTIVE,V001,R001,2026-09-15,16:00,120,confirmed,2026-09-01T11:30:00+03:00,
B_FUTURE,V001,R001,2026-09-15,12:00,120,manual,2026-09-01T12:30:00+03:00,
B_RELEASED,V001,R001,2026-09-15,13:00,120,hold,2026-09-01T10:00:00+03:00,2026-09-01T11:00:00+03:00
`;
  const dataset = importPilotDataset({ rooms, blocks, requests });
  const report = buildPilotBenchmarkReport(dataset);
  assert.equal(report.scenarioCount, 1);
  assert.equal(report.futureBlockComparisonsIgnored, 1);
  assert.equal(report.releasedBlockComparisonsIgnored, 1);
  assert.equal(report.reconstructedAvailabilityAgreementRate, 1);
  assert.equal(report.strategies[1]?.meanAbsoluteShiftMinutes, 30);
  assert.match(pilotBenchmarkMarkdown(report), /будущие блоки не учитываются/u);
});

test("pilot benchmark excludes requests that exceed combined capacity", () => {
  const blocks = `block_code,venue_code,room_code,event_date,starts_at,duration_minutes,block_type,recorded_at,released_at
`;
  const crowded = requests.replace(",180,8,phone", ",180,80,phone").replace(",false,19:00", ",true,19:00");
  const report = buildPilotBenchmarkReport(importPilotDataset({ rooms, blocks, requests: crowded }));
  assert.equal(report.capacityEligibleScenarios, 0);
  assert.equal(report.capacityExcludedScenarios, 1);
  assert.equal(report.strategies[0]?.selectedScenarios, 0);
});
