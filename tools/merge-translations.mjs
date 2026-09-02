#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , scriptFilename, translationsFilename] = process.argv;

if (!scriptFilename || !translationsFilename) {
  console.error("Usage: node tools/merge-translations.mjs <script.json> <translations.json>");
  process.exit(1);
}

const scriptPath = path.resolve(scriptFilename);
const translationsPath = path.resolve(translationsFilename);
const script = JSON.parse(await readFile(scriptPath, "utf8"));
const translations = JSON.parse(await readFile(translationsPath, "utf8"));
const byOffset = new Map(script.map((entry) => [entry.offset, entry]));

for (const [offset, translation] of Object.entries(translations)) {
  const entry = byOffset.get(offset);
  if (!entry) throw new Error(`Unknown script offset ${offset}`);
  if (typeof translation !== "string" || translation.length === 0) {
    throw new Error(`Translation at ${offset} must be a non-empty string`);
  }
  entry.translation = translation;
}

await writeFile(scriptPath, `${JSON.stringify(script, null, 2)}\n`);
console.log(`Merged ${Object.keys(translations).length} translations into ${scriptFilename}.`);
