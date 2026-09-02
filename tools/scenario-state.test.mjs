import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScenarioToState,
  normalizeInteraction,
  parseSnes9xState,
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
  assert.equal(ram.readUInt16LE(WRAM.robotAvailability), 0x8005);
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
