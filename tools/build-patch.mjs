#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_SHA256 = "08144ea1ce3cf6ab107837278d308e4e859574a047a2ee8eb456f7900ad4be21";
const SOURCE_SIZE = 0x180000;
const TARGET_SIZE = 0x200000;
const HEADER_OFFSET = 0xffc0;
const EXPANSION_START = 0x180100;
const DIALOG_REDIRECT = 0xcf;
const CONSOLE_REDIRECT = 0x0c;
let crcTable = null;

const DIALOG_COMMANDS = {
  END: [0xc0, [], true],
  POS: [0xc1, ["Byte", "Byte"]],
  NAM: [0xc2, ["Byte"]],
  PAL: [0xc3, ["Byte"]],
  PGE: [0xc4, []],
  TBL: [0xc5, ["Offset", "Offset"]],
  NUM: [0xc6, ["Byte", "Word"]],
  BOX: [0xc7, ["Byte", "Byte", "Byte"]],
  DES: [0xc8, []],
  PAU: [0xc9, ["Byte"]],
  CA: [0xca, []],
  CB: [0xcb, []],
  TER: [0xcc, [], true],
  N: [0xcd, []],
  SKP: [0xce, ["Byte"]],
  STR: [0xcf, ["Address"]],
  CLR: [0xd0, []],
  FIN: [0xd1, []],
  WAI: [0xd2, []],
  JMP: [0xd3, ["Offset"], true],
  SFX: [0xd6, ["Byte"]],
  DEF: [0xd7, []],
  DF2: [0xd8, []],
  DFT: [0xd9, []],
  DF4: [0xda, []],
  DF5: [0xdb, []],
  DLY: [0xdc, ["Byte"]],
  DD: [0xdd, []],
  NXT: [0xde, [], true],
  DEC: [0xdf, ["Byte", "Byte", "Word"]],
  TPL: [0xe0, ["Byte"]],
  ESC: [0xe1, [], true],
  E2: [0xe2, ["Word"]],
  E3: [0xe3, ["Byte"]],
};

const CONSOLE_COMMANDS = {
  NUL: [0x00, [], true],
  POS: [0x01, ["Word"]],
  STR: [0x02, ["Address"]],
  PAL: [0x03, ["Byte"]],
  TBL: [0x04, ["Address", "Offset"]],
  NUM: [0x05, ["Byte", "Offset"]],
  DEC: [0x06, ["Byte", "Byte", "Offset"]],
  BOX: [0x07, ["Byte", "Byte", "Word"]],
  "08": [0x08, ["Word"]],
  FIL: [0x09, ["Byte", "Offset"]],
  "0A": [0x0a, ["Binary"]],
  "0B": [0x0b, ["Byte"]],
  "0C": [0x0c, []],
  N: [0x0d, []],
  "0E": [0x0e, []],
};

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const sourceFilename = path.resolve(valueAfter("--rom", "roms/Slap Stick (Japan).sfc"));
const scriptDirectory = path.resolve(valueAfter("--script-dir", "translation/script"));
const outputDirectory = path.resolve(valueAfter("--output-dir", "dist"));
const allowIncomplete = hasFlag("--allow-incomplete");
const checkOnly = hasFlag("--check");
const romOutput = valueAfter("--rom-output", null);

const sourceRom = await readFile(sourceFilename);
if (sourceRom.length !== SOURCE_SIZE) {
  throw new Error(`Expected a ${SOURCE_SIZE}-byte unheadered ROM, got ${sourceRom.length} bytes`);
}

const sourceHash = sha256(sourceRom);
if (sourceHash !== SOURCE_SHA256) {
  throw new Error(`Wrong source ROM. Expected SHA-256 ${SOURCE_SHA256}, got ${sourceHash}`);
}

const scriptFiles = (await readdir(scriptDirectory))
  .filter((filename) => filename.endsWith(".json"))
  .sort();
const entries = [];
for (const filename of scriptFiles) {
  const contents = JSON.parse(await readFile(path.join(scriptDirectory, filename), "utf8"));
  for (const entry of contents) entries.push({ ...entry, filename });
}
entries.sort((left, right) => hex(left.offset) - hex(right.offset));

const untranslated = entries.filter((entry) => entry.source !== "" && entry.translation === "");
if (untranslated.length && !allowIncomplete) {
  const sample = untranslated.slice(0, 8).map((entry) => entry.offset).join(", ");
  throw new Error(`${untranslated.length} strings remain untranslated (first: ${sample})`);
}

const targetRom = Buffer.alloc(TARGET_SIZE, 0xff);
sourceRom.copy(targetRom);

