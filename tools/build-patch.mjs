#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_SHA256 = "08144ea1ce3cf6ab107837278d308e4e859574a047a2ee8eb456f7900ad4be21";
const SOURCE_SIZE = 0x180000;
const TARGET_SIZE = 0x200000;
const HEADER_OFFSET = 0xffc0;
// Only the upper 32 KiB of each expanded HiROM file bank is used for text.
// It can be addressed through banks 98-9F, whose lower halves retain the SNES
// WRAM/I/O mirrors required by the stock text interpreters. Banks D8-DF expose
// ROM in their lower halves and therefore cannot safely serve as the data bank.
const EXPANSION_START = 0x188000;
const DIALOG_REDIRECT = 0xcf;
const CONSOLE_REDIRECT = 0x0c;
const DIALOG_JUMP = 0xd3;
const DIALOG_RETURN = 0xcc;
const CONSOLE_REDIRECT_ROUTINE = 0x180000;
const DIALOG_REDIRECT_ROUTINE = 0x180020;
const CONSOLE_SELECTOR_START = 0xe9d6;
const CONSOLE_SELECTOR_END = 0xe9ea;
const BATTLE_UI_BITMAP_START = 0x132d06;
const BATTLE_UI_BITMAP_END = 0x133a98;
const BATTLE_UI_BITMAP_SHA256 = "1f91c329ff1927c21e9ea7b80161bacc068330c4ba0a7a0260fc961afb86cedc";
const BATTLE_MISS_TILE_OFFSET = 0x0540;
const DIALOG_BASE_MODE_COMMANDS = new Set(["NAM", "TBL", "NUM", "STR", "DEC", "TPL", "E2"]);
const DIALOG_FONT_PATH = path.resolve("assets/fonts/spleen-8x16.json");
const DIALOG_FONT_SOURCE_SHA256 = "4a3d97ee61a8c86a7525d8c723cb8a14081f395cd2feb4227ba5e3baf0629bae";
const DIALOG_FONT_SUBSET_SHA256 = "c4158e0935f0648b26185a47012d0c82d62a625b4ec26980773a2441879bac63";
const INLINE_CONSOLE_OFFSETS = new Set([
  0x01f2c7, // robot 1 point-allocation values
  0x01f300, // robot 2 point-allocation values
  0x01f339, // robot 3 point-allocation values
  0x01f372, // robot point-allocation panel, nested through STR
  0x01f498, // robot Program panel, nested through STR
]);
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

const dialogFont = JSON.parse(await readFile(DIALOG_FONT_PATH, "utf8"));
validateDialogFont(dialogFont);
const sourceRom = await readFile(sourceFilename);
if (sourceRom.length !== SOURCE_SIZE) {
  throw new Error(`Expected a ${SOURCE_SIZE}-byte unheadered ROM, got ${sourceRom.length} bytes`);
}

const sourceHash = sha256(sourceRom);
if (sourceHash !== SOURCE_SHA256) {
  throw new Error(`Wrong source ROM. Expected SHA-256 ${SOURCE_SHA256}, got ${sourceHash}`);
}

assertEnglishPeriodEncoding();
assertDynamicTextEncoding();

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

  // These shared panels are called through STR. Keeping them at their stock
  // addresses avoids a second redirect level while the parent console string
  // is active, which otherwise drops the panel and corrupts subsequent menus.
  if (entry.kind === "console" && INLINE_CONSOLE_OFFSETS.has(offset)) {
    if (bytes.length > originalLength) {
      throw new Error(
        `Inline console string ${entry.offset} needs ${bytes.length} bytes but has ${originalLength}`,
      );
    }
    bytes.copy(targetRom, offset);
    targetRom.fill(0x00, offset + bytes.length, offset + originalLength);
    continue;
  }
  const sourceStubLength = entry.kind === "dialog" ? 5 : 4;

  if (originalLength < sourceStubLength) {
    shortEntries.push({ ...entry, offset, originalLength, bytes });
    continue;
  }

  const bank = offset >>> 16;
  if (originalLength > sourceStubLength) {
    addGap(freeByBank, bank, {
      start: offset + sourceStubLength,
      length: originalLength - sourceStubLength,
    });
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
    terminator: entry.kind === "dialog" ? dialogTerminator(bytes, entry.offset) : null,
    mustStayInBank: entry.kind === "dialog" && entry.translation.includes("[TBL:"),
  });
}

