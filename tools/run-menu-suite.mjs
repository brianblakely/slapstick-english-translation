#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  applyScenarioToState,
  INVENTORY_FIRST_BAG_SLOT,
  INVENTORY_LAST_BAG_SLOT,
  parseSnes9xState,
  WRAM,
} from "./scenario-state.mjs";
import { MENU_SUITE_CASES } from "./menu-suite-cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRom = join(root, "build", "Slap Stick (Japan) [EN].sfc");
const defaultOutput = join(root, "build", "menu-suite");
const defaultBaselines = join(root, "scenarios", "menu-suite-baselines.json");
const smokeRunner = join(root, "tools", "run-libretro-smoke.mjs");
const scenarioRunner = join(root, "tools", "run-scenario.mjs");

const ADDRESSES = Object.freeze({
  mainMenuState: 0x05fa,
  config: 0x0674,
  robot1Energy: 0x068a,
  robot1MaxEnergy: 0x0690,
  robot1Power: 0x0696,
  robot1Guard: 0x069c,
  knownInventions: 0x07b0,
});

function usage() {
  return `Usage: npm run test:menus -- [options]

Exercise every Invention Machine function and every main-menu tab with fully
populated deterministic fixtures. The suite writes PNG captures, a contact
sheet, an HTML gallery, and a machine-readable report.

Options:
      --rom <file>          Translated ROM (default: build/Slap Stick (Japan) [EN].sfc)
      --core <file>         Snes9x libretro core (otherwise use the project cache)
      --output-dir <dir>    Artifacts directory (default: build/menu-suite)
      --baselines <file>    Screenshot baseline manifest
      --update-baselines    Accept the current deterministic screenshots
  -h, --help                Show this help
`;
}

function parseArguments(argv) {
  const options = {
    rom: defaultRom,
    core: process.env.SNES9X_LIBRETRO_CORE,
    output: defaultOutput,
    baselines: defaultBaselines,
    updateBaselines: false,
  };
  const valueAfter = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (argument === "--update-baselines") options.updateBaselines = true;
    else if (argument === "--rom") options.rom = valueAfter(index++, argument);
    else if (argument === "--core") options.core = valueAfter(index++, argument);
    else if (argument === "--output-dir") options.output = valueAfter(index++, argument);
    else if (argument === "--baselines") options.baselines = valueAfter(index++, argument);
    else throw new Error(`Unknown option ${argument}`);
  }
  for (const field of ["rom", "output", "baselines"]) options[field] = resolve(options[field]);
  if (options.core) options.core = resolve(options.core);
  return options;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function localPath(path) {
  const local = relative(root, path);
  return local && !local.startsWith("..") ? local : path;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} does not exist: ${path}`);
    throw new Error(`Could not read ${label} ${path}: ${error.message}`);
  }
}

function runNode(script, arguments_, label) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error && result.status === null) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit status ${result.status}`).trim();
    throw new Error(`${label} failed:\n${detail}`);
  }
  return result;
}

function generateScenario(name, output, options) {
  const arguments_ = [name, "--output", output, "--rom", options.rom];
  if (options.core) arguments_.push("--core", options.core);
  runNode(scenarioRunner, arguments_, `scenario ${name}`);
  if (!existsSync(output)) throw new Error(`Scenario ${name} did not create ${output}`);
}

