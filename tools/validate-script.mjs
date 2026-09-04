#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  CONSOLE_EQUIPMENT_ICONS,
  EQUIPMENT_ICON_BY_OFFSET,
} from "./console-icons.mjs";

const SCRIPT_DIRECTORY = path.resolve("translation/script");
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u;
const LOCATION_LABEL_START = 0x06f910;
const LOCATION_LABEL_END = 0x06fd89;
const LOCATION_LABEL_LAYOUT = { columns: 26, rows: 1 };
const LOCATION_BANNER_OFFSETS = new Set(["06F54B", "06F55D", "06F56F"]);
const DIALOG_LABEL_RANGES = [
  {
    start: 0x01d08a,
    end: 0x01d0e7,
    columns: 24,
    description: "mid-battle message",
  },
  {
    start: 0x01e53d,
    end: 0x01e6a8,
    columns: 11,
    description: "player battle option",
  },
];
const STATUS_SCREEN_OFFSET = "01EBD4";
const STATUS_ITEM_GLYPHS = ["29", "34", "25", "2D"];
const EQUIPMENT_NAME_TABLE = "@string_list_01F774";
const EQUIPMENT_LEVEL_TABLE = "@string_list_01F74C";
const CONFIG_OPTION_LAYOUTS = new Map([
  ["01E9EA", { columns: 26, slots: [[9, 3], [15, 3], [21, 3]] }],
  ["01EA0B", { columns: 26, slots: [[9, 4], [15, 4]] }],
]);
const CONFIG_BUTTON_OFFSET = "01EA27";
const DIALOG_CHOICE_LAYOUTS = new Map([
  ["01D122", { choices: 2, firstRow: 1 }],
  ["01D1F5", { choices: 2, firstRow: 1 }],
  ["01D28A", { choices: 2, firstRow: 1 }],
  ["01D2DE", { choices: 2, firstRow: 1 }],
  ["01D301", { choices: 2, firstRow: 1 }],
  ["01D593", { choices: 2, firstRow: 1 }],
  ["0592C5", { choices: 2, firstRow: 2 }],
  ["05ADB7", { choices: 2, firstRow: 2 }],
  ["05BBC0", { choices: 2, firstRow: 2 }],
  ["05C074", { choices: 2, firstRow: 2 }],
  ["05EF36", { choices: 2, firstRow: 2 }],
  ["05F06F", { choices: 2, firstRow: 2 }],
  ["05F0C5", { choices: 2, firstRow: 2 }],
  ["05F14B", { choices: 2, firstRow: 2 }],
  ["0695A5", { choices: 2, firstRow: 2 }],
  ["0695CE", { choices: 2, firstRow: 2 }],
  ["06966A", { choices: 2, firstRow: 2 }],
  ["069918", { choices: 2, firstRow: 2 }],
  ["069F54", { choices: 2, firstRow: 2 }],
  ["06AB30", { choices: 2, firstRow: 2 }],
  ["06ACBA", { choices: 2, firstRow: 2 }],
  ["06E435", { choices: 2, firstRow: 2 }],
  ["06E468", { choices: 2, firstRow: 2 }],
  ["06E494", { choices: 2, firstRow: 2 }],
  ["06EEAB", { choices: 2, firstRow: 2 }],
  ["079056", { choices: 2, firstRow: 2 }],
  ["0790A8", { choices: 4, firstRow: 0 }],
  ["079108", { choices: 2, firstRow: 1 }],
  ["079238", { choices: 2, firstRow: 1 }],
  ["079308", { choices: 2, firstRow: 1 }],
  ["07BF69", { choices: 2, firstRow: 2 }],
  ["08906A", { choices: 2, firstRow: 2 }],
  ["089181", { choices: 2, firstRow: 2 }],
  ["08ACB7", { choices: 2, firstRow: 2 }],
  ["08B515", { choices: 2, firstRow: 2 }],
  ["08C6DD", { choices: 2, firstRow: 2 }],
  ["08C7A4", { choices: 2, firstRow: 2 }],
  ["08C7DB", { choices: 2, firstRow: 2 }],
  ["08C886", { choices: 2, firstRow: 0 }],
  ["08D143", { choices: 2, firstRow: 2 }],
  ["08D99F", { choices: 2, firstRow: 1 }],
  ["08E0C3", { choices: 2, firstRow: 2 }],
  ["08E377", { choices: 2, firstRow: 2 }],
  ["08EB2F", { choices: 2, firstRow: 2 }],
  ["08ECFB", { choices: 2, firstRow: 2 }],
  ["09939C", { choices: 2, firstRow: 2 }],
  ["099A99", { choices: 2, firstRow: 2 }],
  ["09CD57", { choices: 2, firstRow: 2 }],
  ["09DFC7", { choices: 2, firstRow: 2 }],
  ["0A86A1", { choices: 2, firstRow: 2 }],
  ["0A8CD9", { choices: 2, firstRow: 2 }],
  ["0A8D3A", { choices: 4, firstRow: 0 }],
  ["0AB45F", { choices: 2, firstRow: 2 }],
  ["0AB5F0", { choices: 2, firstRow: 2 }],
  ["0AC344", { choices: 2, firstRow: 2 }],
  ["0ACF7C", { choices: 2, firstRow: 2 }],
  ["0AE67C", { choices: 2, firstRow: 2 }],
  ["0AE70D", { choices: 2, firstRow: 2 }],
  ["0AEB15", { choices: 2, firstRow: 2 }],
  ["0AED71", { choices: 4, firstRow: 2 }],
  ["0AEDF7", { choices: 2, firstRow: 2 }],
  ["1584CB", { choices: 2, firstRow: 1 }],
  ["158896", { choices: 2, firstRow: 2 }],
  ["159085", { choices: 4, firstRow: 0 }],
  ["15943D", { choices: 2, firstRow: 2 }],
  ["1599F8", { choices: 3, firstRow: 1 }],
]);
const INLINE_DIALOG_CHOICE_LINES = new Map([
  ["01D440", { row: 2, text: " Make it    Never mind" }],
  ["01D5CC", { row: 2, text: " Cancel       Combine" }],
  ["01D650", { row: 2, text: " Cancel       Recycle" }],
  ["01D6A2", { row: 2, text: " Build it    Never mind" }],
  ["01D72B", { row: 2, text: " Yes         Never mind" }],
  ["01D869", { row: 0, text: " Register     Delete" }],
]);
const FIXED_CONSOLE_LABEL_LAYOUTS = new Map([
  ["01FC95", { columns: 8, description: "Invention Machine option" }],
  ["01FC9E", { columns: 8, description: "Invention Machine option" }],
  ["01FCA8", { columns: 8, description: "Invention Machine option" }],
  ["01FCB1", { columns: 8, description: "Invention Machine option" }],
  ["01FCBB", { columns: 8, description: "Invention Machine option" }],
  ["01FCC4", { columns: 8, description: "Invention Machine option" }],
  ["01FCCF", { columns: 8, description: "main-menu caption" }],
  ["01FCD8", { columns: 8, description: "Invention Machine option" }],
  ["01FCE3", { columns: 8, description: "main-menu caption" }],
  ["01FCED", { columns: 8, description: "main-menu caption" }],
  ["01FCF6", { columns: 8, description: "main-menu caption" }],
  ["01FCFF", { columns: 8, description: "main-menu caption" }],
  ["01FD0A", { columns: 8, description: "main-menu caption" }],
  ["01FD14", { columns: 8, description: "main-menu caption" }],
]);
const CONSOLE_LABEL_RANGES = [
  {
    start: 0x01f8a0,
    end: 0x01fa02,
    columns: 8,
    description: "battle attack name",
  },
  {
    start: 0x01fa0c,
    end: 0x01fc8c,
    columns: 9,
    textColumns: 8,
    description: "item name",
  },
  {
    start: 0x01fddb,
    end: 0x01ffac,
    columns: 23,
    textColumns: 9,
    description: "enemy name",
  },
];
const errors = [];
let entryCount = 0;