const jumpEntries = shortEntries.filter(
  (entry) => entry.kind === "dialog" && entry.originalLength === 4,
);
for (const entry of jumpEntries) {
  candidates.push({
    ...entry,
    bank: entry.offset >>> 16,
    terminator: dialogTerminator(entry.bytes, entry.offset),
    mustStayInBank: true,
    jumpStub: true,
  });
}

const pointerEntries = shortEntries.filter((entry) => entry.offset === 0x01e604);
const unsupportedShortEntries = shortEntries.filter(
  (entry) => entry.originalLength !== 4 && entry.offset !== 0x01e604,
);
if (unsupportedShortEntries.length) {
  const details = unsupportedShortEntries
    .map((entry) => `${entry.offset.toString(16)} (${entry.originalLength})`)
    .join(", ");
  throw new Error(`No short-string redirect is defined for: ${details}`);
}

if (pointerEntries.length > 1) throw new Error("Duplicate Orb string entries");
if (pointerEntries.length) {
  const entry = pointerEntries[0];
  const pointerTableOffset = 0x01e304;
  if (sourceRom.readUInt16LE(pointerTableOffset) !== 0xe604) {
    throw new Error("Unexpected Orb pointer table contents at 0x01E304");
  }
  candidates.push({
    ...entry,
    bank: 0x01,
    terminator: dialogTerminator(entry.bytes, entry.offset),
    mustStayInBank: true,
    pointerTableOffset,
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
  const hasRecursiveSourceRedirect = candidate.kind === "dialog"
    && candidate.pointerTableOffset === undefined
    && !candidate.jumpStub;
  // Nested payloads return with TER; the original semantic terminator (END,
  // NXT, and so on) runs only after the outermost redirect restores DB and Y.
  const neutralizePayloadTerminator = hasRecursiveSourceRedirect
    || placement.fragments.length > 1;

  for (let index = 0; index < placement.fragments.length; index += 1) {
    const fragment = placement.fragments[index];
    fragment.bytes.copy(targetRom, fragment.offset);
    if (index + 1 === placement.fragments.length && neutralizePayloadTerminator) {
      targetRom[fragment.offset + fragment.bytes.length - 1] = DIALOG_RETURN;
    }
    if (index + 1 < placement.fragments.length) {
      const nextPointer = romPointer(placement.fragments[index + 1].offset);
      Buffer.from([
        DIALOG_REDIRECT,
        nextPointer.address & 0xff,
        nextPointer.address >>> 8,
        nextPointer.bank,
      ]).copy(targetRom, fragment.offset + fragment.bytes.length);
      const isOutermostTail = !hasRecursiveSourceRedirect && index === 0;
      targetRom[fragment.offset + fragment.bytes.length + 4] = isOutermostTail
        ? candidate.terminator
        : DIALOG_RETURN;
    }
  }

  const pointer = romPointer(placement.first);
  if (candidate.pointerTableOffset !== undefined) {
    targetRom.writeUInt16LE(pointer.address, candidate.pointerTableOffset);
    continue;
  }
  if (candidate.jumpStub) {
    Buffer.from([
      DIALOG_JUMP,
      pointer.address & 0xff,
      pointer.address >>> 8,
    ]).copy(targetRom, candidate.offset);
    continue;
  }
  const stub = Buffer.from([
    candidate.kind === "dialog" ? DIALOG_REDIRECT : CONSOLE_REDIRECT,
    pointer.address & 0xff,
    pointer.address >>> 8,
    pointer.bank,
  ]);

  stub.copy(targetRom, candidate.offset);
  if (candidate.kind === "dialog") targetRom[candidate.offset + 4] = candidate.terminator;
}

installDialogFont(targetRom, dialogFont);
installBattleMissGlyphs(targetRom);
installInterpreterHooks(targetRom);
installConsoleSelectorMirrors(targetRom);
installRuntimeDefaults(targetRom);
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
      if (workingGaps[index].length < 6) continue;
      if (largestIndex === -1 || workingGaps[index].length > workingGaps[largestIndex].length) {
        largestIndex = index;
      }
    }
    if (largestIndex === -1) return null;

    const gap = workingGaps[largestIndex];
    // A recursive redirect must be followed by a return sentinel. Once the
    // nested fragment returns, that byte unwinds the current interpreter level
    // while preserving the caller's DB and Y.
    const capacity = gap.length - 5;
    const chunkLength = largestSafeDialogPrefix(bytes, byteOffset, capacity);
    if (chunkLength === 0) return null;
    fragments.push({
      offset: gap.start,
      bytes: bytes.subarray(byteOffset, byteOffset + chunkLength),
    });
    gap.start += chunkLength + 5;
    gap.length -= chunkLength + 5;
    if (gap.length === 0) workingGaps.splice(largestIndex, 1);
    byteOffset += chunkLength;
  }

  gaps.splice(0, gaps.length, ...workingGaps);
  for (const fragment of fragments) {
    if ((fragment.offset >>> 16) !== bank) throw new Error("Fragment allocator crossed a ROM bank");
  }
  return fragments;
}