const changedEntries = entries.filter(
  (entry) => entry.translation !== "" && entry.translation !== entry.source,
);
const freeByBank = new Map();
const candidates = [];
const shortEntries = [];

for (const entry of changedEntries) {
  // A handful of strings are preceded by runtime-filled display buffers. In
  // those cases, keep the buffer intact and redirect from the first real text
  // command instead of from the extracted label.
  const offset = entry.patchOffset ? hex(entry.patchOffset) : hex(entry.offset);
  const originalLength = entry.kind === "dialog"
    ? scanDialogLength(sourceRom, offset)
    : scanConsoleLength(sourceRom, offset);
  const bytes = entry.kind === "dialog"
    ? encodeDialog(entry.translation)
    : encodeConsole(entry.translation);

  if (originalLength < 4) {
    shortEntries.push({ ...entry, offset, originalLength, bytes });
    continue;
  }

  const bank = offset >>> 16;
  if (originalLength > 4) {
    addGap(freeByBank, bank, { start: offset + 4, length: originalLength - 4 });
  }

  if (entry.kind === "dialog" && entry.translation.includes("[STR:")) {
    throw new Error(`Translated dialog ${entry.offset} still uses STR; inline its translated text`);
  }
  if (entry.kind === "dialog" && entry.translation.includes("[JMP:")) {
    throw new Error(`Translated dialog ${entry.offset} still uses JMP; inline its translated text`);
  }

  candidates.push({
    ...entry,
    offset,
    originalLength,
    bytes,
    bank,
    mustStayInBank: entry.kind === "dialog" && entry.translation.includes("[TBL:"),
  });
}

if (shortEntries.some((entry) => entry.offset !== 0x01e604)) {
  const details = shortEntries.map((entry) => `${entry.offset.toString(16)} (${entry.originalLength})`).join(", ");
  throw new Error(`No redirect gateway is defined for short strings: ${details}`);
}

let orbGateway = null;
if (shortEntries.length) {
  orbGateway = takeBestFit(freeByBank.get(0x01) ?? [], 4);
  if (orbGateway === null) throw new Error("No bank-01 space is available for the Orb redirect gateway");
  const pointerOffset = 0x01e304;
  if (sourceRom.readUInt16LE(pointerOffset) !== 0xe604) {
    throw new Error("Unexpected Orb pointer table contents at 0x01E304");
  }
  targetRom.writeUInt16LE(orbGateway & 0xffff, pointerOffset);
  candidates.push({
    ...shortEntries[0],
    bank: 0x01,
    mustStayInBank: false,
    gateway: orbGateway,
  });
}

let expansionCursor = EXPANSION_START;
const placements = new Map();
const orderedCandidates = [...candidates].sort((left, right) => {
  if (left.mustStayInBank !== right.mustStayInBank) return left.mustStayInBank ? -1 : 1;
  return right.bytes.length - left.bytes.length;
});

for (const candidate of orderedCandidates) {
  const bankGaps = freeByBank.get(candidate.bank) ?? [];
  let placement = takeBestFit(bankGaps, candidate.bytes.length);

  if (placement === null && candidate.mustStayInBank) {
    const fragments = allocateDialogFragments(bankGaps, candidate.bytes, candidate.bank);
    if (!fragments) {
      throw new Error(
        `Bank ${candidate.bank.toString(16)} lacks fragmented space for ${candidate.bytes.length}-byte string ${candidate.offset.toString(16)}`,
      );
    }
    placements.set(candidate.offset, { first: fragments[0].offset, fragments });
    continue;
  }

  if (placement === null) {
    expansionCursor = placeWithoutCrossingBank(expansionCursor, candidate.bytes.length);
    placement = expansionCursor;
    expansionCursor += candidate.bytes.length;
    if (expansionCursor > TARGET_SIZE) throw new Error("English script exceeds the 2 MiB target ROM");
  }

  placements.set(candidate.offset, {
    first: placement,
    fragments: [{ offset: placement, bytes: candidate.bytes }],
  });
}

for (const candidate of candidates) {
  const placement = placements.get(candidate.offset);
  for (let index = 0; index < placement.fragments.length; index += 1) {
    const fragment = placement.fragments[index];
    fragment.bytes.copy(targetRom, fragment.offset);
    if (index + 1 < placement.fragments.length) {
      const nextPointer = romPointer(placement.fragments[index + 1].offset);
      Buffer.from([
        DIALOG_REDIRECT,
        nextPointer.address & 0xff,
        nextPointer.address >>> 8,
        nextPointer.bank,
      ]).copy(targetRom, fragment.offset + fragment.bytes.length);
    }
  }

  const pointer = romPointer(placement.first);
  const stub = Buffer.from([
    candidate.kind === "dialog" ? DIALOG_REDIRECT : CONSOLE_REDIRECT,
    pointer.address & 0xff,
    pointer.address >>> 8,
    pointer.bank,
  ]);

  if (candidate.gateway !== undefined) {
    stub.copy(targetRom, candidate.gateway);
  } else {
    stub.copy(targetRom, candidate.offset);
  }
}

