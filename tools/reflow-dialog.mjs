#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const SCRIPT_DIRECTORY = path.resolve("translation/script");
const MAX_COLUMNS = 26;
const MAX_ROWS = 4;
const NONTERMINAL_ABBREVIATIONS = new Set(["Dr.", "Jr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "St."]);
// Widest rendered entry of a dialogue pointer table. The validator holds item
// names to their width, and each equipment level suffix is a space plus the
// two 12-pixel "Lv" glyphs. Other tables keep a conservative estimate.
const DIALOG_TABLE_COLUMNS = new Map([
  ["01E23C", 15],
  ["01E6B3", 4],
]);
const writeChanges = process.argv.includes("--write");
const checkOnly = process.argv.includes("--check");

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

async function main() {
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
      if (entry.reflow === false || !shouldReflow(entry.translation)) continue;
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
}

function shouldReflow(text) {
  if (!text || text.includes("[BOX:") || text.includes("[POS:")) return false;
  return /\[(?:DEF|DF2|DFT|CLR|N|FIN|NXT|END|DES|ESC|WAI|TPL:)/.test(text);
}

function reflow(text, maxColumns = MAX_COLUMNS, maxRows = MAX_ROWS) {
  let current = text;
  // Moving one stale break can expose another on the newly reflowed line.
  for (let pass = 0; pass < 10; pass += 1) {
    const result = reflowOnce(current, maxColumns, maxRows);
    if (result.text === current) return result;
    current = result.text;
  }
  throw new Error("Dialogue reflow did not converge");
}

function reflowOnce(text, maxColumns, maxRows) {
  const atoms = normalizeSoftBreaks(tokenize(text), maxColumns);
  const output = [];
  let column = 0;
  let row = 0;
  let lineBreaks = 0;
  let pageBreaks = 0;
  let lineStartBreak = null;
  // An indented line keeps its one-column indent when it wraps.
  let hangingIndent = lineIndentAt(atoms, 0);

  const emitBreak = (forcePage = false, tailStart = atoms.length, movable = true) => {
    const widowWords = movable && !forcePage && row >= maxRows - 1
      ? followingPageWordCount(atoms, tailStart, 2)
      : 0;

    if (widowWords > 0 && widowWords <= 2 && lineStartBreak?.movable) {
      // Pull the last line of this page forward so a generated page never
      // consists of only one or two words. The prior N becomes the page
      // advance, and this boundary remains a normal newline on the new page.
      output[lineStartBreak.index] = "[FIN]";
      lineBreaks -= 1;
      pageBreaks += 1;
      output.push("[N]");
      lineBreaks += 1;
      row = 1;
      lineStartBreak = { index: output.length - 1, movable };
      column = 0;
      return;
    }

    if (forcePage || row >= maxRows - 1) {
      output.push("[FIN]");
      row = 0;
      pageBreaks += 1;
      lineStartBreak = null;
    } else {
      output.push("[N]");
      row += 1;
      lineBreaks += 1;
      lineStartBreak = { index: output.length - 1, movable };
    }
    column = 0;
  };

  const wrapLine = (tailStart) => {
    emitBreak(false, tailStart);
    if (hangingIndent > 0) {
      output.push(" ".repeat(hangingIndent));
      column = hangingIndent;
    }
  };

  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (atom.value === " ") {
        const followingWidth = nextWordWidth(atoms, index + 1);
        if (column > hangingIndent && followingWidth > 0 && column + 1 + followingWidth > maxColumns) {
          wrapLine(index + 1);
        } else if (column < maxColumns) {
          output.push(atom.value);
          column += 1;
        }
        continue;
      }

      if (column >= maxColumns) wrapLine(index);
      output.push(atom.value);
      column += 1;
      continue;
    }

    const { name } = atom;
    if (name === "N") {
      const choices = consecutiveIndentedLines(atoms, index + 1);
      const hardBreak = isHardBreak(atoms, index);
      const movable = !hardBreak || choices === 1;
      emitBreak(choices >= 2 && row + choices > maxRows - 1, index + 1, movable);
      hangingIndent = lineIndentAt(atoms, index + 1);
      continue;
    }
    if (name === "FIN") {
      output.push(atom.value);
      row = 0;
      column = 0;
      lineStartBreak = null;
      hangingIndent = lineIndentAt(atoms, index + 1);
      continue;
    }
    if (["DEF", "DF2", "DFT", "CLR", "PGE"].includes(name)) {
      output.push(atom.value);
      row = 0;
      column = 0;
      lineStartBreak = null;
      hangingIndent = lineIndentAt(atoms, index + 1);
      continue;
    }

    if (name === "TPL" && isSpeakerTemplate(atom.args[0])) {
      if (row >= maxRows - 1) emitBreak(true, index, false);
      output.push(atom.value);
      row += 1;
      column = 0;
      lineStartBreak = null;
      hangingIndent = lineIndentAt(atoms, index + 1);
      continue;
    }

    const width = commandWidth(atom);
    if (width > 0 && column > hangingIndent && column + width > maxColumns) wrapLine(index);
    output.push(atom.value);
    column += width;
  }

  return { text: output.join(""), lineBreaks, pageBreaks };
}

function normalizeSoftBreaks(atoms, maxColumns = MAX_COLUMNS) {
  const normalized = [];
  let column = 0;
  let lineStart = 0;

  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      normalized.push(atom);
      column += 1;
      continue;
    }

    if (["N", "FIN"].includes(atom.name)) {
      // Letters, notices, and signs indent every line by one column, like the
      // Japanese. When such a line ran long, an earlier wrap left the rest of
      // its sentence on an unindented line. Rejoin them; reflowOnce wraps the
      // line again with its indent.
      if (
        lineIndentAt(normalized, lineStart) > 0
        && !endsSentence(normalized, lineStart)
        && startsUnindentedText(atoms, index + 1)
      ) {
        normalized.push({ type: "character", value: " " });
        column += 1;
        continue;
      }

      const previous = normalized.at(-1);
      const next = nextSpacingAtom(atoms, index + 1);
      const omitSpace = previous?.type === "character" && previous.value === " "
        || next?.type === "character" && /^[,.;:!?)]$/.test(next.value);
      const separatorWidth = omitSpace ? 0 : 1;
      const followingWidth = nextWordWidth(atoms, index + 1);
      const hardBreak = isHardBreak(atoms, index);
      const canJoin = !hardBreak
        && followingWidth > 0
        && column + separatorWidth + followingWidth <= maxColumns;

      // Mid-sentence breaks are layout hints, but only discard one when doing
      // so can place the following word on this same line.
      if (canJoin) {
        if (!omitSpace) {
          normalized.push({ type: "character", value: " " });
          column += 1;
        }
      } else {
        // A soft FIN is just a stale pagination decision. Preserve the line
        // boundary as N and let reflowOnce choose N or FIN from the live row
        // count instead of carrying the old page boundary forward.
        normalized.push(hardBreak ? atom : {
          type: "command",
          value: "[N]",
          name: "N",
          args: [],
        });
        column = 0;
        lineStart = normalized.length;
      }
      continue;
    }

    normalized.push(atom);
    if (["DEF", "DF2", "DFT", "CLR", "PGE", "BOX", "POS"].includes(atom.name)) {
      column = 0;
      lineStart = normalized.length;
    } else if (atom.name === "TPL" && isSpeakerTemplate(atom.args[0])) {
      column = 0;
      lineStart = normalized.length;
    } else {
      column += commandWidth(atom);
    }
  }

  return normalized;
}