function dialogTerminator(bytes, offset) {
  const terminator = bytes[bytes.length - 1];
  if (![0xc0, 0xcc, 0xde, 0xe1].includes(terminator)) {
    throw new Error(`Translated dialog ${offset} does not end in a semantic terminator`);
  }
  return terminator;
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
  if (size > 0x8000) throw new Error(`A relocated string exceeds one mirrored HiROM half-bank (${size} bytes)`);
  if ((cursor & 0xffff) < 0x8000) cursor = (cursor & ~0xffff) + 0x8000;
  const bankStart = cursor & ~0xffff;
  const start = cursor & 0xffff;
  if (start < CONSOLE_SELECTOR_END && start + size > CONSOLE_SELECTOR_START) {
    cursor = bankStart + CONSOLE_SELECTOR_END;
  }
  const remaining = 0x10000 - (cursor & 0xffff);
  return size <= remaining ? cursor : ((cursor + 0x10000) & ~0xffff) + 0x8000;
}

function romPointer(offset) {
  const fileBank = offset >>> 16;
  const address = offset & 0xffff;
  if (address < 0x8000) {
    throw new Error(`Cannot address HiROM text offset ${offset.toString(16)} through a WRAM-mirrored bank`);
  }
  return { bank: 0x80 + fileBank, address };
}

function longCallTrampoline(offset) {
  const fileBank = offset >>> 16;
  const address = offset & 0xffff;
  return Buffer.from([
    0x22,
    address & 0xff,
    address >>> 8,
    0xc0 + fileBank,
    0x60,
  ]);
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

  const restoreBaseMode = () => {
    if (mode === "alternate") {
      output.push(0xd5);
      mode = "base";
    }
  };

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
    // $0EC6 combines the interpreter nesting depth with the alternate-font
    // flag.  The stock exit handler only recognizes a completed top-level
    // string when the whole word reaches zero, so an English string ending in
    // lowercase must explicitly restore the base font before it terminates.
    // D3 is a jump, not a semantic exit, and therefore preserves font state.
    if (halt && opcode !== 0xd3) restoreBaseMode();
    // Runtime text insertions render through stock routines which return in
    // base-font mode. Enter them in that same mode so both the inserted value
    // and the following text agree with the encoder's tracked state. This also
    // keeps E2's dynamic A/B/X/Y byte out of the lowercase alphabet.
    if (DIALOG_BASE_MODE_COMMANDS.has(part.name)) restoreBaseMode();
    output.push(opcode, ...encodeParameters(types, part.args));
    if (opcode === 0xd5) mode = "base";
    if (opcode === 0xd4) mode = "alternate";
    endedByHalt = halt;
  }

  if (!endedByHalt) {
    restoreBaseMode();
    output.push(0xcc);
  }
  return Buffer.from(output);
}