installNarrowDialogFont(targetRom);
installInterpreterHooks(targetRom);
writeHeader(targetRom);

const targetHash = sha256(targetRom);
const ipsPatch = createIps(sourceRom, targetRom);
const bpsPatch = createBps(sourceRom, targetRom);

if (!applyIps(sourceRom, ipsPatch).equals(targetRom)) throw new Error("Internal IPS verification failed");
if (!applyBps(sourceRom, bpsPatch).equals(targetRom)) throw new Error("Internal BPS verification failed");
validateRom(targetRom);

const manifest = {
  title: "Slap Stick English Translation",
  source: {
    filename: "Slap Stick (Japan).sfc",
    size: sourceRom.length,
    sha256: sourceHash,
  },
  target: {
    size: targetRom.length,
    sha256: targetHash,
    checksum: targetRom.readUInt16LE(0xffde).toString(16).toUpperCase().padStart(4, "0"),
  },
  script: {
    total: entries.length,
    translated: entries.length - untranslated.length,
    changed: changedEntries.length,
    untranslated: untranslated.length,
  },
  patches: {
    bps: { size: bpsPatch.length, sha256: sha256(bpsPatch) },
    ips: { size: ipsPatch.length, sha256: sha256(ipsPatch) },
  },
};

if (!checkOnly) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "Slap Stick (Japan) [EN].bps"), bpsPatch);
  await writeFile(path.join(outputDirectory, "Slap Stick (Japan) [EN].ips"), ipsPatch);
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (romOutput) await writeFile(path.resolve(romOutput), targetRom);
}

console.log(JSON.stringify(manifest, null, 2));

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hex(value) {
  return typeof value === "number" ? value : Number.parseInt(value, 16);
}

function addGap(gapsByBank, bank, gap) {
  if (!gapsByBank.has(bank)) gapsByBank.set(bank, []);
  gapsByBank.get(bank).push(gap);
}

function takeBestFit(gaps, size) {
  let bestIndex = -1;
  for (let index = 0; index < gaps.length; index += 1) {
    if (gaps[index].length < size) continue;
    if (bestIndex === -1 || gaps[index].length < gaps[bestIndex].length) bestIndex = index;
  }
  if (bestIndex === -1) return null;
  const result = gaps[bestIndex].start;
  gaps[bestIndex].start += size;
  gaps[bestIndex].length -= size;
  if (gaps[bestIndex].length === 0) gaps.splice(bestIndex, 1);
  return result;
}

function allocateDialogFragments(gaps, bytes, bank) {
  const workingGaps = gaps.map((gap) => ({ ...gap }));
  const fragments = [];
  let byteOffset = 0;

  while (byteOffset < bytes.length) {
    const remaining = bytes.length - byteOffset;
    const finalOffset = takeBestFit(workingGaps, remaining);
    if (finalOffset !== null) {
      fragments.push({ offset: finalOffset, bytes: bytes.subarray(byteOffset) });
      byteOffset = bytes.length;
      break;
    }

    let largestIndex = -1;
    for (let index = 0; index < workingGaps.length; index += 1) {
      if (workingGaps[index].length < 5) continue;
      if (largestIndex === -1 || workingGaps[index].length > workingGaps[largestIndex].length) {
        largestIndex = index;
      }
    }
    if (largestIndex === -1) return null;

    const gap = workingGaps[largestIndex];
    const capacity = gap.length - 4;
    const chunkLength = largestSafeDialogPrefix(bytes, byteOffset, capacity);
    if (chunkLength === 0) return null;
    fragments.push({
      offset: gap.start,
      bytes: bytes.subarray(byteOffset, byteOffset + chunkLength),
    });
    gap.start += chunkLength + 4;
    gap.length -= chunkLength + 4;
    if (gap.length === 0) workingGaps.splice(largestIndex, 1);
    byteOffset += chunkLength;
  }

  gaps.splice(0, gaps.length, ...workingGaps);
  for (const fragment of fragments) {
    if ((fragment.offset >>> 16) !== bank) throw new Error("Fragment allocator crossed a ROM bank");
  }
  return fragments;
}