function nextSpacingAtom(atoms, start) {
  for (let index = start; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character" || commandWidth(atom) > 0 || isLayoutBoundary(atom)) return atom;
  }
  return null;
}

function isHardBreak(atoms, index) {
  const previous = previousInlineAtom(atoms, index - 1);
  const next = nextInlineAtom(atoms, index + 1);

  if (!previous || !next) return true;
  if (previous.type === "command" && isLayoutBoundary(previous)) return true;
  if (next.type === "command" && isLayoutBoundary(next)) return true;
  if (next.value === " ") return true;
  // A line that opens with two or more spaces is laid out by hand, such as a
  // centered title or a book's byline. Keep the break that ends it so the
  // next line's first word is never pulled up beside it.
  if (isPreformattedLine(atoms, index)) return true;

  // A dialogue newline is only a layout hint. Sentence punctuation does not
  // make it significant, so let the wrapper reclaim any room left on the
  // current row. Page advances still carry pacing and interaction semantics;
  // retain those when they end a sentence.
  if (atoms[index].name === "N") return false;

  let previousIndex = index - 1;
  while (previousIndex >= 0) {
    const atom = atoms[previousIndex];
    if (atom.type === "character") {
      if (!["\"", "'", ")", "]"].includes(atom.value)) {
        if (atom.value === "." && NONTERMINAL_ABBREVIATIONS.has(previousWord(atoms, previousIndex))) {
          return false;
        }
        return /[.!?…:]/.test(atom.value);
      }
    } else if (isLayoutBoundary(atom)) {
      return true;
    } else if (commandWidth(atom) > 0) {
      return false;
    }
    previousIndex -= 1;
  }

  return true;
}