function dialogCharacterOptions(character) {
  const options = [];
  if (character === " ") return [{ mode: "base", byte: 0x20 }, { mode: "alternate", byte: 0x7f }];
  if (character >= "A" && character <= "Z") options.push({ mode: "base", byte: 0x21 + character.charCodeAt(0) - 65 });
  if (character >= "a" && character <= "z") options.push({ mode: "alternate", byte: 0x21 + character.charCodeAt(0) - 97 });
  if (character >= "0" && character <= "9") options.push({ mode: "base", byte: 0x73 + character.charCodeAt(0) - 48 });
  // Base 0x1F is the Japanese circular full stop. English periods use only
  // alternate 0x7E, even when that requires a temporary font-mode switch.
  const base = new Map([
    ["?", 0x0f], ["┌", 0x10], ["┘", 0x11], ["(", 0x12], [")", 0x13],
    [",", 0x1e], ["!", 0x7d], ["·", 0x7e], [":", 0x7f],
  ]);
  const alternate = new Map([
    ["…", 0x0f], ["→", 0x10], ["←", 0x11], ["↑", 0x12], ["↓", 0x13],
    ["\"", 0x1e], ["'", 0x1f], ["%", 0x75], ["*", 0x79],
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
    ["┏", 0xf7], ["┛", 0xf8], ["*", 0xf9], ["+", 0xfa], ["-", 0xfb],
    ["/", 0xfc], ["&", 0xfd], [".", 0xfe],
  ]);
  if (!symbols.has(character)) throw new Error(`Unsupported console character ${JSON.stringify(character)} in ${source}`);
  return symbols.get(character);
}

function assertEnglishPeriodEncoding() {
  const dialog = encodeDialog(".");
  const console = encodeConsole(".");
  if (!dialog.equals(Buffer.from([0xd4, 0x7e, 0xd5, DIALOG_RETURN]))) {
    throw new Error("English dialogue periods must use alternate-font glyph 0x7E");
  }
  if (!console.equals(Buffer.from([0xfe, 0x00]))) {
    throw new Error("English console periods must use glyph 0xFE");
  }
}