function largestSafeDialogPrefix(bytes, start, maximum) {
  const parameterLengths = new Map(
    Object.values(DIALOG_COMMANDS).map(([opcode, types]) => [
      opcode,
      types.reduce((length, type) => length + ({ Byte: 1, Word: 2, Offset: 2, Address: 3, Binary: 0 }[type]), 0),
    ]),
  );
  let cursor = start;
  let best = 0;
  while (cursor < bytes.length) {
    const opcode = bytes[cursor];
    let unitLength = 1;
    if (opcode >= 0x80 && opcode < 0xc0) unitLength = 2;
    else if (opcode >= 0xc0) unitLength += parameterLengths.get(opcode) ?? 0;
    if (cursor + unitLength - start > maximum) break;
    cursor += unitLength;
    best = cursor - start;
  }
  return best;
}

function placeWithoutCrossingBank(cursor, size) {
  const remaining = 0x10000 - (cursor & 0xffff);
  return size <= remaining ? cursor : (cursor + 0xffff) & ~0xffff;
}

function romPointer(offset) {
  const fileBank = offset >>> 16;
  const address = offset & 0xffff;
  if (offset < SOURCE_SIZE) {
    if (address < 0x8000) throw new Error(`Cannot address original HiROM offset ${offset.toString(16)} via bank 80-BF`);
    return { bank: 0x80 + fileBank, address };
  }
  return { bank: 0xc0 + fileBank, address };
}

function scanDialogLength(rom, start) {
  const parameterLengths = [
    0, 2, 1, 1, 0, 4, 3, 3, 0, 1, 0, 0, 0, 0, 1, 3,
    0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 4,
    1, 0, 2, 1,
  ];
  const halt = new Set([0xc0, 0xcc, 0xd3, 0xde, 0xe1]);
  let cursor = start;
  while (cursor < rom.length) {
    const byte = rom[cursor++];
    if (byte < 0x80) continue;
    if (byte < 0xc0) {
      cursor += 1;
      continue;
    }
    const index = byte - 0xc0;
    if (index >= parameterLengths.length) throw new Error(`Unknown dialog opcode ${byte.toString(16)} at ${cursor - 1}`);
    cursor += parameterLengths[index];
    if (halt.has(byte)) return cursor - start;
  }
  throw new Error(`Unterminated dialog string at ${start.toString(16)}`);
}

function scanConsoleLength(rom, start) {
  const parameterLengths = [0, 2, 3, 1, 5, 3, 4, 4, 2, 3, null, 1, 0, 0];
  let cursor = start;
  while (cursor < rom.length) {
    const byte = rom[cursor++];
    if (byte >= 0x0e) continue;
    if (byte === 0) return cursor - start;
    if (byte === 0x0a) {
      while (rom[cursor++] !== 0xff) {
        if (cursor >= rom.length) throw new Error(`Unterminated console binary at ${start.toString(16)}`);
      }
      continue;
    }
    cursor += parameterLengths[byte];
  }
  throw new Error(`Unterminated console string at ${start.toString(16)}`);
}

function encodeDialog(source) {
  const output = [];
  let mode = null;
  let endedByHalt = false;

  for (const part of tokenize(source)) {
    if (part.type === "text") {
      endedByHalt = false;
      for (const character of part.value) {
        if (character === "▌" || character === "▐") {
          output.push(0x80, character === "▌" ? 0x06 : 0x07);
          continue;
        }

        const options = dialogCharacterOptions(character);
        if (!options.length) throw new Error(`Unsupported dialog character ${JSON.stringify(character)} in ${source}`);
        const option = options.find((candidate) => candidate.mode === mode) ?? options[0];
        if (mode !== option.mode) {
          output.push(option.mode === "base" ? 0xd5 : 0xd4);
          mode = option.mode;
        }
        output.push(option.byte);
      }
      continue;
    }

    if (part.name === "::") continue;
    const command = DIALOG_COMMANDS[part.name];
    if (!command) throw new Error(`Unknown dialog command [${part.value}]`);
    const [opcode, types, halt = false] = command;
    output.push(opcode, ...encodeParameters(types, part.args));
    if (opcode === 0xd5) mode = "base";
    if (opcode === 0xd4) mode = "alternate";
    endedByHalt = halt;
  }

  if (!endedByHalt) output.push(0xcc);
  return Buffer.from(output);
}

