import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningOracleReport,
  comparePlannerWithOracle,
  planningOracleScenarios,
} from "../src/planningOracle.js";
import type { Room } from "../src/types.js";

function nightRoom(): Room {
  return {
    id: "night",
    slug: "night",
    venueId: "venue-night",
    title: "Ночное помещение",
    subtitle: "test",
    type: "test",
    capacityMin: 1,
    capacityMax: 10,
    pricePerHour: 1500,
    minimumHours: 1,
    rating: 0,
    reviewCount: 0,
    description: "test",
    rules: "test",
    promotion: null,
    features: [],
    tags: [],
    photoPaths: [],
    services: [],
    opensAtHour: 20,
    closesAtHour: 26,
    bufferMinutes: 0,
    defaultBlocked: [[22, 23]],
    blockedByDate: {},
    publicationStatus: "published",
  };
}

test("independent oracle matches buffers, start grid and after-midnight windows", () => {
  const comparison = comparePlannerWithOracle({
    date: "2026-09-15",
    preferredTime: "01:00",
    durationMinutes: 60,
    guests: 4,
    roomSets: [{
      id: "night-set",
      rooms: [nightRoom()],
      stepMinutesByRoomId: { night: 15 },
      bookingBufferByRoomId: { night: { beforeMinutes: 15, afterMinutes: 30 } },
    }],
  });
  assert.equal(comparison.complete, true);
  assert.equal(comparison.plannerCandidateCount, comparison.oracleCandidateCount);
  assert.ok(comparison.oracleCandidateCount > 0);
});

test("oracle fixture generator is deterministic", () => {
  assert.deepEqual(planningOracleScenarios(5), planningOracleScenarios(5));
});

test("planner is complete against exhaustive enumeration on 300 synthetic scenarios", () => {
  const report = buildPlanningOracleReport();
  assert.equal(report.scenarioCount, 300);
  assert.equal(report.completeScenarios, 300);
  assert.equal(report.failedScenarios, 0);
  assert.equal(report.missingCandidateCount, 0);
  assert.equal(report.unexpectedCandidateCount, 0);
  assert.equal(report.plannerCandidateCount, report.oracleCandidateCount);
  assert.match(report.datasetHash, /^[a-f0-9]{64}$/u);
});
