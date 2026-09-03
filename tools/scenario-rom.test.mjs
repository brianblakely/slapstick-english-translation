import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioRom } from "./scenario-rom.mjs";
import { ScenarioError, WRAM } from "./scenario-state.mjs";

const NEW_GAME_INITIALIZER = 0x04cb0b;
const BOOT_INITIAL_MAP_OPERAND = 0x0085dc;
const AUTOBOOT_ACTOR = 0x04e705;
const ORIGINAL_NEW_GAME_INITIALIZER = Buffer.from(
  "8bdaa20000bf46cb84300ea8bf48cb84990000e8e8e8e880ece220a97e48abc220" +
    "a20000bf90cb84300ea8bf92cb84990000e8e8e8e880ecfaab6b",
  "hex",
);
const ORIGINAL_BOOT_INITIAL_MAP = Buffer.from(
  "c1018ca6058ca805a002008cac0522ff8280",
  "hex",
);
const ORIGINAL_AUTOBOOT_ACTOR = Buffer.from(
  "02aa26e78402d07800a93f2f8d6e059c60050238c0d0021805000001000002b26b",
  "hex",
);

function romFixture() {
  const rom = Buffer.alloc(0x200000, 0xff);
  ORIGINAL_NEW_GAME_INITIALIZER.copy(rom, NEW_GAME_INITIALIZER);
  ORIGINAL_BOOT_INITIAL_MAP.copy(rom, BOOT_INITIAL_MAP_OPERAND);
  ORIGINAL_AUTOBOOT_ACTOR.copy(rom, AUTOBOOT_ACTOR);
  return rom;
}

const catalog = {
  maps: { "research-lab": 12 },
  flags: { robotBookRead: 0x19, nagisaIntroducedMachine: 0x1b, machineUsed: 0x1b8 },
  partyMembers: { "companion-1": 0x4c },
  items: { transceiver: 0x49, "quick-fix": 0x75 },
};

test("generates a checksummed ROM with a one-shot new-game initializer", () => {
  const source = romFixture();
  const generated = createScenarioRom(
    source,
    {
      name: "rom-example",
      checkpoint: "unused-for-rom-output",
      map: "research-lab",
      position: { x: 128, y: 144, direction: "up" },
      flags: {
        robotBookRead: true,
        nagisaIntroducedMachine: true,
        machineUsed: false,
      },
      inventory: { equipped: "transceiver", items: ["quick-fix"] },
      party: {
        members: ["companion-1"],
        robots: [1, 3],
        activeRobot: 3,
        order: [3, 1, 2],
      },
    },
    catalog,
  );

  assert.equal(source[NEW_GAME_INITIALIZER], 0x8b, "source buffer is not mutated");
  assert.equal(generated.rom[NEW_GAME_INITIALIZER], 0x5c);
  assert.equal(generated.rom[NEW_GAME_INITIALIZER + 4], 0xea);
  assert.equal(generated.rom.readUInt16LE(BOOT_INITIAL_MAP_OPERAND), 4);
  assert.equal(generated.rom[AUTOBOOT_ACTOR], 0x5c);
  assert.equal(generated.initializerAddress, 0xdf0000);
  assert.equal(generated.initializerOffset, 0x1f0000);
  assert.equal(generated.autobootOffset, generated.initializerOffset + generated.initializerSize);
  assert.equal(
    generated.rom.readUIntLE(AUTOBOOT_ACTOR + 1, 3),
    generated.autobootAddress,
  );
  assert.equal(
    generated.rom.readUIntLE(NEW_GAME_INITIALIZER + 1, 3),
    generated.initializerAddress,
  );
  assert.deepEqual(
    generated.rom.subarray(
      generated.initializerOffset,
      generated.initializerOffset + ORIGINAL_NEW_GAME_INITIALIZER.length - 1,
    ),
    ORIGINAL_NEW_GAME_INITIALIZER.subarray(0, -1),
  );

  const writes = new Map(generated.writes.map((write) => [write.address, write]));
  assert.equal(writes.get(WRAM.currentMap).value, 12);
  assert.equal(writes.get(WRAM.currentMapTimesTwo).value, 24);
  assert.equal(writes.get(WRAM.playerX).value, 128);
  assert.equal(writes.get(WRAM.playerY).value, 144);
  assert.equal(writes.get(WRAM.playerDirection).value, 1);
  assert.equal(writes.get(WRAM.eventFlags + 3).value, 0x0a);
  assert.equal(writes.get(WRAM.eventFlags + 3).width, 1);
  assert.equal(writes.has(WRAM.eventFlags + (0x1b8 >>> 3)), false);
  assert.equal(writes.get(WRAM.inventory).value, 0x49);
  assert.equal(writes.get(WRAM.inventory + 2).value, 0x75);
  assert.equal(writes.get(WRAM.partyMemberA).value, 0x4c);
  assert.equal(writes.get(WRAM.robotAvailability).value, 0x0505);
  assert.equal(writes.get(WRAM.activeRobot).value, 6);
  assert.deepEqual(
    [0, 1, 2].map((index) => writes.get(WRAM.battleOrder + index * 2).value),
    [3, 1, 2],
  );

  const marker = Buffer.from("SLAPSCN\0rom-example\0", "ascii");
  assert.notEqual(
    generated.rom.indexOf(marker, generated.initializerOffset),
    -1,
  );
  const checksum = generated.rom.readUInt16LE(0xffde);
  const complement = generated.rom.readUInt16LE(0xffdc);
  let sum = 0;
  for (const byte of generated.rom) sum = (sum + byte) & 0xffff;
  assert.equal(checksum ^ complement, 0xffff);
  assert.equal(sum, checksum);
});

test("rejects the wrong ROM revision and size", () => {
  const scenario = { name: "bad-rom", checkpoint: "unused" };
  assert.throws(
    () => createScenarioRom(Buffer.alloc(10), scenario, catalog),
    ScenarioError,
  );
  const rom = romFixture();
  rom[NEW_GAME_INITIALIZER] ^= 0xff;
  assert.throws(
    () => createScenarioRom(rom, scenario, catalog),
    /expected new-game initializer/,
  );
});

test("uses a non-recursive autoboot wrapper when the title map is the target", () => {
  const generated = createScenarioRom(
    romFixture(),
    { name: "title", map: 4 },
    catalog,
  );
  assert.equal(generated.autobootSize, 17);
  assert.deepEqual(
    generated.rom.subarray(generated.autobootOffset + 13, generated.autobootOffset + 17),
    Buffer.from([0x5c, 0x0a, 0xe7, 0xc4]),
  );
});