function assertDynamicTextEncoding() {
  const commands = [
    ["NAM:0", 0xc2, 1],
    ["TBL:018000,018002", 0xc5, 4],
    ["NUM:1,018000", 0xc6, 3],
    ["STR:018000", 0xcf, 3],
    ["DEC:1,1,018000", 0xdf, 4],
    ["TPL:1A", 0xe0, 1],
    ["E2:80", 0xe2, 2],
  ];

  for (const [command, opcode, parameterLength] of commands) {
    const encoded = encodeDialog(`a[${command}]a`);
    const commandIndex = encoded.indexOf(opcode);
    const nextTextIndex = commandIndex + parameterLength + 1;
    if (
      commandIndex < 1
      || encoded[commandIndex - 1] !== 0xd5
      || encoded[nextTextIndex] !== 0xd4
    ) {
      throw new Error(`Dynamic dialogue command ${command} must be bounded by base-font mode`);
    }
  }
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

function installDialogFont(rom, font) {
  // Each stock glyph occupies a 16x16 four-tile cell, but the English renderer
  // advances by eight pixels. Install a native 8x16 bitmap in the cell's left
  // tile column instead of distorting the original art with horizontal
  // downsampling. Spleen's two-pixel stems remain distinct at SNES resolution.
  const baseGlyphs = [
    ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((character, index) => [0x21 + index, character]),
    ...[..."0123456789"].map((character, index) => [0x73 + index, character]),
    [0x0f, "?"], [0x10, "┌"], [0x11, "┘"], [0x12, "("], [0x13, ")"],
    [0x1e, ","], [0x20, " "], [0x7d, "!"], [0x7e, "·"], [0x7f, ":"],
  ];
  const alternateGlyphs = [
    ...[..."abcdefghijklmnopqrstuvwxyz"].map((character, index) => [0x21 + index, character]),
    [0x0f, "…"], [0x10, "→"], [0x11, "←"], [0x12, "↑"], [0x13, "↓"],
    [0x1e, "\""], [0x1f, "'"], [0x75, "%"],
    // Menus address this cell directly for their A-button selection marker.
    // Keep the compact English A here; the dialogue encoder reserves the cell.
    [0x76, "A"], [0x79, "*"],
    [0x7a, "+"], [0x7b, "-"], [0x7c, "/"], [0x7d, "&"], [0x7e, "."],
    [0x7f, " "],
  ];

  for (const [code, character] of baseGlyphs) {
    installBitmapGlyph(rom, 0x040000 + code * 64, font, character);
  }
  for (const [code, character] of alternateGlyphs) {
    installBitmapGlyph(rom, 0x042000 + code * 64, font, character);
  }

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

function validateDialogFont(font) {
  const expected = {
    schemaVersion: 1,
    name: "Spleen",
    variant: "8x16",
    version: "2.2.0",
    license: "BSD-2-Clause",
    sourceSha256: DIALOG_FONT_SOURCE_SHA256,
    subsetSha256: DIALOG_FONT_SUBSET_SHA256,
    cellWidth: 8,
    cellHeight: 16,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (font[field] !== value) {
      throw new Error(`Dialogue font ${field} is ${JSON.stringify(font[field])}; expected ${JSON.stringify(value)}`);
    }
  }
  if (!font.glyphs || typeof font.glyphs !== "object" || Array.isArray(font.glyphs)) {
    throw new Error("Dialogue font glyphs must be an object");
  }
  for (const [codepoint, bitmap] of Object.entries(font.glyphs)) {
    if (!/^(?:0|[1-9]\d*)$/.test(codepoint) || !/^[0-9a-f]{32}$/.test(bitmap)) {
      throw new Error(`Invalid dialogue font glyph ${JSON.stringify(codepoint)}`);
    }
  }
  const canonical = Object.entries(font.glyphs)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([codepoint, bitmap]) => `${codepoint}:${bitmap}`)
    .join("\n") + "\n";
  const actualHash = createHash("sha256").update(canonical).digest("hex");
  if (actualHash !== DIALOG_FONT_SUBSET_SHA256) {
    throw new Error(`Dialogue font subset SHA-256 is ${actualHash}; expected ${DIALOG_FONT_SUBSET_SHA256}`);
  }
}

function installBitmapGlyph(rom, offset, font, character) {
  const codepoint = character.codePointAt(0);
  const bitmap = font.glyphs[codepoint];
  if (!bitmap) throw new Error(`Spleen has no bundled glyph for ${JSON.stringify(character)}`);
  const targetPixels = Array.from({ length: 16 }, () => Array(16).fill(3));
  for (let y = 0; y < 16; y += 1) {
    const row = Number.parseInt(bitmap.slice(y * 2, y * 2 + 2), 16);
    for (let x = 0; x < 8; x += 1) {
      // The stock dialogue palettes use index 1 for the visible stroke and
      // index 3 for the transparent/background portion of each glyph.
      if (row & (1 << (7 - x))) targetPixels[y][x] = 1;
    }
  }
  writeGlyph(rom, offset, targetPixels);
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

function installBattleMissGlyphs(rom) {
  const slotLength = BATTLE_UI_BITMAP_END - BATTLE_UI_BITMAP_START;
  const bitmap = expandQuintetLz(sourceRom, BATTLE_UI_BITMAP_START, slotLength);
  if (bitmap.length !== 0x2000 || sha256(bitmap) !== BATTLE_UI_BITMAP_SHA256) {
    throw new Error("Unexpected battle UI bitmap at 0x132D06");
  }

  // Zero damage is displayed with tiles 2A and 2B. In the Japanese asset
  // those tiles spell スカ; put two narrow Latin letters in each tile so the
  // stock two-sprite actor displays MISS without requiring any battle-code or
  // object-layout changes.
  createBattleLabelTile("M", "I").copy(bitmap, BATTLE_MISS_TILE_OFFSET);
  createBattleLabelTile("S", "S").copy(bitmap, BATTLE_MISS_TILE_OFFSET + 0x20);

  const compressed = compactQuintetLz(bitmap);
  if (compressed.length > slotLength) {
    throw new Error(
      `English battle UI bitmap needs ${compressed.length} bytes but has ${slotLength}`,
    );
  }
  const expanded = expandQuintetLz(compressed, 0, compressed.length);
  if (!expanded.equals(bitmap)) throw new Error("Battle UI bitmap compression did not round-trip");
  compressed.copy(rom, BATTLE_UI_BITMAP_START);
}

function createBattleLabelTile(left, right) {
  const patterns = new Map([
    ["M", [0b101, 0b111, 0b101, 0b101, 0b101]],
    ["I", [0b111, 0b010, 0b010, 0b010, 0b111]],
    ["S", [0b111, 0b100, 0b111, 0b001, 0b111]],
  ]);
  const pixels = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (const [character, startX] of [[left, 0], [right, 4]]) {
    const pattern = patterns.get(character);
    if (!pattern) throw new Error(`Unsupported battle-label character ${character}`);
    for (let y = 0; y < pattern.length; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if (pattern[y] & (1 << (2 - x))) pixels[y + 1][startX + x] = 0x0b;
      }
    }
  }

  // The damage-number palette uses index B for the light face and index 1 for
  // its dark edge. Add the same one-pixel lower-right edge used by the digits.
  const face = pixels.map((row) => row.map((pixel) => pixel === 0x0b));
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      if (face[y][x] && pixels[y + 1][x + 1] === 0) pixels[y + 1][x + 1] = 1;
    }
  }

  const tile = Buffer.alloc(0x20);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const pixel = pixels[y][x];
      const shift = 7 - x;
      tile[y * 2] |= (pixel & 1) << shift;
      tile[y * 2 + 1] |= ((pixel >>> 1) & 1) << shift;
      tile[0x10 + y * 2] |= ((pixel >>> 2) & 1) << shift;
      tile[0x10 + y * 2 + 1] |= ((pixel >>> 3) & 1) << shift;
    }
  }
  return tile;
}