function dialogCharacterOptions(character) {
  const options = [];
  if (character === " ") return [{ mode: "base", byte: 0x20 }, { mode: "alternate", byte: 0x7f }];
  if (character >= "A" && character <= "Z") options.push({ mode: "base", byte: 0x21 + character.charCodeAt(0) - 65 });
  if (character >= "a" && character <= "z") options.push({ mode: "alternate", byte: 0x21 + character.charCodeAt(0) - 97 });
  if (character >= "0" && character <= "9") options.push({ mode: "base", byte: 0x73 + character.charCodeAt(0) - 48 });
  const base = new Map([
    ["?", 0x0f], ["┌", 0x10], ["┘", 0x11], ["(", 0x12], [")", 0x13],
    [",", 0x1e], [".", 0x1f], ["!", 0x7d], ["·", 0x7e], [":", 0x7f],
  ]);
  const alternate = new Map([
    ["…", 0x0f], ["→", 0x10], ["←", 0x11], ["↑", 0x12], ["↓", 0x13],
    ["\"", 0x1e], ["'", 0x1f], ["%", 0x75], ["=", 0x76], ["*", 0x79],
    ["+", 0x7a], ["-", 0x7b], ["/", 0x7c], ["&", 0x7d], [".", 0x7e],
  ]);
  if (base.has(character)) options.push({ mode: "base", byte: base.get(character) });
  if (alternate.has(character)) options.push({ mode: "alternate", byte: alternate.get(character) });
  return options;
}

function encodeConsole(source) {
  const output = [];
  let endedByHalt = false;
  for (const part of tokenize(source)) {
    if (part.type === "text") {
      endedByHalt = false;
      for (const character of part.value) output.push(consoleCharacter(character, source));
      continue;
    }
    const command = CONSOLE_COMMANDS[part.name];
    if (!command) throw new Error(`Unknown console command [${part.value}]`);
    const [opcode, types, halt = false] = command;
    output.push(opcode, ...encodeParameters(types, part.args));
    endedByHalt = halt;
  }
  if (!endedByHalt) output.push(0x00);
  return Buffer.from(output);
}

function consoleCharacter(character, source) {
  if (character === " ") return 0x20;
  if (character >= "A" && character <= "Z") return 0x21 + character.charCodeAt(0) - 65;
  if (character >= "a" && character <= "z") return 0xa1 + character.charCodeAt(0) - 97;
  if (character >= "0" && character <= "9") return 0x73 + character.charCodeAt(0) - 48;
  const symbols = new Map([
    ["!", 0x7d], ["·", 0x7e], [":", 0x7f], ["?", 0x84], ["►", 0x85],
    ["├", 0x86], ["┬", 0x87], ["┤", 0x88], ["┗", 0x8f], ["┓", 0x9f],
    ["▼", 0xa0], ["ー", 0xf3], ["(", 0xf4], [")", 0xf5], [",", 0xf6],
    ["┏", 0xf7], ["┛", 0xf8], ["*", 0xfa], ["+", 0xfb], ["-", 0xfc],
    ["/", 0xfd], ["&", 0xfe], [".", 0xff],
  ]);
  if (!symbols.has(character)) throw new Error(`Unsupported console character ${JSON.stringify(character)} in ${source}`);
  return symbols.get(character);
}

