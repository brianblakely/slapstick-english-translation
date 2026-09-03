#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SCRIPT_DIRECTORY = path.resolve("translation/script");
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u;
const LOCATION_LABEL_START = 0x06f910;
const LOCATION_LABEL_END = 0x06fd89;
const LOCATION_LABEL_LAYOUT = { columns: 26, rows: 1 };
const LOCATION_BANNER_OFFSETS = new Set(["06F54B", "06F55D", "06F56F"]);
const STATUS_SCREEN_OFFSET = "01EBD4";
const STATUS_ITEM_GLYPHS = ["29", "34", "25", "2D"];
const CONFIG_OPTION_LAYOUTS = new Map([
  ["01E9EA", { columns: 26, slots: [[9, 3], [15, 3], [21, 3]] }],
  ["01EA0B", { columns: 26, slots: [[9, 4], [15, 4]] }],
]);
const CONFIG_BUTTON_OFFSET = "01EA27";
const SINGLE_LINE_CHOICE_LAYOUTS = new Map([
  ["069F54", 2],
  ["08C7A4", 2],
  ["08E377", 2],
]);
const FIXED_CHOICE_ROWS = new Map([
  ["079056", { choices: 2, firstRow: 2, description: "post-Surprise Horn choice" }],
  ["1584CB", { choices: 2, firstRow: 1, description: "first transceiver save choice" }],
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
    description: "item name",
  },
  {
    start: 0x01fddb,
    end: 0x01ffac,
    columns: 23,
    description: "battle target name",
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
      validateDialogLayout(entry.translation, location, entry.layout ?? inferredLayout(entry));
      validateSingleLineChoices(entry, location);
      validateFixedChoiceRows(entry, location);
      validateLocationLabel(entry, location);
    }
    if (entry.kind === "console") validateConsoleLayout(entry, location);
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

function validateConsoleLabel(entry, location) {
  const offset = Number.parseInt(entry.offset, 16);
  const layout = FIXED_CONSOLE_LABEL_LAYOUTS.get(entry.offset)
    ?? CONSOLE_LABEL_RANGES.find(({ start, end }) => offset >= start && offset <= end);
  if (!layout) return;

  const width = visibleText(entry.translation).length;
  if (width > layout.columns) {
    errors.push(
      `${location}: ${layout.description} requires ${width} columns in its ${layout.columns}-column layout`,
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
    if (["TBL", "STR", "FIL"].includes(atom.name)) {
      // These commands render runtime-selected strings. Their source tables
      // have separate fixed-width validation where the possible values are known.
      column = null;
      continue;
    }
    if (column !== null) column += consoleCommandWidth(atom);
  }
  finishLine();
}

function validateSingleLineChoices(entry, location) {
  const expectedChoices = SINGLE_LINE_CHOICE_LAYOUTS.get(entry.offset);
  if (!expectedChoices) return;

  const lines = entry.translation.split(/\[(?:N|FIN)\]/).slice(-expectedChoices);
  if (lines.length !== expectedChoices || lines.some((line) => !leadingText(line).startsWith(" "))) {
    errors.push(`${location}: each of the ${expectedChoices} choices must occupy one indented line`);
    return;
  }
  for (const line of lines) {
    const width = dialogTextWidth(line);
    if (width > 26) {
      errors.push(`${location}: choice requires ${width} columns in a 26-column dialogue box`);
    }
  }
}

function validateFixedChoiceRows(entry, location) {
  const layout = FIXED_CHOICE_ROWS.get(entry.offset);
  if (!layout) return;

  const finalPage = entry.translation.slice(entry.translation.lastIndexOf("[FIN]") + 5);
  const lines = finalPage.split("[N]");
  const choiceLines = lines.slice(-layout.choices);
  const firstRow = lines.length - layout.choices;
  if (
    choiceLines.length !== layout.choices
    || choiceLines.some((line) => !leadingText(line).startsWith(" "))
    || firstRow !== layout.firstRow
  ) {
    errors.push(
      `${location}: ${layout.description} choices must begin on row ${layout.firstRow}`,
    );
  }
}

function visibleText(text) {
  return text.replace(/\[[^\]]+\]/g, "");
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