function expandQuintetLz(source, start, length) {
  let byte = start + 2;
  let bit = 7;
  const stop = start + length;
  const readBits = (count) => {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      if (byte >= stop) throw new Error("Truncated Quintet LZ stream");
      value = (value << 1) | ((source[byte] >>> bit) & 1);
      bit -= 1;
      if (bit < 0) {
        byte += 1;
        bit = 7;
      }
    }
    return value;
  };

  const encodedLength = source.readUInt16LE(start);
  if (encodedLength === 0) return Buffer.from(source.subarray(start + 2, stop));
  const outputLength = encodedLength & 0x8000 ? 0x10000 - encodedLength : encodedLength;
  const output = Buffer.alloc(outputLength);
  const dictionary = Buffer.alloc(0x100, 0x20);
  let dictionaryWrite = 0xef;
  let outputWrite = 0;

  while (outputWrite < output.length) {
    if (readBits(1)) {
      const sample = readBits(8);
      output[outputWrite++] = sample;
      dictionary[dictionaryWrite] = sample;
      dictionaryWrite = (dictionaryWrite + 1) & 0xff;
      continue;
    }

    let dictionaryRead = readBits(8);
    const matchLength = readBits(4) + 2;
    for (let index = 0; index < matchLength && outputWrite < output.length; index += 1) {
      const sample = dictionary[dictionaryRead];
      dictionaryRead = (dictionaryRead + 1) & 0xff;
      output[outputWrite++] = sample;
      dictionary[dictionaryWrite] = sample;
      dictionaryWrite = (dictionaryWrite + 1) & 0xff;
    }
  }
  return output;
}