function parsePpm(path) {
  const input = readFileSync(path);
  let cursor = 0;
  const skipSpaceAndComments = () => {
    while (cursor < input.length) {
      if (input[cursor] === 0x23) {
        while (cursor < input.length && input[cursor] !== 0x0a) cursor += 1;
      } else if (input[cursor] === 0x20 || input[cursor] === 0x09 ||
                 input[cursor] === 0x0a || input[cursor] === 0x0d) {
        cursor += 1;
      } else {
        break;
      }
    }
  };
  const token = () => {
    skipSpaceAndComments();
    const start = cursor;
    while (cursor < input.length && ![0x20, 0x09, 0x0a, 0x0d].includes(input[cursor])) cursor += 1;
    if (start === cursor) throw new Error(`Invalid PPM header in ${path}`);
    return input.subarray(start, cursor).toString("ascii");
  };
  const magic = token();
  const width = Number.parseInt(token(), 10);
  const height = Number.parseInt(token(), 10);
  const maximum = Number.parseInt(token(), 10);
  if (magic !== "P6" || !Number.isInteger(width) || !Number.isInteger(height) || maximum !== 255) {
    throw new Error(`Unsupported PPM ${path}: expected binary RGB with an 8-bit maximum`);
  }
  if (input[cursor] === 0x0d && input[cursor + 1] === 0x0a) cursor += 2;
  else if ([0x20, 0x09, 0x0a, 0x0d].includes(input[cursor])) cursor += 1;
  else throw new Error(`PPM ${path} has no separator before its pixel data`);
  const pixels = input.subarray(cursor);
  const expected = width * height * 3;
  if (pixels.length !== expected) {
    throw new Error(`PPM ${path} has ${pixels.length} pixel bytes; expected ${expected}`);
  }
  return { width, height, pixels };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (1 + width * 3);
    scanlines[outputOffset] = 0;
    pixels.copy(scanlines, outputOffset + 1, row * width * 3, (row + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

function imageMetrics(image) {
  const colors = new Set();
  let nonBlack = 0;
  for (let index = 0; index < image.pixels.length; index += 3) {
    const red = image.pixels[index];
    const green = image.pixels[index + 1];
    const blue = image.pixels[index + 2];
    colors.add((red << 16) | (green << 8) | blue);
    if (red !== 0 || green !== 0 || blue !== 0) nonBlack += 1;
  }
  return {
    uniqueColors: colors.size,
    nonBlackRatio: nonBlack / (image.width * image.height),
  };
}

function assertRendered(image, metrics, capture) {
  if (image.width !== 256 || image.height !== 224) {
    throw new Error(`${capture.id} rendered at ${image.width}x${image.height}; expected 256x224`);
  }
  if (metrics.uniqueColors < 4) {
    throw new Error(`${capture.id} has only ${metrics.uniqueColors} colors and appears not to have rendered`);
  }
  if (metrics.nonBlackRatio < 0.02) {
    throw new Error(`${capture.id} is ${(metrics.nonBlackRatio * 100).toFixed(2)}% non-black and appears blank`);
  }
}

function decodeBcdMoney(ram) {
  const low = ram[WRAM.money];
  const middle = ram[WRAM.money + 1];
  const high = ram[WRAM.money + 2];
  return (low & 0x0f) + ((low >>> 4) & 0x0f) * 10 +
    (middle & 0x0f) * 100 + ((middle >>> 4) & 0x0f) * 1000 +
    (high & 0x0f) * 10000;
}

function word(ram, address) {
  return ram.readUInt16LE(address);
}

function assertFixture(statePath) {
  const { ram } = parseSnes9xState(readFileSync(statePath));
  const emptySlots = [];
  for (let slot = INVENTORY_FIRST_BAG_SLOT; slot <= INVENTORY_LAST_BAG_SLOT; slot += 1) {
    if (word(ram, WRAM.inventory + slot * 2) === 0) emptySlots.push(slot);
  }
  if (emptySlots.length) throw new Error(`Populated fixture has empty bag slots: ${emptySlots.join(", ")}`);
  if ((word(ram, WRAM.robotAvailability) & 0x0707) !== 0x0707) {
    throw new Error("Populated fixture does not enable all three robots");
  }
  for (let address = ADDRESSES.knownInventions; address < ADDRESSES.knownInventions + 16; address += 1) {
    if (ram[address] !== 0xff) throw new Error(`Populated fixture is missing inventions at WRAM $${address.toString(16).toUpperCase()}`);
  }
  if (word(ram, ADDRESSES.mainMenuState) !== 3) {
    throw new Error("Populated fixture is not primed for the main menu");
  }
  return {
    bagSlotsUsed: INVENTORY_LAST_BAG_SLOT - INVENTORY_FIRST_BAG_SLOT + 1,
    robots: 3,
    knownInventionBytes: 16,
  };
}

function assertCase(name, ram) {
  switch (name) {
    case "created-item": {
      const money = decodeBcdMoney(ram);
      if (money !== 99799) throw new Error(`Create left ${money} money; expected 99799`);
      return `created Metal Sword; 200 tron charged, money=${money}`;
    }
    case "combined-items":
      if (word(ram, WRAM.inventory + 2 * 2) !== 0) throw new Error("Combine did not consume bag slot 2");
      return "combined Metal Sword + Scrap 1; second ingredient consumed";
    case "recycled-item":
      if (word(ram, WRAM.inventory + 1 * 2) !== 0) throw new Error("Recycle did not clear bag slot 1");
      return "recycled Metal Sword; source slot cleared";
    case "maintained-robot": {
      const energy = word(ram, ADDRESSES.robot1Energy);
      const money = decodeBcdMoney(ram);
      if (energy !== 20 || money !== 99989) {
        throw new Error(`Maintenance produced ENERGY ${energy} and money ${money}; expected 20 and 99989`);
      }
      return `restored Alpha to ${energy}/20 ENERGY; money=${money}`;
    }
    case "programmed-robot": {
      const maxEnergy = word(ram, ADDRESSES.robot1MaxEnergy);
      const power = word(ram, ADDRESSES.robot1Power);
      if (maxEnergy !== 22 || power !== 1) {
        throw new Error(`Program produced max ENERGY ${maxEnergy} and POWER ${power}; expected 22 and 1`);
      }
      return `programmed Alpha to max ENERGY ${maxEnergy}, POWER ${power}`;
    }
    case "changed-config": {
      const config = ram[ADDRESSES.config];
      if (config !== 0x90) throw new Error(`Config byte is $${config.toString(16)}; expected $90`);
      return "changed message speed and sound mode; config=$90";
    }
    case "built-robot": {
      const availability = word(ram, WRAM.robotAvailability);
      const name = Array.from(ram.subarray(WRAM.robotNameMenu, WRAM.robotNameMenu + 5));
      const energy = word(ram, ADDRESSES.robot1Energy);
      const maxEnergy = word(ram, ADDRESSES.robot1MaxEnergy);
      const power = word(ram, ADDRESSES.robot1Power);
      const guard = word(ram, ADDRESSES.robot1Guard);
      if ((availability & 0x0101) !== 0x0101) throw new Error("Build did not enable robot slot 1");
      if (!name.every((value) => value === 0x21)) throw new Error(`Built robot name bytes are ${name.join(",")}; expected AAAAA`);
      if (energy !== 40 || maxEnergy !== 42 || power !== 1 || guard !== 1) {
        throw new Error(`Built robot stats are ${energy}/${maxEnergy}, POWER ${power}, GUARD ${guard}; expected 40/42, 1, 1`);
      }
      return "built and named AAAAA; ENERGY 40/42, POWER 1, GUARD 1";
    }
    default:
      throw new Error(`Unknown menu-suite assertion ${name}`);
  }
}

function runCase(testCase, states, options, screenshotsDirectory) {
  const inputState = states.get(testCase.state);
  if (!inputState) throw new Error(`${testCase.id} needs unavailable state ${testCase.state}`);
  const caseDirectory = join(options.output, "runs", testCase.id);
  const arguments_ = [
    options.rom,
    "--load-state",
    inputState,
    "--frames",
    String(testCase.frames),
    "--snapshot-every",
    String(testCase.snapshotEvery),
    "--output-dir",
    caseDirectory,
  ];
  for (const pulse of testCase.pulses ?? []) arguments_.push("--pulse", pulse);
  for (const repeat of testCase.repeats ?? []) arguments_.push("--repeat", repeat);
  if (testCase.dumpWram) arguments_.push("--dump-wram-at", String(testCase.frames));
  if (testCase.saveAs) {
    const savedState = join(options.output, "states", `${testCase.saveAs}.state`);
    arguments_.push("--save-state-output", savedState);
    states.set(testCase.saveAs, savedState);
  }
  if (options.core) arguments_.push("--core", options.core);

  process.stdout.write(`  ${testCase.id.padEnd(26)} `);
  runNode(smokeRunner, arguments_, `menu case ${testCase.id}`);
  const harnessReport = readJson(join(caseDirectory, "report.json"), `${testCase.id} harness report`);
  let assertion;
  if (testCase.assertion) {
    const dumpPath = join(caseDirectory, `wram-${String(testCase.frames).padStart(6, "0")}.bin`);
    if (!existsSync(dumpPath)) throw new Error(`${testCase.id} did not write its WRAM dump`);
    assertion = assertCase(testCase.assertion, readFileSync(dumpPath));
  }

  const captures = testCase.captures.map((capture) => {
    const ppmPath = join(caseDirectory, `frame-${String(capture.frame).padStart(6, "0")}.ppm`);
    if (!existsSync(ppmPath)) {
      throw new Error(`${testCase.id} did not capture requested frame ${capture.frame}; check snapshotEvery`);
    }
    const image = parsePpm(ppmPath);
    const metrics = imageMetrics(image);
    assertRendered(image, metrics, capture);
    const pngPath = join(screenshotsDirectory, `${capture.id}.png`);
    writeFileSync(pngPath, encodePng(image));
    return {
      ...capture,
      group: testCase.group,
      feature: testCase.feature,
      case: testCase.id,
      image,
      pngPath,
      rgbSha256: sha256(image.pixels),
      ...metrics,
    };
  });
  process.stdout.write(`PASS${assertion ? ` — ${assertion}` : ""}\n`);
  return {
    id: testCase.id,
    group: testCase.group,
    feature: testCase.feature,
    framesRun: harnessReport.framesRun,
    assertion,
    core: harnessReport.core,
    romSha256: harnessReport.romSha256,
    captures,
  };
}

function makeContactSheet(captures) {
  const columns = 4;
  const gap = 8;
  const tileWidth = 256;
  const tileHeight = 224;
  const rows = Math.ceil(captures.length / columns);
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;
  const pixels = Buffer.alloc(width * height * 3, 0x18);
  captures.forEach((capture, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + column * (tileWidth + gap);
    const top = gap + row * (tileHeight + gap);
    for (let sourceRow = 0; sourceRow < tileHeight; sourceRow += 1) {
      const sourceStart = sourceRow * tileWidth * 3;
      const targetStart = ((top + sourceRow) * width + left) * 3;
      capture.image.pixels.copy(pixels, targetStart, sourceStart, sourceStart + tileWidth * 3);
    }
  });
  return { width, height, pixels };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeGallery(path, captures, summary) {
  const groups = [];
  for (const capture of captures) {
    let group = groups.find(({ name }) => name === capture.group);
    if (!group) {
      group = { name: capture.group, captures: [] };
      groups.push(group);
    }
    group.captures.push(capture);
  }
  const sections = groups.map((group) => `
    <section>
      <h2>${escapeHtml(group.name)}</h2>
      <div class="grid">
        ${group.captures.map((capture) => `
          <figure>
            <img src="screenshots/${encodeURIComponent(capture.id)}.png" width="512" height="448" alt="${escapeHtml(capture.title)}">
            <figcaption><strong>${escapeHtml(capture.title)}</strong><span>frame ${capture.frame} · ${capture.uniqueColors} colors · ${escapeHtml(capture.rgbSha256.slice(0, 12))}</span></figcaption>
          </figure>`).join("")}
      </div>
    </section>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Slap Stick menu test suite</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; background: #11151b; color: #e8edf4; }
    body { max-width: 1500px; margin: 0 auto; padding: 28px; }
    h1 { margin-bottom: .35rem; } h2 { margin-top: 2.5rem; border-bottom: 1px solid #39414d; padding-bottom: .45rem; }
    .summary { color: #aeb9c8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(512px, 1fr)); gap: 24px; }
    figure { margin: 0; padding: 12px; background: #1a2029; border: 1px solid #303947; border-radius: 8px; }
    img { display: block; width: 512px; max-width: 100%; height: auto; image-rendering: pixelated; background: #000; }
    figcaption { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
    figcaption span { color: #8f9aaa; font-size: .82rem; }
  </style>
</head>
<body>
  <h1>Slap Stick menu test suite</h1>
  <p class="summary">${escapeHtml(summary)}</p>
  ${sections}
</body>
</html>
`;
  writeFileSync(path, html);
}

function baselineEntries(captures) {
  return Object.fromEntries(captures.map((capture) => [capture.id, {
    width: capture.image.width,
    height: capture.image.height,
    rgbSha256: capture.rgbSha256,
  }]));
}

function verifyBaselines(captures, path, update) {
  const current = baselineEntries(captures);
  if (update) {
    writeFileSync(path, `${JSON.stringify({ version: 1, captures: current }, null, 2)}\n`);
    return { updated: true, compared: captures.length };
  }
  const baseline = readJson(path, "menu screenshot baselines");
  if (baseline.version !== 1 || !baseline.captures || typeof baseline.captures !== "object") {
    throw new Error(`Unsupported baseline manifest ${path}`);
  }
  const failures = [];
  for (const [id, actual] of Object.entries(current)) {
    const expected = baseline.captures[id];
    if (!expected) failures.push(`${id}: no baseline`);
    else if (expected.width !== actual.width || expected.height !== actual.height || expected.rgbSha256 !== actual.rgbSha256) {
      failures.push(`${id}: expected ${expected.rgbSha256 ?? "invalid"}, got ${actual.rgbSha256}`);
    }
  }
  for (const id of Object.keys(baseline.captures)) {
    if (!current[id]) failures.push(`${id}: stale baseline`);
  }
  if (failures.length) {
    throw new Error(`Screenshot baseline mismatch:\n  ${failures.join("\n  ")}\nInspect ${localPath(dirname(captures[0].pngPath))} and rerun with --update-baselines if intentional.`);
  }
  return { updated: false, compared: captures.length };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!existsSync(options.rom)) {
    throw new Error(`Translated ROM does not exist: ${options.rom}\nRun npm run build:rom first, or pass --rom.`);
  }
  if (options.core && !existsSync(options.core)) throw new Error(`Snes9x core does not exist: ${options.core}`);
  mkdirSync(options.output, { recursive: true });
  mkdirSync(dirname(options.baselines), { recursive: true });
  const statesDirectory = join(options.output, "states");
  const screenshotsDirectory = join(options.output, "screenshots");
  mkdirSync(statesDirectory, { recursive: true });
  mkdirSync(screenshotsDirectory, { recursive: true });

  process.stdout.write("Preparing deterministic menu fixtures\n");
  const populatedState = join(statesDirectory, "menu-suite-populated.state");
  const buildState = join(statesDirectory, "invention-machine-build.state");
  generateScenario("menu-suite-populated", populatedState, options);
  generateScenario("invention-machine-build", buildState, options);
  const fixture = assertFixture(populatedState);

  const vacancyState = join(statesDirectory, "menu-suite-create-vacancy.state");
  const vacancy = applyScenarioToState(readFileSync(populatedState), {
    name: "menu-suite-create-vacancy",
    wram: [{
      address: WRAM.inventory + INVENTORY_LAST_BAG_SLOT * 2,
      width: 2,
      value: 0,
    }],
  });
  writeFileSync(vacancyState, vacancy.state);

  const states = new Map([
    ["populated", populatedState],
    ["create-vacancy", vacancyState],
    ["build-base", buildState],
  ]);
  process.stdout.write(`Fixture PASS — ${fixture.bagSlotsUsed} bag slots, ${fixture.robots} robots, all invention bits\n\nRunning menu cases\n`);
  const cases = MENU_SUITE_CASES.map((testCase) => runCase(testCase, states, options, screenshotsDirectory));
  const captures = cases.flatMap((testCase) => testCase.captures);
  const baseline = verifyBaselines(captures, options.baselines, options.updateBaselines);
  const contactSheetPath = join(options.output, "contact-sheet.png");
  writeFileSync(contactSheetPath, encodePng(makeContactSheet(captures)));
  const assertionCount = cases.filter(({ assertion }) => assertion).length;
  const summary = `${cases.length} deterministic runs · ${captures.length} visual captures · ${assertionCount} gameplay assertions · ${baseline.updated ? "baselines updated" : "all baselines matched"}`;
  const galleryPath = join(options.output, "index.html");
  writeGallery(galleryPath, captures, summary);
  const first = cases[0];
  const report = {
    schemaVersion: 1,
    status: "passed",
    summary,
    rom: { path: localPath(options.rom), sha256: first.romSha256 },
    core: first.core,
    fixture,
    baselines: { path: localPath(options.baselines), ...baseline },
    cases: cases.map(({ captures: caseCaptures, ...testCase }) => ({
      ...testCase,
      captures: caseCaptures.map(({ image, pngPath, ...capture }) => ({
        ...capture,
        png: localPath(pngPath),
        width: image.width,
        height: image.height,
      })),
    })),
    artifacts: {
      gallery: localPath(galleryPath),
      contactSheet: localPath(contactSheetPath),
      screenshots: localPath(screenshotsDirectory),
    },
  };
  writeFileSync(join(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nPASS — ${summary}\nGallery: ${localPath(galleryPath)}\nContact sheet: ${localPath(contactSheetPath)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`menu-suite: ${error.message}\n`);
  process.exitCode = 1;
}
