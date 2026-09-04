import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVENTION_MACHINE_FUNCTIONS,
  MAIN_MENU_FUNCTIONS,
  MENU_SUITE_CASES,
} from "./menu-suite-cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function json(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function numeric(value) {
  if (typeof value === "number") return value;
  if (value.startsWith("0x")) return Number.parseInt(value.slice(2), 16);
  if (value.startsWith("$")) return Number.parseInt(value.slice(1), 16);
  return Number.parseInt(value, 10);
}

test("fully populated fixture contains 70 items, three robots, and every invention bit", () => {
  const fixture = json("scenarios/menu-suite-populated.json");
  const itemCount = fixture.inventory.items.reduce((total, item) =>
    total + (typeof item === "object" ? item.quantity ?? 1 : 1), 0);
  assert.equal(itemCount, 70);
  assert.deepEqual(fixture.party.robots, [1, 2, 3]);
  assert.deepEqual(fixture.party.order, [1, 2, 3]);
  assert.equal(fixture.money, 99999);
  assert.equal(fixture.player.level, 99);

  const writes = new Map(fixture.wram.map((write) => [numeric(write.address), numeric(write.value)]));
  assert.equal(writes.get(0x05fa), 3, "main-menu state should be primed");
  for (let address = 0x07b0; address <= 0x07be; address += 2) {
    assert.equal(writes.get(address), 0xffff, `known inventions at $${address.toString(16)}`);
  }
});

test("robot-build fixture starts before first construction and targets slot one", () => {
  const fixture = json("scenarios/invention-machine-build.json");
  assert.deepEqual(fixture.party.robots, []);
  assert.equal(fixture.flags.firstRobotCreated, false);
  assert.equal(fixture.flags.machineUsed, false);
  assert.ok(fixture.wram.some((write) => numeric(write.address) === 0x0672 && numeric(write.value) === 1));
});

test("menu schedules have unique deterministic captures and complete feature coverage", () => {
  const caseIds = MENU_SUITE_CASES.map(({ id }) => id);
  assert.equal(new Set(caseIds).size, caseIds.length, "case IDs must be unique");
  const captures = MENU_SUITE_CASES.flatMap((entry) => entry.captures);
  const captureIds = captures.map(({ id }) => id);
  assert.equal(new Set(captureIds).size, captureIds.length, "capture IDs must be unique");
  assert.ok(captures.length >= 25, "suite should retain broad visual coverage");

  for (const entry of MENU_SUITE_CASES) {
    assert.ok(Number.isInteger(entry.frames) && entry.frames > 0, `${entry.id} frames`);
    assert.ok(Number.isInteger(entry.snapshotEvery) && entry.snapshotEvery > 0, `${entry.id} snapshotEvery`);
    for (const capture of entry.captures) {
      assert.ok(capture.frame <= entry.frames, `${capture.id} must occur during its case`);
      assert.equal(capture.frame % entry.snapshotEvery, 0, `${capture.id} must land on a snapshot frame`);
    }
  }

  const machine = new Set(MENU_SUITE_CASES
    .filter(({ group }) => group === "Invention Machine" || group === "Build a Robot")
    .map(({ feature }) => feature));
  const main = new Set(MENU_SUITE_CASES
    .filter(({ group }) => group === "Main Menu")
    .map(({ feature }) => feature));
  for (const feature of INVENTION_MACHINE_FUNCTIONS) {
    assert.ok(machine.has(feature), `missing Invention Machine coverage for ${feature}`);
  }
  for (const feature of MAIN_MENU_FUNCTIONS) {
    assert.ok(main.has(feature), `missing main-menu coverage for ${feature}`);
  }
});

test("checked-in screenshot baselines cover every visual capture", () => {
  const baselines = json("scenarios/menu-suite-baselines.json");
  assert.equal(baselines.version, 1);
  const expected = MENU_SUITE_CASES.flatMap((entry) => entry.captures.map(({ id }) => id)).sort();
  assert.deepEqual(Object.keys(baselines.captures).sort(), expected);
  for (const [id, baseline] of Object.entries(baselines.captures)) {
    assert.equal(baseline.width, 256, id);
    assert.equal(baseline.height, 224, id);
    assert.match(baseline.rgbSha256, /^[0-9a-f]{64}$/, id);
  }
});