function compactQuintetLz(source) {
  const payload = [];
  let currentByte = 0;
  let usedBits = 0;
  const writeBits = (value, count) => {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      currentByte = (currentByte << 1) | ((value >>> bit) & 1);
      usedBits += 1;
      if (usedBits === 8) {
        payload.push(currentByte);
        currentByte = 0;
        usedBits = 0;
      }
    }
  };

  const dictionary = Buffer.alloc(0x100, 0x20);
  let dictionaryWrite = 0xef;
  let sourceRead = 0;
  while (sourceRead < source.length) {
    const maximumLength = Math.min(17, source.length - sourceRead);
    let matchStart = 0;
    let matchLength = 0;

    if (maximumLength >= 2) {
      for (let candidate = 0; candidate < 0x100; candidate += 1) {
        // Simulate dictionary writes while probing so overlapping matches can
        // encode repeated bytes exactly as the game's decoder expands them.
        const probe = Buffer.from(dictionary);
        let probeRead = candidate;
        let probeWrite = dictionaryWrite;
        let length = 0;
        while (length < maximumLength && probe[probeRead] === source[sourceRead + length]) {
          const sample = probe[probeRead];
          probeRead = (probeRead + 1) & 0xff;
          probe[probeWrite] = sample;
          probeWrite = (probeWrite + 1) & 0xff;
          length += 1;
        }
        if (length > matchLength) {
          matchStart = candidate;
          matchLength = length;
          if (length === maximumLength) break;
        }
      }
    }

    if (matchLength >= 2) {
      writeBits(0, 1);
      writeBits(matchStart, 8);
      writeBits(matchLength - 2, 4);
      for (let index = 0; index < matchLength; index += 1) {
        dictionary[dictionaryWrite] = source[sourceRead++];
        dictionaryWrite = (dictionaryWrite + 1) & 0xff;
      }
    } else {
      const sample = source[sourceRead++];
      writeBits(1, 1);
      writeBits(sample, 8);
      dictionary[dictionaryWrite] = sample;
      dictionaryWrite = (dictionaryWrite + 1) & 0xff;
    }
  }
  if (usedBits) payload.push(currentByte << (8 - usedBits));

  const header = Buffer.alloc(2);
  header.writeUInt16LE(source.length);
  return Buffer.concat([header, Buffer.from(payload)]);
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

  // Keep CF's stock recursive behavior so it restores the caller's data bank
  // and text cursor. Relocate the handler to expanded ROM to make room for the
  // two long-call trampolines, changing only its final RTS to RTL.
  rom.fill(0xea, 0x049ff9, 0x04a013);
  longCallTrampoline(DIALOG_REDIRECT_ROUTINE).copy(rom, 0x049ff9);
  Buffer.concat([
    originalDialogHandler.subarray(0, -1),
    Buffer.from([0x6b]),
  ]).copy(rom, DIALOG_REDIRECT_ROUTINE);

  // Console command 0C uses the second trampoline. Its redirect routine also
  // lives in the lower, code-only half of expanded bank D8.
  longCallTrampoline(CONSOLE_REDIRECT_ROUTINE).copy(rom, 0x049ffe);
  if (sourceRom.readUInt16LE(0x04acea) !== 0x0000) throw new Error("Console command 0C is not unused");
  rom.writeUInt16LE(0x9ffe, 0x04acea);

  const consoleRedirectRoutine = Buffer.from("e220b9020048c220b90000a8e2206848abc2206b", "hex");
  consoleRedirectRoutine.copy(rom, CONSOLE_REDIRECT_ROUTINE);
}

function installRuntimeDefaults(rom) {
  const wordPatches = [
    [0x04b110, 0x0090, 0x0091, "default stereo sound"],
    [0x04b114, 0x0003, 0x0001, "default high message speed"],
    [0x04b118, 0x0003, 0x0001, "default high message-speed mirror"],
  ];
  for (const [offset, expected, replacement, description] of wordPatches) {
    if (sourceRom.readUInt16LE(offset) !== expected) {
      throw new Error(`Unexpected ${description} word at 0x${offset.toString(16).toUpperCase()}`);
    }
    rom.writeUInt16LE(replacement, offset);
  }
}

function installConsoleSelectorMirrors(rom) {
  // Several stock console commands store their selector address as a 16-bit
  // operand and therefore read it through the current data bank. Relocated
  // English strings run from banks 98-9F, so mirror the stock name/icon
  // selector words at the same address in each expansion bank. The allocator
  // reserves this range to keep relocated strings from overlapping it.
  const source = sourceRom.subarray(0x01e9d6, 0x01e9ea);
  for (let bank = 0x18; bank <= 0x1f; bank += 1) {
    source.copy(rom, (bank << 16) + CONSOLE_SELECTOR_START);
  }
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