// One space before a line's first character is an indent, the Japanese style
// for letters, notices, and signs. Two or more mark a line laid out by hand.
function lineIndentAt(atoms, start) {
  let index = start;
  while (
    index < atoms.length
    && atoms[index].type === "command"
    && commandWidth(atoms[index]) === 0
    && !isLayoutBoundary(atoms[index])
  ) {
    index += 1;
  }
  const first = atoms[index];
  const second = atoms[index + 1];
  if (first?.type !== "character" || first.value !== " ") return 0;
  if (second?.type === "character" && second.value === " ") return 0;
  return 1;
}

function endsSentence(atoms, lineStart) {
  for (let index = atoms.length - 1; index >= lineStart; index -= 1) {
    const atom = atoms[index];
    if (atom.type === "command") {
      if (commandWidth(atom) > 0) return false;
      continue;
    }
    if (["\"", "'", ")"].includes(atom.value)) continue;
    if (atom.value === "." && NONTERMINAL_ABBREVIATIONS.has(previousWord(atoms, index))) return false;
    return /[.!?…:]/.test(atom.value);
  }
  return true;
}

function startsUnindentedText(atoms, start) {
  for (let index = start; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") return atom.value !== " ";
    if (isLayoutBoundary(atom)) return false;
    if (commandWidth(atom) > 0) return atom.name !== "SKP";
  }
  return false;
}

function isPreformattedLine(atoms, breakIndex) {
  let lineStart = breakIndex;
  while (lineStart > 0) {
    const atom = atoms[lineStart - 1];
    if (atom.type === "command" && isLayoutBoundary(atom)) break;
    lineStart -= 1;
  }

  let leadingSpaces = 0;
  for (let index = lineStart; index < breakIndex; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (atom.value !== " ") break;
      leadingSpaces += 1;
    } else if (commandWidth(atom) > 0) {
      break;
    }
  }
  return leadingSpaces >= 2;
}

function previousWord(atoms, start) {
  let word = "";
  for (let index = start; index >= 0; index -= 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (/\s/.test(atom.value)) break;
      word = atom.value + word;
    } else if (isLayoutBoundary(atom) || commandWidth(atom) > 0) {
      break;
    }
  }
  return word;
}

function previousInlineAtom(atoms, start) {
  for (let index = start; index >= 0; index -= 1) {
    const atom = atoms[index];
    if (atom.type === "character") return atom;
    if (isLayoutBoundary(atom)) return atom;
    if (commandWidth(atom) > 0) return atom;
  }
  return null;
}

function nextInlineAtom(atoms, start) {
  for (let index = start; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") return atom;
    if (isLayoutBoundary(atom)) return atom;
    if (commandWidth(atom) > 0) return atom;
  }
  return null;
}

function isLayoutBoundary(atom) {
  if (atom.type !== "command") return false;
  if (["N", "FIN", "DEF", "DF2", "DFT", "CLR", "PGE", "BOX", "POS"].includes(atom.name)) return true;
  if (["END", "NXT", "DES", "ESC", "WAI"].includes(atom.name)) return true;
  return atom.name === "TPL" && isSpeakerTemplate(atom.args[0]);
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

function followingPageWordCount(atoms, start, limit) {
  let words = 0;
  let inWord = false;

  for (let index = start; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === "character") {
      if (/\s/.test(atom.value)) {
        inWord = false;
      } else if (!inWord) {
        words += 1;
        inWord = true;
      }
    } else if (["FIN", "END", "NXT", "DES", "ESC", "WAI", "CLR", "PGE", "DEF", "DF2", "DFT", "BOX", "POS"].includes(atom.name)
      || atom.name === "TPL" && isSpeakerTemplate(atom.args[0])) {
      break;
    } else if (atom.name === "N") {
      const choices = consecutiveIndentedLines(atoms, index + 1);
      if (choices >= 2) return limit + 1;
      const previous = previousInlineAtom(atoms, index - 1);
      const next = nextInlineAtom(atoms, index + 1);
      if (previous?.type === "command" && isLayoutBoundary(previous)
        || next?.type === "command" && isLayoutBoundary(next)) break;
      inWord = false;
    } else if (atom.name === "SKP") {
      inWord = false;
    } else if (commandWidth(atom) > 0 && !inWord) {
      words += 1;
      inWord = true;
    }

    if (words > limit) return words;
  }

  return words;
}

function dialogTableColumns(table) {
  const label = /_([0-9A-F]{6})(?:\+[0-9A-F]+)?$/i.exec(table ?? "")?.[1].toUpperCase();
  return DIALOG_TABLE_COLUMNS.get(label) ?? 17;
}

function commandWidth(atom) {
  if (atom.name === "NAM") return 5;
  if (atom.name === "TPL") return atom.args[0]?.toUpperCase() === "0" ? 7 : 5;
  if (atom.name === "TBL") return dialogTableColumns(atom.args[0]);
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

export { dialogTableColumns, normalizeSoftBreaks, reflow, shouldReflow, tokenize };
