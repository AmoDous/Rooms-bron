import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGrantBenchmarkReport,
  evaluateGrantScenario,
  grantBenchmarkScenarios,
} from "../src/grantBenchmark.js";

test("grant benchmark contains 120 unique synthetic scenarios", () => {
  const scenarios = grantBenchmarkScenarios();
  assert.equal(scenarios.length, 120);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 120);
  assert.ok(scenarios.some((scenario) => scenario.rooms.length === 3));
  assert.ok(scenarios.every((scenario) => scenario.rooms.every((room) => room.title.startsWith("Тестовое"))));
});

test("baseline report is explicitly synthetic and compares equal feasibility", () => {
  const report = buildGrantBenchmarkReport();
  const first = report.strategies.find((strategy) => strategy.strategy === "first_available");
  const nearest = report.strategies.find((strategy) => strategy.strategy === "preferred_nearest");
  const rooms = report.strategies.find((strategy) => strategy.strategy === "rooms_multicriteria_v1");
  assert.equal(report.dataSource, "synthetic");
  assert.ok(report.feasibleScenarios > 0);
  assert.ok(report.infeasibleScenarios > 0);
  assert.equal(first?.selectedScenarios, nearest?.selectedScenarios);
  assert.equal(first?.selectedScenarios, rooms?.selectedScenarios);
  assert.ok((nearest?.exactSelectionRate ?? 0) > (first?.exactSelectionRate ?? 0));
  assert.ok((nearest?.meanAbsoluteShiftMinutes ?? Infinity) < (first?.meanAbsoluteShiftMinutes ?? 0));
  assert.ok(report.experimentalComparison.addedOrphanedReductionRate > 0);
  assert.ok(report.experimentalComparison.meanShiftDifferenceMinutes < 5);
});

test("experimental Rooms strategy is deterministic and measured separately", () => {
  const first = buildGrantBenchmarkReport().strategies.find((strategy) => strategy.strategy === "rooms_multicriteria_v1");
  const second = buildGrantBenchmarkReport().strategies.find((strategy) => strategy.strategy === "rooms_multicriteria_v1");
  assert.deepEqual(first, second);
  assert.ok((first?.selectedScenarios ?? 0) > 0);
});

test("fragmentation metric distinguishes two simple baseline choices", () => {
  const scenario = grantBenchmarkScenarios().find((item) => item.id === "split-midday-1500-120");
  assert.ok(scenario);
  const first = evaluateGrantScenario(scenario, "first_available");
  const nearest = evaluateGrantScenario(scenario, "preferred_nearest");
  assert.match(first.selectedStartsAt ?? "", /T10:00:00/u);
  assert.match(nearest.selectedStartsAt ?? "", /T15:00:00/u);
  assert.equal(first.addedOrphanedMinutes, 60);
  assert.equal(nearest.addedOrphanedMinutes, 0);
});
