import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyScenarioToNewGameRam,
  applyBattleEntryToState,
  applyScenarioToState,
  normalizeInteraction,
  normalizeSteps,
  parseSnes9xState,
  resolveBattleEntry,
  ScenarioError,
  WRAM,
} from "./scenario-state.mjs";

function section(tag, data) {
  return Buffer.concat([
    Buffer.from(`${tag}:${String(data.length).padStart(6, "0")}:`, "ascii"),
    data,
  ]);
}

function stateFixture(map = 12) {
  const ram = Buffer.alloc(0x20000);
  ram.writeUInt16LE(map, WRAM.currentMap);
  ram.writeUInt16LE(map * 2, WRAM.currentMapTimesTwo);
  ram.writeUInt16LE(0x1000, WRAM.playerActorSlot);
  ram.writeUInt16LE(0x8000, WRAM.robotAvailability);
  ram.writeUInt16LE(0x0087, WRAM.inventory + 71 * 2);
  const name = Buffer.from("fixture\0");
  const sram = Buffer.from([1, 2, 3, 4]);
  const magic = Buffer.from("#!s9xsnp:0014\n", "ascii");
  const state = Buffer.concat([
    magic,
    section("NAM", name),
    section("RAM", ram),
    section("SRA", sram),
  ]);
  const ramStart = magic.length + 11 + name.length + 11;
  return { ram: state.subarray(ramStart, ramStart + ram.length), sram, state };
}

const catalog = {
  maps: { "research-lab": 12 },
  flags: { robotBookRead: 0x19, machineUsed: 0x1b8 },
  partyMembers: { "companion-1": 0x4c },
  items: { transceiver: 0x49, "quick-fix": 0x75, "scrap-a": 0x66 },
};

const projectCatalog = JSON.parse(
  readFileSync(new URL("../scenarios/catalog.json", import.meta.url), "utf8"),
);

test("parses Snes9x sections without changing unrelated data", () => {
  const fixture = stateFixture();
  const parsed = parseSnes9xState(fixture.state);
  assert.deepEqual(parsed.sections.map(({ tag }) => tag), ["NAM", "RAM", "SRA"]);
  assert.equal(parsed.ram.length, 0x20000);
  assert.deepEqual(parsed.state.subarray(parsed.sections[2].dataStart), fixture.sram);
});

test("applies position, flags, inventory, and party state", () => {
  const fixture = stateFixture();
  const machineFlagOffset = WRAM.eventFlags + (0x1b8 >>> 3);
  fixture.ram[machineFlagOffset] |= 1 << (0x1b8 & 7);
  const result = applyScenarioToState(
    fixture.state,
    {
      name: "complete-example",
      checkpoint: "fixture",
      map: "research_lab",
      money: 99999,
      position: { x: 120, y: 88, direction: "right" },
      flags: { robotBookRead: true, machineUsed: false },
      inventory: {
        items: ["quick-fix", { item: "scrap-a", quantity: 2, level: 3 }],
        equipped: "transceiver",
      },
      party: {
        members: ["companion-1", "0x4d"],
        robots: [1, 3],
        active: 3,
        order: [3, 1, 2],
      },
    },
    catalog,
  );
  const { ram } = parseSnes9xState(result.state);

  assert.equal(ram.readUInt16LE(WRAM.playerX), 120);
  assert.equal(ram.readUInt16LE(WRAM.playerY), 88);
  assert.equal(ram.readUInt16LE(WRAM.playerTileX), 7);
  assert.equal(ram.readUInt16LE(WRAM.playerTileY), 5);
  assert.equal(ram.readUInt16LE(WRAM.playerSnappedX), 112);
  assert.equal(ram.readUInt16LE(WRAM.playerSnappedY), 80);
  assert.equal(ram.readUInt16LE(0x1000), 128);
  assert.equal(ram.readUInt16LE(0x1002), 104);
  assert.equal(ram.readUInt16LE(WRAM.playerDirection), 3);
  assert.equal(ram.readUInt16LE(0x100c), 3);
  assert.deepEqual([...ram.subarray(WRAM.money, WRAM.money + 3)], [0x99, 0x99, 0x09]);

  assert.equal((ram[WRAM.eventFlags + (0x19 >>> 3)] & (1 << (0x19 & 7))) !== 0, true);
  assert.equal((ram[machineFlagOffset] & (1 << (0x1b8 & 7))) !== 0, false);

  assert.equal(ram.readUInt16LE(WRAM.inventory), 0x49);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 2), 0x75);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 4), 0x0366);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 6), 0x0366);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 8), 0);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 71 * 2), 0x0087);

  assert.equal(ram.readUInt16LE(WRAM.partyMemberA), 0x4c);
  assert.equal(ram.readUInt16LE(WRAM.partyMemberB), 0x4d);
  assert.equal(ram.readUInt16LE(WRAM.robotAvailability), 0x8505);
  assert.equal(ram.readUInt16LE(WRAM.activeRobot), 6);
  assert.deepEqual(
    [0, 1, 2].map((index) => ram.readUInt16LE(WRAM.battleOrder + index * 2)),
    [3, 1, 2],
  );
  assert.ok(result.changes.length > 10);
});