function tokenize(source) {
  const parts = [];
  let cursor = 0;
  const pattern = /\[([^\]]+)\]/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ type: "text", value: source.slice(cursor, match.index) });
    const value = match[1];
    const colon = value.indexOf(":");
    parts.push({
      type: "command",
      value,
      name: value === "::" || colon === -1 ? value : value.slice(0, colon),
      args: value === "::" || colon === -1 ? [] : value.slice(colon + 1).split(","),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parts.push({ type: "text", value: source.slice(cursor) });
  return parts;
}

function encodeParameters(types, args) {
  if (types.length !== args.length) {
    throw new Error(`Expected ${types.length} parameters, got ${args.length}: ${args.join(",")}`);
  }
  const output = [];
  for (let index = 0; index < types.length; index += 1) {
    const type = types[index];
    const argument = args[index];
    if (type === "Byte") output.push(parseValue(argument) & 0xff);
    else if (type === "Word" || type === "Offset") pushWord(output, parseValue(argument));
    else if (type === "Address") pushAddress(output, parseAddress(argument));
    else if (type === "Binary") {
      const compact = argument.replace(/[^0-9a-f]/gi, "");
      if (compact.length % 2) throw new Error(`Odd-length binary parameter ${argument}`);
      output.push(...Buffer.from(compact, "hex"), 0xff);
    } else throw new Error(`Unsupported parameter type ${type}`);
  }
  return output;
}

function parseValue(expression) {
  if (/^[0-9a-f]+$/i.test(expression)) return Number.parseInt(expression, 16);
  const match = expression.match(/^[&@][A-Za-z0-9_]*_([0-9A-F]{6})(?:\+([0-9A-F]+))?$/i);
  if (!match) throw new Error(`Cannot resolve expression ${expression}`);
  return Number.parseInt(match[1], 16) + (match[2] ? Number.parseInt(match[2], 16) : 0);
}

function parseAddress(expression) {
  if (/^[0-9a-f]{6}$/i.test(expression)) return Number.parseInt(expression, 16);
  const offset = parseValue(expression);
  const pointer = romPointer(offset);
  return (pointer.bank << 16) | pointer.address;
}

function pushWord(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushAddress(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
}

function installNarrowDialogFont(rom) {
  // Dialogue glyphs are stored as four 8x8 2bpp tiles in a 16x16 cell. The
  // original renderer advances by twelve pixels. English needs more room, so
  // preserve the hand-drawn font while sampling each pair of horizontal
  // pixels into the left half of the cell, then advance by eight pixels.
  const baseCodes = [
    ...range(0x21, 0x3a),
    ...range(0x73, 0x7f),
    0x0f, 0x10, 0x11, 0x12, 0x13, 0x1e, 0x1f,
  ];
  const alternateCodes = [
    ...range(0x21, 0x3a),
    0x0f, 0x10, 0x11, 0x12, 0x13, 0x1e, 0x1f,
    0x75, 0x76, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e,
  ];

  for (const code of new Set(baseCodes)) narrowGlyph(rom, 0x040000 + code * 64);
  for (const code of new Set(alternateCodes)) narrowGlyph(rom, 0x042000 + code * 64);

  const bytePatches = [
    [0x04a65a, 0x03, 0x02], // line-wrap width for a one-byte glyph
    [0x04a768, 0x03, 0x02], // rendered-width accumulator
    [0x04a772, 0x03, 0x02], // horizontal cursor
  ];
  for (const [offset, expected, replacement] of bytePatches) {
    if (sourceRom[offset] !== expected) {
      throw new Error(`Unexpected dialogue renderer byte at 0x${offset.toString(16).toUpperCase()}`);
    }
    rom[offset] = replacement;
  }
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function narrowGlyph(rom, offset) {
  const sourcePixels = readGlyph(rom, offset);
  const targetPixels = Array.from({ length: 16 }, () => Array(16).fill(3));
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      // Color 3 is the transparent/background color. Choosing the lower value
      // retains the solid stroke when it shares a pair with an outline pixel.
      targetPixels[y][x] = Math.min(sourcePixels[y][x * 2], sourcePixels[y][x * 2 + 1]);
    }
  }
  writeGlyph(rom, offset, targetPixels);
}

function readGlyph(rom, offset) {
  const pixels = Array.from({ length: 16 }, () => Array(16).fill(0));
  for (let tile = 0; tile < 4; tile += 1) {
    const tileX = tile & 1;
    const tileY = tile >>> 1;
    for (let y = 0; y < 8; y += 1) {
      const plane0 = rom[offset + tile * 16 + y * 2];
      const plane1 = rom[offset + tile * 16 + y * 2 + 1];
      for (let x = 0; x < 8; x += 1) {
        const shift = 7 - x;
        pixels[tileY * 8 + y][tileX * 8 + x] =
          ((plane0 >>> shift) & 1) | (((plane1 >>> shift) & 1) << 1);
      }
    }
  }
  return pixels;
}

function writeGlyph(rom, offset, pixels) {
  for (let tile = 0; tile < 4; tile += 1) {
    const tileX = tile & 1;
    const tileY = tile >>> 1;
    for (let y = 0; y < 8; y += 1) {
      let plane0 = 0;
      let plane1 = 0;
      for (let x = 0; x < 8; x += 1) {
        const value = pixels[tileY * 8 + y][tileX * 8 + x];
        const shift = 7 - x;
        plane0 |= (value & 1) << shift;
        plane1 |= ((value >>> 1) & 1) << shift;
      }
      rom[offset + tile * 16 + y * 2] = plane0;
      rom[offset + tile * 16 + y * 2 + 1] = plane1;
    }
  }
}

function installInterpreterHooks(rom) {
  // TBL recursively renders a string chosen from a pointer table. The stock
  // handler preserves Y but assumes the nested string remains in the current
  // bank. Redirected English table entries can live in expansion banks, so
  // preserve and restore DB around that recursive interpreter call as well.
  const originalDialogTableHandler = Buffer.from(
    "b90000c8c88500b90000c8c8aabd00005a0a186500aabd0000a822589e84c2207a60",
    "hex",
  );
  if (!sourceRom.subarray(0x04a0f7, 0x04a119).equals(originalDialogTableHandler)) {
    throw new Error("Unexpected dialog TBL handler bytes");
  }
  Buffer.from(
    "b90000c8c88500b90000c8c8aabd00005a8b0a186500aabd0000a822589e84ab7a60",
    "hex",
  ).copy(rom, 0x04a0f7);

  const originalDialogHandler = Buffer.from("5a8bb9000048e220b9020048abc2207a22589e84ab7ac8c8c860", "hex");
  if (!sourceRom.subarray(0x049ff9, 0x04a013).equals(originalDialogHandler)) {
    throw new Error("Unexpected dialog STR handler bytes");
  }

  const dialogTail = Buffer.from("b9000048e220b9020048abc2207a60", "hex");
  rom.fill(0xea, 0x049ff9, 0x04a013);
  dialogTail.copy(rom, 0x049ff9);

  // The unused tail of the old handler becomes a bank-84 trampoline for
  // console command 0C. The actual redirect routine lives at D8:0000.
  Buffer.from([0x22, 0x00, 0x00, 0xd8, 0x60]).copy(rom, 0x04a008);
  if (sourceRom.readUInt16LE(0x04acea) !== 0x0000) throw new Error("Console command 0C is not unused");
  rom.writeUInt16LE(0xa008, 0x04acea);

  const consoleRedirectRoutine = Buffer.from("e220b9020048c220b90000a8e2206848abc2206b", "hex");
  consoleRedirectRoutine.copy(rom, 0x180000);
}

function writeHeader(rom) {
  Buffer.from("SLAP STICK ENGLISH   ", "ascii").copy(rom, HEADER_OFFSET);
  rom[0xffd9] = 0x01;
  rom.fill(0x00, 0xffdc, 0xffe0);
  let checksum = 0x01fe;
  for (const byte of rom) checksum = (checksum + byte) & 0xffff;
  const complement = checksum ^ 0xffff;
  rom.writeUInt16LE(complement, 0xffdc);
  rom.writeUInt16LE(checksum, 0xffde);
}

function validateRom(rom) {
  const checksum = rom.readUInt16LE(0xffde);
  const complement = rom.readUInt16LE(0xffdc);
  if ((checksum ^ complement) !== 0xffff) throw new Error("Header checksum pair is invalid");
  let sum = 0;
  for (const byte of rom) sum = (sum + byte) & 0xffff;
  if (sum !== checksum) throw new Error(`ROM checksum mismatch: header ${checksum}, calculated ${sum}`);
  if (rom.subarray(HEADER_OFFSET, HEADER_OFFSET + 21).toString("ascii") !== "SLAP STICK ENGLISH   ") {
    throw new Error("Translated ROM title is invalid");
  }
}

function createIps(source, target) {
  const output = [Buffer.from("PATCH", "ascii")];
  const base = Buffer.alloc(target.length);
  source.copy(base);
  let cursor = 0;

  while (cursor < target.length) {
    if (target[cursor] === base[cursor]) {
      cursor += 1;
      continue;
    }

    const repeatLength = repeatedDifferenceLength(base, target, cursor, 0xffff);
    if (repeatLength >= 4) {
      const header = Buffer.alloc(8);
      header.writeUIntBE(cursor, 0, 3);
      header.writeUInt16BE(0, 3);
      header.writeUInt16BE(repeatLength, 5);
      header[7] = target[cursor];
      output.push(header);
      cursor += repeatLength;
      continue;
    }

    const start = cursor;
    cursor += 1;
    while (cursor < target.length && cursor - start < 0xffff && target[cursor] !== base[cursor]) {
      if (repeatedDifferenceLength(base, target, cursor, 0xffff) >= 4) break;
      cursor += 1;
    }
    const header = Buffer.alloc(5);
    header.writeUIntBE(start, 0, 3);
    header.writeUInt16BE(cursor - start, 3);
    output.push(header, target.subarray(start, cursor));
  }

  const footer = Buffer.alloc(6);
  footer.write("EOF", 0, "ascii");
  footer.writeUIntBE(target.length, 3, 3);
  output.push(footer);
  return Buffer.concat(output);
}

function repeatedDifferenceLength(base, target, start, maximum) {
  const byte = target[start];
  let length = 0;
  while (
    length < maximum
    && start + length < target.length
    && target[start + length] === byte
    && target[start + length] !== base[start + length]
  ) length += 1;
  return length;
}

function applyIps(source, patch) {
  if (patch.subarray(0, 5).toString("ascii") !== "PATCH") throw new Error("Bad IPS header");
  let cursor = 5;
  const writes = [];
  let finalSize = source.length;
  while (patch.subarray(cursor, cursor + 3).toString("ascii") !== "EOF") {
    const offset = patch.readUIntBE(cursor, 3);
    cursor += 3;
    const size = patch.readUInt16BE(cursor);
    cursor += 2;
    if (size === 0) {
      const runLength = patch.readUInt16BE(cursor);
      const value = patch[cursor + 2];
      cursor += 3;
      writes.push({ offset, data: Buffer.alloc(runLength, value) });
      finalSize = Math.max(finalSize, offset + runLength);
    } else {
      writes.push({ offset, data: patch.subarray(cursor, cursor + size) });
      cursor += size;
      finalSize = Math.max(finalSize, offset + size);
    }
  }
  cursor += 3;
  if (patch.length >= cursor + 3) finalSize = patch.readUIntBE(cursor, 3);
  const result = Buffer.alloc(finalSize);
  source.copy(result, 0, 0, Math.min(source.length, finalSize));
  for (const write of writes) write.data.copy(result, write.offset);
  return result;
}

function createBps(source, target) {
  const output = [Buffer.from("BPS1", "ascii")];
  output.push(encodeBpsNumber(source.length), encodeBpsNumber(target.length), encodeBpsNumber(0));
  let cursor = 0;
  while (cursor < target.length) {
    if (cursor < source.length && source[cursor] === target[cursor]) {
      const start = cursor;
      while (cursor < source.length && source[cursor] === target[cursor]) cursor += 1;
      output.push(encodeBpsNumber(((cursor - start - 1) << 2) | 0));
    } else {
      const start = cursor;
      cursor += 1;
      while (cursor < target.length && !(cursor < source.length && source[cursor] === target[cursor])) cursor += 1;
      output.push(encodeBpsNumber(((cursor - start - 1) << 2) | 1), target.subarray(start, cursor));
    }
  }
  const sourceCrc = uint32le(crc32(source));
  const targetCrc = uint32le(crc32(target));
  output.push(sourceCrc, targetCrc);
  const withoutPatchCrc = Buffer.concat(output);
  return Buffer.concat([withoutPatchCrc, uint32le(crc32(withoutPatchCrc))]);
}

function applyBps(source, patch) {
  if (patch.subarray(0, 4).toString("ascii") !== "BPS1") throw new Error("Bad BPS header");
  if (crc32(patch.subarray(0, -4)) !== patch.readUInt32LE(patch.length - 4)) throw new Error("Bad BPS patch CRC");
  const state = { cursor: 4 };
  const sourceSize = decodeBpsNumber(patch, state);
  const targetSize = decodeBpsNumber(patch, state);
  const metadataSize = decodeBpsNumber(patch, state);
  if (sourceSize !== source.length) throw new Error("BPS source size mismatch");
  state.cursor += metadataSize;
  const target = Buffer.alloc(targetSize);
  let outputOffset = 0;
  let sourceRelative = 0;
  let targetRelative = 0;
  while (outputOffset < targetSize) {
    const action = decodeBpsNumber(patch, state);
    const type = action & 3;
    const length = (action >>> 2) + 1;
    if (type === 0) {
      source.copy(target, outputOffset, outputOffset, outputOffset + length);
      outputOffset += length;
    } else if (type === 1) {
      patch.copy(target, outputOffset, state.cursor, state.cursor + length);
      state.cursor += length;
      outputOffset += length;
    } else if (type === 2) {
      sourceRelative += decodeBpsSigned(patch, state);
      source.copy(target, outputOffset, sourceRelative, sourceRelative + length);
      sourceRelative += length;
      outputOffset += length;
    } else {
      targetRelative += decodeBpsSigned(patch, state);
      for (let index = 0; index < length; index += 1) target[outputOffset++] = target[targetRelative++];
    }
  }
  if (crc32(source) !== patch.readUInt32LE(patch.length - 12)) throw new Error("Bad BPS source CRC");
  if (crc32(target) !== patch.readUInt32LE(patch.length - 8)) throw new Error("Bad BPS target CRC");
  return target;
}

function encodeBpsNumber(value) {
  const output = [];
  while (true) {
    const byte = value & 0x7f;
    value >>>= 7;
    if (value === 0) {
      output.push(byte | 0x80);
      return Buffer.from(output);
    }
    output.push(byte);
    value -= 1;
  }
}

function decodeBpsNumber(buffer, state) {
  let value = 0;
  let shift = 1;
  while (true) {
    const byte = buffer[state.cursor++];
    value += (byte & 0x7f) * shift;
    if (byte & 0x80) return value;
    shift <<= 7;
    value += shift;
  }
}

function decodeBpsSigned(buffer, state) {
  const value = decodeBpsNumber(buffer, state);
  return (value & 1) ? -(value >>> 1) : (value >>> 1);
}

function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32le(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0);
  return output;
}
