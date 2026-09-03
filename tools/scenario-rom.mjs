import { applyScenarioToNewGameRam, ScenarioError } from "./scenario-state.mjs";

const ROM_SIZE = 0x200000;
const HEADER_CHECKSUM = 0xffdc;
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
const MARKER = "SLAPSCN\0";

function formatHex(value, width = 6) {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function pcToHiRomAddress(offset) {
  if (offset < 0 || offset >= 0x400000) {
    throw new ScenarioError(`Cannot map ROM offset ${formatHex(offset)} to a HiROM address`);
  }
  return ((0xc0 | (offset >>> 16)) << 16) | (offset & 0xffff);
}

function findInitializerSpace(rom, length) {
  if (length > 0x8000) throw new ScenarioError("Scenario initializer is too large for one ROM bank");

  // The translation stores text in each expansion bank's upper half. Search
  // the lower, code-addressable halves from DF backwards and never cross a
  // bank boundary.
  for (let bank = 0x1f; bank >= 0x18; bank -= 1) {
    const start = bank << 16;
    const end = start + 0x8000;
    let runStart = start;
    for (let cursor = start; cursor <= end; cursor += 1) {
      if (cursor < end && rom[cursor] === 0xff) continue;
      if (cursor - runStart >= length) return runStart;
      runStart = cursor + 1;
    }
  }
  throw new ScenarioError(`The translated ROM has no ${length}-byte code gap for this scenario`);
}

function compileWrites(applied) {
  const writes = new Map();
  for (const change of applied.changes) {
    const address = Number.parseInt(change.offset.slice(2), 16);
    const key = `${address}:${change.width}`;
    const prior = writes.get(key);
    writes.set(key, {
      address,
      width: change.width,
      value: change.width === 1
        ? applied.ram.readUInt8(address)
        : applied.ram.readUInt16LE(address),
      fields: [...(prior?.fields ?? []), change.field],
    });
  }
  return [...writes.values()].sort((left, right) => left.address - right.address);
}

function compileInitializer(originalRoutine, writes, scenarioName) {
  const chunks = [originalRoutine.subarray(0, -1)];
  const wordWrites = writes.filter(({ width }) => width === 2);
  const byteWrites = writes.filter(({ width }) => width === 1);

  // The stock initializer returns with a 16-bit accumulator. Long stores make
  // the injected code independent of the caller's data-bank register.
  for (const { address, value } of wordWrites) {
    chunks.push(Buffer.from([
      0xa9, value & 0xff, value >>> 8,
      0x8f, address & 0xff, address >>> 8, 0x7e,
    ]));
  }
  if (byteWrites.length) {
    chunks.push(Buffer.from([0xe2, 0x20])); // SEP #$20
    for (const { address, value } of byteWrites) {
      chunks.push(Buffer.from([
        0xa9, value,
        0x8f, address & 0xff, address >>> 8, 0x7e,
      ]));
    }
    chunks.push(Buffer.from([0xc2, 0x20])); // REP #$20
  }

  // Match the accumulator value and negative flag left by the original
  // initializer's terminator before returning to its caller.
  chunks.push(Buffer.from([0xa9, 0xff, 0xff, 0x6b]));
  chunks.push(Buffer.from(`${MARKER}${scenarioName}\0`, "ascii"));
  return Buffer.concat(chunks);
}

function compileAutoboot(initializerAddress, targetMap) {
  if (targetMap === 4) {
    // A title-map scenario must not ask the loader to reload the hooked title
    // map. Apply its state once, replay the overwritten COP [AA] command, and
    // resume the original director instead.
    return Buffer.from([
      0x22,
      initializerAddress & 0xff,
      (initializerAddress >>> 8) & 0xff,
      (initializerAddress >>> 16) & 0xff,
      0x22, 0x76, 0xf5, 0x87,
      0x02, 0xaa, 0x26, 0xe7, 0x84,
      0x5c, 0x0a, 0xe7, 0xc4,
    ]);
  }
  // Map 4's director runs after the stock reset path has initialized the
  // engine. Apply the scenario, mirror its field destination into the game's
  // persistent load block, and hand control to the stock new-game map loader.
  return Buffer.from([
    0x22,
    initializerAddress & 0xff,
    (initializerAddress >>> 8) & 0xff,
    (initializerAddress >>> 16) & 0xff,
    0x22, 0x76, 0xf5, 0x87,
    0xad, 0xa8, 0x05,
    0x8d, 0x00, 0x06,
    0xad, 0xa8, 0x0b,
    0x8d, 0x02, 0x06,
    0xad, 0xa4, 0x0b,
    0x8d, 0x04, 0x06,
    0xad, 0xa6, 0x0b,
    0x8d, 0x06, 0x06,
    0xa9, 0x02, 0x00,
    0x8d, 0xac, 0x05,
    0x9c, 0xea, 0x0e,
    0x9c, 0x6a, 0x05,
    0x5c, 0x0b, 0xb4, 0xc4,
  ]);
}

function assertFingerprint(rom, offset, expected, label) {
  const actual = rom.subarray(offset, offset + expected.length);
  if (!actual.equals(expected)) {
    throw new ScenarioError(`ROM does not have the expected ${label} at ${formatHex(offset)}`);
  }
}

function updateChecksum(rom) {
  rom.fill(0, HEADER_CHECKSUM, HEADER_CHECKSUM + 4);
  let checksum = 0x01fe;
  for (const byte of rom) checksum = (checksum + byte) & 0xffff;
  rom.writeUInt16LE(checksum ^ 0xffff, HEADER_CHECKSUM);
  rom.writeUInt16LE(checksum, HEADER_CHECKSUM + 2);
}

function validateChecksum(rom) {
  const checksum = rom.readUInt16LE(HEADER_CHECKSUM + 2);
  const complement = rom.readUInt16LE(HEADER_CHECKSUM);
  if ((checksum ^ complement) !== 0xffff) {
    throw new ScenarioError("Generated ROM checksum pair is invalid");
  }
  let sum = 0;
  for (const byte of rom) sum = (sum + byte) & 0xffff;
  if (sum !== checksum) {
    throw new ScenarioError(`Generated ROM checksum is ${formatHex(checksum, 4)}, calculated ${formatHex(sum, 4)}`);
  }
}

export function createScenarioRom(input, scenario, catalog = {}) {
  const rom = Buffer.from(input);
  if (rom.length !== ROM_SIZE) {
    throw new ScenarioError(
      `Test-ROM generation needs the ${ROM_SIZE}-byte translated ROM; got ${rom.length} bytes`,
    );
  }
  assertFingerprint(rom, NEW_GAME_INITIALIZER, ORIGINAL_NEW_GAME_INITIALIZER, "new-game initializer");
  assertFingerprint(rom, BOOT_INITIAL_MAP_OPERAND, ORIGINAL_BOOT_INITIAL_MAP, "reset map setup");
  assertFingerprint(rom, AUTOBOOT_ACTOR, ORIGINAL_AUTOBOOT_ACTOR, "title-map director");

  const applied = applyScenarioToNewGameRam(scenario, catalog);
  const writes = compileWrites(applied);
  const initializer = compileInitializer(ORIGINAL_NEW_GAME_INITIALIZER, writes, scenario.name);
  const autobootSize = compileAutoboot(0, applied.currentMap).length;
  const initializerOffset = findInitializerSpace(rom, initializer.length + autobootSize);
  const initializerAddress = pcToHiRomAddress(initializerOffset);
  const autobootOffset = initializerOffset + initializer.length;
  const autobootAddress = pcToHiRomAddress(autobootOffset);
  const autoboot = compileAutoboot(initializerAddress, applied.currentMap);

  initializer.copy(rom, initializerOffset);
  autoboot.copy(rom, autobootOffset);
  Buffer.from([
    0x5c,
    initializerAddress & 0xff,
    (initializerAddress >>> 8) & 0xff,
    (initializerAddress >>> 16) & 0xff,
    0xea,
  ]).copy(rom, NEW_GAME_INITIALIZER);
  // Reset directly into the title map, then replace its director's first
  // command with a long jump to the checkpoint-free scenario launcher.
  rom.writeUInt16LE(4, BOOT_INITIAL_MAP_OPERAND);
  Buffer.from([
    0x5c,
    autobootAddress & 0xff,
    (autobootAddress >>> 8) & 0xff,
    (autobootAddress >>> 16) & 0xff,
  ]).copy(rom, AUTOBOOT_ACTOR);
  updateChecksum(rom);
  validateChecksum(rom);

  return {
    rom,
    changes: applied.changes,
    currentMap: applied.currentMap,
    requestedMap: applied.requestedMap,
    entry: applied.entry,
    interaction: applied.interaction,
    launch: applied.launch,
    steps: applied.steps,
    writes,
    initializerOffset,
    initializerAddress,
    initializerSize: initializer.length,
    autobootOffset,
    autobootAddress,
    autobootSize: autoboot.length,
  };
}
