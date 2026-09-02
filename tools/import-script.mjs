#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , extractedDirectory, outputDirectory = "translation/script"] = process.argv;

if (!extractedDirectory) {
  console.error("Usage: node tools/import-script.mjs <extracted-system-dir> [output-dir]");
  process.exit(1);
}

const sourceDirectory = path.resolve(extractedDirectory);
const destinationDirectory = path.resolve(outputDirectory);
const asmFiles = (await readdir(sourceDirectory))
  .filter((name) => name.endsWith(".asm"))
  .sort();

const entries = [];
const stringPattern = /^(string|consolestring)_([0-9A-F]{6})\s+([`~])(.*?)\3\s*$/gm;

for (const filename of asmFiles) {
  const source = await readFile(path.join(sourceDirectory, filename), "utf8");

  for (const match of source.matchAll(stringPattern)) {
    const [, extractedKind, offset, , japanese] = match;
    entries.push({
      offset,
      kind: extractedKind === "string" ? "dialog" : "console",
      source: japanese,
      translation: /[\u3040-\u30ff\u3400-\u9fff]/u.test(japanese) ? "" : japanese,
    });
  }
}

entries.sort((left, right) => Number.parseInt(left.offset, 16) - Number.parseInt(right.offset, 16));

const seen = new Set();
for (const entry of entries) {
  if (seen.has(entry.offset)) {
    throw new Error(`Duplicate script offset ${entry.offset}`);
  }
  seen.add(entry.offset);
}

const groups = new Map();
for (const entry of entries) {
  const group = entry.kind === "console" ? "console" : entry.offset.slice(0, 2);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(entry);
}

await mkdir(destinationDirectory, { recursive: true });

for (const [group, groupEntries] of groups) {
  const filename = group === "console" ? "console.json" : `dialog-${group}.json`;
  await writeFile(
    path.join(destinationDirectory, filename),
    `${JSON.stringify(groupEntries, null, 2)}\n`,
  );
}

const translated = entries.filter((entry) => entry.translation !== "").length;
console.log(`Imported ${entries.length} strings (${translated} need no translation).`);