const files = (await readdir(SCRIPT_DIRECTORY)).filter((filename) => filename.endsWith(".json")).sort();
for (const filename of files) {
  const entries = JSON.parse(await readFile(path.join(SCRIPT_DIRECTORY, filename), "utf8"));
  for (const entry of entries) {
    entryCount += 1;
    const location = `${filename}:${entry.offset}`;
    if (entry.source && !entry.translation) errors.push(`${location}: untranslated text`);
    if (JAPANESE.test(entry.translation)) errors.push(`${location}: Japanese remains in translation`);
    if (entry.kind === "dialog" && /\[(?:JMP|STR):/.test(entry.translation)) {
      errors.push(`${location}: translated dialogue still contains a shared-text jump`);
    }
    if (LOCATION_BANNER_OFFSETS.has(entry.offset) && !entry.translation.includes("[BOX:E,1,2]")) {
      errors.push(`${location}: location banner must provide 28 English columns`);
    }
    if (entry.kind === "dialog") {
      validateDialogLabel(entry, location);
      validateDialogLayout(entry.translation, location, entry.layout ?? inferredLayout(entry));
      validateDialogChoices(entry, location);
      validateInlineDialogChoices(entry, location);
      validateLocationLabel(entry, location);
    }
    if (entry.kind === "console") {
      if (typeof entry.literal !== "string") {
        errors.push(`${location}: missing literal translation`);
      } else if (JAPANESE.test(entry.literal)) {
        errors.push(`${location}: Japanese remains in literal translation`);
      }
      validateConsoleLayout(entry, location);
    }
  }
}

if (errors.length) {
  for (const error of errors.slice(0, 100)) console.error(error);
  if (errors.length > 100) console.error(`...and ${errors.length - 100} more errors`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${entryCount} script entries: complete, English-only, and within their UI layouts.`);
}

function inferredLayout(entry) {
  const offset = Number.parseInt(entry.offset, 16);
  if (offset >= LOCATION_LABEL_START && offset <= LOCATION_LABEL_END) return LOCATION_LABEL_LAYOUT;
  return undefined;
}

function validateDialogLabel(entry, location) {
  const offset = Number.parseInt(entry.offset, 16);
  const layout = DIALOG_LABEL_RANGES.find(({ start, end }) => offset >= start && offset <= end);
  if (!layout) return;

  const width = dialogTextWidth(entry.translation);
  if (width > layout.columns) {
    errors.push(
      `${location}: ${layout.description} requires ${width} columns; maximum is ${layout.columns}`,
    );
  }
}

function validateLocationLabel(entry, location) {
  const offset = Number.parseInt(entry.offset, 16);
  if (offset < LOCATION_LABEL_START || offset > LOCATION_LABEL_END) return;

  const leadingSpaces = entry.translation.match(/^ */)?.[0].length ?? 0;
  const trailingSpaces = entry.translation.match(/ *$/)?.[0].length ?? 0;
  const contentWidth = dialogTextWidth(entry.translation) - leadingSpaces - trailingSpaces;
  const expectedLeadingSpaces = Math.floor((LOCATION_LABEL_LAYOUT.columns - contentWidth) / 2);
  if (leadingSpaces !== expectedLeadingSpaces || trailingSpaces !== 0) {
    errors.push(
      `${location}: location label needs ${expectedLeadingSpaces} leading and no trailing spaces to be centered`,
    );
  }
}

function validateConsoleLayout(entry, location) {
  validateConsoleBoxLayout(entry.translation, location);
  validateConsoleLabel(entry, location);
  validateConsoleEquipmentIcons(entry, location);

  if (entry.offset === STATUS_SCREEN_OFFSET) {
    const glyphs = [...entry.translation.matchAll(/\[FIL:([0-9A-F]+),&word_01E9D6\+2\]/g)]
      .map((match) => match[1]);
    const expected = [...STATUS_ITEM_GLYPHS, ...STATUS_ITEM_GLYPHS];
    if (glyphs.length !== expected.length || glyphs.some((glyph, index) => glyph !== expected[index])) {
      errors.push(`${location}: conditional status labels must spell ITEM in English glyphs`);
    }
  }

  const optionLayout = CONFIG_OPTION_LAYOUTS.get(entry.offset);
  if (optionLayout) {
    const line = entry.translation.replace(/\[[^\]]+\]/g, "");
    if (line.length > optionLayout.columns) {
      errors.push(`${location}: config line requires ${line.length} columns in a ${optionLayout.columns}-column box`);
    }

    const occupied = new Set();
    for (const [start, width] of optionLayout.slots) {
      for (let column = start; column < start + width; column += 1) occupied.add(column);
      if (line[start - 1] !== " ") {
        errors.push(`${location}: config cursor column ${start - 1} is not clear`);
      }
      if (!line.slice(start, start + width).trim()) {
        errors.push(`${location}: config option is missing from columns ${start}-${start + width - 1}`);
      }
    }

    const firstOption = optionLayout.slots[0][0];
    for (let column = firstOption; column < line.length; column += 1) {
      if (!occupied.has(column) && line[column] !== " ") {
        errors.push(`${location}: config text at column ${column} overlaps a cursor or option gap`);
        break;
      }
    }
  }

  if (entry.offset === CONFIG_BUTTON_OFFSET) {
    const match = entry.translation.match(/\[POS:40C\]([\s\S]*?)\[POS:42A\]([\s\S]*)$/);
    if (!match) {
      errors.push(`${location}: button setup is missing its fixed text positions`);
      return;
    }

    const actionLabels = match[1].split("[N]");
    if (actionLabels.length !== 5) errors.push(`${location}: button setup must contain five action rows`);
    for (const label of actionLabels) {
      if (label.length > 14) {
        errors.push(`${location}: button label ${JSON.stringify(label)} overlaps the choices at column 15`);
      }
    }

    const choices = match[2].split("[N]");
    if (choices.length !== 4 || choices.some((choice) => choice !== "A B X Y")) {
      errors.push(`${location}: button choices must remain aligned in four fixed A/B/X/Y rows`);
    }
  }
}

function validateConsoleEquipmentIcons(entry, location) {
  const icons = [...entry.translation.matchAll(/\[ICON:([^\]]+)\]/g)]
    .map((match) => match[1].toUpperCase());
  for (const icon of icons) {
    if (!CONSOLE_EQUIPMENT_ICONS[icon]) {
      errors.push(`${location}: unknown console equipment icon ${JSON.stringify(icon)}`);
    }
  }

  const expected = EQUIPMENT_ICON_BY_OFFSET.get(entry.offset);
  if (expected && icons.length !== 0) {
    errors.push(`${location}: equipment name must not embed its dynamically rendered ${expected} icon`);
  }

  for (const match of entry.translation.matchAll(/\[EICON:([^\]]*)\]/g)) {
    const selector = match[1];
    const suffix = entry.translation.slice(match.index + match[0].length);
    const display = suffix.match(
      new RegExp(
        `^(?:\\[TBL:${EQUIPMENT_LEVEL_TABLE},[^\\]]+\\])?`
        + `\\[TBL:${EQUIPMENT_NAME_TABLE},([^\\]]+)\\]`,
      ),
    );
    if (!selector || !display || display[1] !== selector) {
      errors.push(`${location}: [EICON:${selector}] must begin an equipment display using the same selector`);
    }
  }

  for (const match of entry.translation.matchAll(/\[ELBL:([^\]]*)\]/g)) {
    if (!match[1]) {
      errors.push(`${location}: equipment label lookup needs an item selector`);
    }
  }

  const itemCallPattern = new RegExp(`\\[TBL:${EQUIPMENT_NAME_TABLE},([^\\]]+)\\]`, "g");
  for (const match of entry.translation.matchAll(itemCallPattern)) {
    const selector = match[1];
    const prefix = entry.translation.slice(0, match.index).match(
      new RegExp(
        `\\[EICON:([^\\]]+)\\]`
        + `(?:\\[TBL:${EQUIPMENT_LEVEL_TABLE},[^\\]]+\\])?$`,
      ),
    );
    if (!prefix || prefix[1] !== selector) {
      errors.push(`${location}: equipment display for ${selector} must begin with its dynamic icon`);
    }
    const suffix = entry.translation.slice(match.index + match[0].length);
    if (suffix.startsWith(`[TBL:${EQUIPMENT_LEVEL_TABLE},`)) {
      errors.push(`${location}: equipment level must precede the item name`);
    }
  }
}

function validateConsoleLabel(entry, location) {
  const offset = Number.parseInt(entry.offset, 16);
  const layout = FIXED_CONSOLE_LABEL_LAYOUTS.get(entry.offset)
    ?? CONSOLE_LABEL_RANGES.find(({ start, end }) => offset >= start && offset <= end);
  if (!layout) return;

  const reservedIconColumns = EQUIPMENT_ICON_BY_OFFSET.has(entry.offset) ? 1 : 0;
  const availableColumns = Math.min(
    layout.columns - reservedIconColumns,
    layout.textColumns ?? Number.POSITIVE_INFINITY,
  );
  const width = visibleText(entry.translation).length;
  if (width > availableColumns) {
    errors.push(
      `${location}: ${layout.description} requires ${width} text columns; maximum is ${availableColumns}`,
    );
  }
}

function validateConsoleBoxLayout(text, location) {
  let columns = null;
  let column = 0;
  let reported = false;

  const finishLine = () => {
    if (!reported && columns !== null && column !== null && column > columns) {
      errors.push(
        `${location}: console line requires ${column} columns in a ${columns}-column box`,
      );
      reported = true;
    }
  };

  for (const atom of tokenize(text)) {
    if (atom.type === "character") {
      if (column !== null) column += 1;
      continue;
    }

    if (atom.name === "BOX") {
      finishLine();
      columns = Number.parseInt(atom.args[0], 16);
      column = 0;
      reported = false;
      continue;
    }
    if (["N", "POS"].includes(atom.name)) {
      finishLine();
      column = 0;
      reported = false;
      continue;
    }
    if (["TBL", "STR", "FIL", "ELBL"].includes(atom.name)) {
      // These commands render runtime-selected strings. Their source tables
      // have separate fixed-width validation where the possible values are known.
      column = null;
      continue;
    }
    if (column !== null) column += consoleCommandWidth(atom);
  }
  finishLine();
}

function validateDialogChoices(entry, location) {
  const layout = DIALOG_CHOICE_LAYOUTS.get(entry.offset);
  if (!layout) return;

  const page = finalDialogPage(entry.translation);
  const lines = page.split("[N]");
  const choiceLines = lines.slice(-layout.choices);
  const firstRow = renderedFinalRow(page, entry.layout ?? inferredLayout(entry)) - layout.choices + 1;
  if (
    choiceLines.length !== layout.choices
    || choiceLines.some((line) => !leadingText(line).startsWith(" "))
    || firstRow !== layout.firstRow
  ) {
    errors.push(
      `${location}: ${layout.choices} choices must occupy separate indented lines beginning on cursor row ${layout.firstRow}`,
    );
    return;
  }
  for (const line of choiceLines) {
    const width = dialogTextWidth(line);
    if (width > 26) {
      errors.push(`${location}: choice requires ${width} columns in a 26-column dialogue box`);
    }
  }
}

function validateInlineDialogChoices(entry, location) {
  const layout = INLINE_DIALOG_CHOICE_LINES.get(entry.offset);
  if (!layout) return;

  const page = finalDialogPage(entry.translation);
  const line = page.split("[N]").at(-1);
  const row = renderedFinalRow(page, entry.layout ?? inferredLayout(entry));
  if (leadingText(line) !== layout.text || row !== layout.row) {
    errors.push(
      `${location}: inline choices must remain at their fixed columns on cursor row ${layout.row}`,
    );
  }
}

function finalDialogPage(text) {
  const marker = "[FIN]";
  const index = text.lastIndexOf(marker);
  return index === -1 ? text : text.slice(index + marker.length);
}

function renderedFinalRow(text, inheritedLayout) {
  let rows = inheritedLayout?.rows ?? 4;
  let row = 0;
  const advance = () => {
    row = Math.min(row + 1, rows - 1);
  };

  for (const atom of tokenize(text)) {
    if (atom.type === "character") continue;
    if (atom.name === "BOX") {
      rows = Number.parseInt(atom.args[1], 16);
      row = 0;
      continue;
    }
    if (["DEF", "DF2", "DFT"].includes(atom.name)) {
      rows = 4;
      row = 0;
      continue;
    }
    if (["CLR", "PGE", "FIN"].includes(atom.name)) {
      row = 0;
      continue;
    }
    if (atom.name === "N" || (atom.name === "TPL" && isSpeakerTemplate(atom.args[0]))) {
      advance();
    }
  }
  return row;
}

function visibleText(text) {
  return tokenize(text)
    .filter((atom) => atom.type === "character" || atom.name === "ICON")
    .map((atom) => atom.type === "character" ? atom.value : "■")
    .join("");
}

function leadingText(text) {
  return text.replace(/^(?:\[[^\]]+\])*/, "");
}

function dialogTextWidth(text) {
  let width = 0;
  for (const atom of tokenize(text)) {
    width += atom.type === "character" ? 1 : commandWidth(atom);
  }
  return width;
}

function consoleCommandWidth(atom) {
  if (["ICON", "EICON"].includes(atom.name)) return 1;
  if (atom.name === "NUM") return Number.parseInt(atom.args[0] ?? "1", 16);
  if (atom.name === "DEC") return Number.parseInt(atom.args[1] ?? "1", 16);
  return 0;
}

function validateDialogLayout(text, location, inheritedLayout) {
  let columns = inheritedLayout?.columns ?? 26;
  let rows = inheritedLayout?.rows ?? 4;
  let column = 0;
  let row = 0;

  for (const atom of tokenize(text)) {
    if (atom.type === "character") {
      column += 1;
      checkColumn();
      continue;
    }

    if (atom.name === "BOX") {
      columns = Number.parseInt(atom.args[0], 16) * 2;
      rows = Number.parseInt(atom.args[1], 16);
      column = 0;
      row = 0;
      continue;
    }
    if (atom.name === "POS") {
      column = 0;
      continue;
    }
    if (["DEF", "DF2", "DFT"].includes(atom.name)) {
      columns = 26;
      rows = 4;
      column = 0;
      row = 0;
      continue;
    }
    if (["CLR", "PGE", "FIN"].includes(atom.name)) {
      column = 0;
      row = 0;
      continue;
    }
    if (atom.name === "N") {
      column = 0;
      row += 1;
      if (row >= rows) errors.push(`${location}: text exceeds its ${rows}-row dialogue box`);
      continue;
    }
    if (atom.name === "TPL" && isSpeakerTemplate(atom.args[0])) {
      column = 0;
      row += 1;
      if (row >= rows) errors.push(`${location}: speaker label exceeds its ${rows}-row dialogue box`);
      continue;
    }

    column += commandWidth(atom);
    checkColumn();
  }

  function checkColumn() {
    if (column > columns) {
      errors.push(`${location}: line requires ${column} columns in a ${columns}-column dialogue box`);
      column = -0x10000;
    }
  }
}

function tokenize(text) {
  const atoms = [];
  const commandPattern = /\[([^\]]+)\]/g;
  let cursor = 0;
  for (const match of text.matchAll(commandPattern)) {
    for (const character of text.slice(cursor, match.index)) {
      atoms.push({ type: "character", value: character });
    }
    const raw = match[1];
    const separator = raw.indexOf(":");
    atoms.push({
      type: "command",
      name: raw === "::" || separator === -1 ? raw : raw.slice(0, separator),
      args: raw === "::" || separator === -1 ? [] : raw.slice(separator + 1).split(","),
    });
    cursor = match.index + match[0].length;
  }
  for (const character of text.slice(cursor)) atoms.push({ type: "character", value: character });
  return atoms;
}

function commandWidth(atom) {
  if (atom.name === "NAM") return 5;
  if (atom.name === "TPL") return atom.args[0]?.toUpperCase() === "0" ? 7 : 5;
  if (atom.name === "TBL") return atom.args[0]?.includes("01E6B3") ? 2 : 17;
  if (atom.name === "NUM") return Number.parseInt(atom.args[0] ?? "1", 16);
  if (atom.name === "DEC") return Number.parseInt(atom.args[1] ?? "1", 16);
  if (atom.name === "E2") return 1;
  if (atom.name === "SKP") return Math.ceil(Number.parseInt(atom.args[0] ?? "0", 16) / 2);
  return 0;
}

function isSpeakerTemplate(value) {
  const index = Number.parseInt(value ?? "", 16);
  return Number.isInteger(index) && index !== 0 && index !== 0x1a;
}
