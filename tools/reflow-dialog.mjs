#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SCRIPT_DIRECTORY = path.resolve("translation/script");
const MAX_COLUMNS = 26;
const MAX_ROWS = 4;
const writeChanges = process.argv.includes("--write");
const checkOnly = process.argv.includes("--check");

const files = (await readdir(SCRIPT_DIRECTORY))
  .filter((filename) => filename.startsWith("dialog-") && filename.endsWith(".json"))
  .sort();

let changedEntries = 0;
let insertedLineBreaks = 0;
let insertedPageBreaks = 0;
const samples = [];

for (const filename of files) {
  const filePath = path.join(SCRIPT_DIRECTORY, filename);
  const entries = JSON.parse(await readFile(filePath, "utf8"));
  let changedFile = false;

  for (const entry of entries) {
    if (!shouldReflow(entry.translation)) continue;
    const result = reflow(
      entry.translation,
      entry.layout?.columns ?? MAX_COLUMNS,
      entry.layout?.rows ?? MAX_ROWS,
    );
    if (result.text === entry.translation) continue;
    if (samples.length < 4) {
      samples.push({ location: `${filename}:${entry.offset}`, before: entry.translation, after: result.text });
    }
    entry.translation = result.text;
    changedEntries += 1;
    insertedLineBreaks += result.lineBreaks;
    insertedPageBreaks += result.pageBreaks;
    changedFile = true;
  }

  if (writeChanges && changedFile) {
    await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
  }
}

console.log(JSON.stringify({
  mode: writeChanges ? "write" : "preview",
  maxColumns: MAX_COLUMNS,
  maxRows: MAX_ROWS,
  changedEntries,
  insertedLineBreaks,
  insertedPageBreaks,
  samples,
}, null, 2));

if (checkOnly && changedEntries > 0) process.exitCode = 1;

function shouldReflow(text) {
  if (!text || text.includes("[BOX:") || text.includes("[POS:")) return false;
  return /\[(?:DEF|DF2|DFT|CLR|N|FIN|NXT|END|DES|ESC|WAI|TPL:)/.test(text);
}

function reflow(text, maxColumns, maxRows) {
  const atoms = tokenize(text);
  const output = [];
  let column = 0;
  let row = 0;
  let lineBreaks = 0;
  let pageBreaks = 0;

  const emitBreak = (forcePage = false) => {
    if (forcePage || row >= maxRows - 1) {
      output.push("[FIN]");
      row = 0;
      pageBreaks += 1;
    } else {
      output.push("[N]");
      row += 1;
      lineBreaks += 1;
    }
    column = 0;
  };

  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (atom.value === " ") {
        const followingWidth = nextWordWidth(atoms, index + 1);
        if (column > 0 && followingWidth > 0 && column + 1 + followingWidth > maxColumns) {
          emitBreak();
        } else if (column < maxColumns) {
          output.push(atom.value);
          column += 1;
        }
        continue;
      }

      if (column >= maxColumns) emitBreak();
      output.push(atom.value);
      column += 1;
      continue;
    }

    const { name } = atom;
    if (name === "N") {
      const choices = consecutiveIndentedLines(atoms, index + 1);
      emitBreak(choices >= 2 && row + choices > maxRows - 1);
      continue;
    }
    if (name === "FIN") {
      output.push(atom.value);
      row = 0;
      column = 0;
      continue;
    }
    if (["DEF", "DF2", "DFT", "CLR", "PGE"].includes(name)) {
      output.push(atom.value);
      row = 0;
      column = 0;
      continue;
    }

    if (name === "TPL" && isSpeakerTemplate(atom.args[0])) {
      if (row >= maxRows - 1) emitBreak(true);
      output.push(atom.value);
      row += 1;
      column = 0;
      continue;
    }

    const width = commandWidth(atom);
    if (width > 0 && column > 0 && column + width > maxColumns) emitBreak();
    output.push(atom.value);
    column += width;
  }

  return { text: output.join(""), lineBreaks, pageBreaks };
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
      value: match[0],
      name: raw === "::" || separator === -1 ? raw : raw.slice(0, separator),
      args: raw === "::" || separator === -1 ? [] : raw.slice(separator + 1).split(","),
    });
    cursor = match.index + match[0].length;
  }
  for (const character of text.slice(cursor)) atoms.push({ type: "character", value: character });
  return atoms;
}

function nextWordWidth(atoms, start) {
  let width = 0;
  for (let index = start; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (atom.value === " ") break;
      width += 1;
      continue;
    }
    if (["N", "FIN", "END", "NXT", "DES", "ESC", "WAI", "CLR", "PGE"].includes(atom.name)) break;
    if (atom.name === "TPL" && isSpeakerTemplate(atom.args[0])) break;
    width += commandWidth(atom);
  }
  return width;
}

function consecutiveIndentedLines(atoms, start) {
  let index = start;
  let count = 0;
  while (index < atoms.length) {
    while (index < atoms.length && atoms[index].type === "command" && zeroWidth(atoms[index])) index += 1;
    if (atoms[index]?.type !== "character" || atoms[index].value !== " ") break;
    count += 1;
    while (index < atoms.length) {
      const atom = atoms[index];
      if (atom.type === "command" && atom.name === "N") {
        index += 1;
        break;
      }
      if (atom.type === "command" && ["FIN", "END", "NXT", "DES", "ESC", "WAI"].includes(atom.name)) {
        return count;
      }
      index += 1;
    }
  }
  return count;
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

function zeroWidth(atom) {
  return commandWidth(atom) === 0 && !["N", "FIN", "END", "NXT", "DES", "ESC", "WAI"].includes(atom.name);
}

function isSpeakerTemplate(value) {
  const index = Number.parseInt(value ?? "", 16);
  return Number.isInteger(index) && index !== 0 && index !== 0x1a;
}
