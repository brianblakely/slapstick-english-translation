#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SCRIPT_DIRECTORY = path.resolve("translation/script");
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u;
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
    if (entry.kind === "dialog") validateDialogLayout(entry.translation, location);
  }
}

if (errors.length) {
  for (const error of errors.slice(0, 100)) console.error(error);
  if (errors.length > 100) console.error(`...and ${errors.length - 100} more errors`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${entryCount} script entries: complete, English-only, and within dialogue boxes.`);
}

function validateDialogLayout(text, location) {
  let columns = 26;
  let rows = 4;
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
  if (atom.name === "NAM") return 6;
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