test("merge inventory fills empty slots without replacing existing items", () => {
  const fixture = stateFixture();
  fixture.ram.writeUInt16LE(1, WRAM.inventory + 2);
  fixture.ram.writeUInt16LE(2, WRAM.inventory + 6);
  const result = applyScenarioToState(
    fixture.state,
    {
      name: "merge-example",
      checkpoint: "fixture",
      map: 12,
      inventory: { mode: "merge", items: ["quick-fix", "scrap-a"] },
    },
    catalog,
  );
  const { ram } = parseSnes9xState(result.state);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 2), 1);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 4), 0x75);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 6), 2);
  assert.equal(ram.readUInt16LE(WRAM.inventory + 8), 0x66);
});

test("rejects a checkpoint captured on a different map", () => {
  const fixture = stateFixture(11);
  assert.throws(
    () => applyScenarioToState(
      fixture.state,
      { name: "wrong-map", checkpoint: "fixture", map: "research-lab" },
      catalog,
    ),
    /stale tiles, actors, and scripts/,
  );
});

test("rejects malformed states and scenario typos", () => {
  assert.throws(() => parseSnes9xState(Buffer.from("not a state")), ScenarioError);
  const fixture = stateFixture();
  assert.throws(
    () => applyScenarioToState(
      fixture.state,
      { name: "too-much-money", checkpoint: "fixture", money: 100000 },
      catalog,
    ),
    /money must be an integer from 0 through 99999/,
  );
  assert.throws(
    () => applyScenarioToState(
      fixture.state,
      { name: "typo", checkpoint: "fixture", flgas: {} },
      catalog,
    ),
    /Unknown scenario field/,
  );
  assert.throws(
    () => applyScenarioToState(
      fixture.state,
      {
        name: "ambiguous-equipped-item",
        checkpoint: "fixture",
        inventory: { equipped: { item: "quick-fix", quantity: 2 } },
      },
      catalog,
    ),
    /exactly one item/,
  );
  assert.throws(
    () => applyScenarioToState(
      fixture.state,
      { name: "future-catalog", checkpoint: "fixture" },
      { ...catalog, version: 2 },
    ),
    /catalog version/,
  );
  assert.throws(
    () => applyScenarioToNewGameRam({ name: "null-player", player: null }),
    /player must be an object/,
  );
});

test("normalizes shorthand interactions", () => {
  assert.deepEqual(normalizeInteraction("a"), {
    button: "a",
    delayFrames: 1,
    holdFrames: 1,
    afterFrames: 2,
  });
  assert.equal(normalizeInteraction(false), undefined);
});

test("builds a checkpoint-free new-game state with a deterministic player name", () => {
  const result = applyScenarioToNewGameRam(
    {
      name: "checkpoint-free",
      map: "research-lab",
      wram: [{ address: "0x1234", width: 1, value: "0x5a" }],
    },
    catalog,
  );
  assert.equal(result.ram.readUInt16LE(WRAM.currentMap), 12);
  assert.equal(result.ram[0x1234], 0x5a);
  assert.deepEqual(
    [...result.ram.subarray(WRAM.playerNameDialogue, WRAM.playerNameDialogue + 7)],
    [0x32, 0xd4, 0x21, 0x33, 0x2b, 0xd5, 0xcc],
  );
  assert.deepEqual(
    [...result.ram.subarray(WRAM.playerNameMenu, WRAM.playerNameMenu + 6)],
    [0x32, 0xa1, 0xb3, 0xab, 0x20, 0x00],
  );
  assert.equal(result.launch.settleFrames, 120);
});

test("keeps the default name when only a player level is supplied", () => {
  const result = applyScenarioToNewGameRam({
    name: "leveled-party",
    player: { level: 12 },
    party: { robots: [1, 3], activeRobot: 1 },
  });
  assert.deepEqual(
    [...result.ram.subarray(WRAM.playerNameMenu, WRAM.playerNameMenu + 6)],
    [0x32, 0xa1, 0xb3, 0xab, 0x20, 0x00],
  );
  assert.equal(result.ram.readUInt16LE(WRAM.level), 12);
  assert.equal(result.ram.readUInt16LE(WRAM.statBudget), 150);
  assert.equal(result.ram.readUInt16LE(WRAM.robotAvailability), 0x0505);
  assert.equal(result.ram.readUInt16LE(WRAM.activeRobot), 2);
  for (const robot of [1, 3]) {
    const index = robot * 2;
    assert.equal(result.ram.readUInt16LE(0x0688 + index), 150);
    assert.equal(result.ram.readUInt16LE(0x068e + index), 150);
    assert.equal(result.ram.readUInt16LE(0x06c4 + index), 0x0101);
    assert.equal(result.ram.readUInt16LE(0x06ca + index), 0x0118);
    assert.equal(result.ram.readUInt16LE(0x06d0 + index), 0x011e);
    assert.equal(result.ram.readUInt16LE(0x06d6 + index), 0x002d);
  }
});

test("selects the first enabled robot when a checkpoint-free party omits activeRobot", () => {
  const result = applyScenarioToNewGameRam({
    name: "implicit-active-robot",
    party: { robots: [2, 3] },
  });
  assert.equal(result.ram.readUInt16LE(WRAM.activeRobot), 4);
});

test("accepts every ROM map-table index and rejects values beyond it", () => {
  assert.equal(
    applyScenarioToNewGameRam({ name: "last-map", map: 0x01f3 }).currentMap,
    0x01f3,
  );
  assert.throws(
    () => applyScenarioToNewGameRam({ name: "past-map-table", map: 0x01f4 }),
    /map must be an integer from 0 through 499/,
  );
});

test("resolves early, late, and special scenes from the project catalog", () => {
  const expected = new Map([
    ["title-screen", 4],
    ["chicken-farm", 113],
    ["fortress-tetron-lair", 286],
    ["final-dungeon", 355],
    ["final-boss-room", 371],
    ["credits-fortress", 458],
  ]);
  for (const [map, id] of expected) {
    const result = applyScenarioToNewGameRam({ name: `catalog-${id}`, map }, projectCatalog);
    assert.equal(result.currentMap, id);
  }
  assert.ok(Object.keys(projectCatalog.maps).length >= 375);
});

test("normalizes ordered runtime steps", () => {
  assert.deepEqual(normalizeSteps(["a", { waitFrames: 12 }, { button: "down", afterFrames: 5 }]), [
    { button: "a", delayFrames: 1, holdFrames: 1, afterFrames: 2 },
    { waitFrames: 12 },
    { button: "down", delayFrames: 1, holdFrames: 1, afterFrames: 5 },
  ]);
});

test("captures command-ready battles immediately but lets loaded battles settle", () => {
  const command = applyScenarioToNewGameRam({
    name: "command-ready",
    entry: { type: "battle", encounter: 0 },
  });
  const loaded = applyScenarioToNewGameRam({
    name: "battle-loaded",
    entry: { type: "battle", encounter: 0, ready: "loaded" },
  });
  assert.equal(command.entry.settleFrames, 0);
  assert.equal(loaded.entry.settleFrames, 30);
});

test("models stock initializer defaults so raw zero overrides are emitted", () => {
  const result = applyScenarioToNewGameRam({
    name: "zero-stock-default",
    wram: [{ address: "0x0608", value: 0 }],
  });
  assert.equal(result.ram.readUInt16LE(0x0608), 0);
  assert.ok(result.changes.some(({ field, offset }) => field === "wram[0]" && offset === "0x0608"));
});

test("prepares a direct battle through the stock field transition", () => {
  const fixture = stateFixture(28);
  fixture.ram.writeUInt16LE(0x0101, WRAM.robotAvailability);
  const rom = Buffer.alloc(0x200000);
  rom.writeUInt16LE(0x01cc, 0x01ad3b + 28 * 2);
  rom.writeUInt16LE(0x9000, 0x038000 + 5 * 2);
  const result = applyBattleEntryToState(fixture.state, rom, {
    type: "battle",
    encounter: 5,
  });
  const { ram } = parseSnes9xState(result.state);
  assert.equal(result.battleMap, 0x01cc);
  assert.equal(ram.readUInt16LE(WRAM.battleReturnMap), 28);
  assert.equal(ram.readUInt16LE(WRAM.nextMap), 0x01cc);
  assert.equal(ram.readUInt16LE(WRAM.battleEncounter), 5);
  assert.equal(ram.readUInt16LE(WRAM.battleMode), 0x8000);
  assert.equal(ram.readUInt16LE(WRAM.task2Function), 0x84cb);
});

test("rejects fields and encounters without normal battle definitions", () => {
  const rom = Buffer.alloc(0x200000);
  assert.throws(() => resolveBattleEntry(rom, 0x01c2, 0), /no normal battle-map/);
  assert.throws(() => resolveBattleEntry(rom, 28, 0), /cannot start a normal encounter/);
  rom.writeUInt16LE(0x01cc, 0x01ad3b + 28 * 2);
  assert.throws(() => resolveBattleEntry(rom, 28, 0xb6), /has no ROM definition/);
});
