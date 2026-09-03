#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applyBattleEntryToState,
  applyScenarioToState,
  parseSnes9xState,
  resolveBattleEntry,
  ScenarioError,
  WRAM,
} from "./scenario-state.mjs";
import { createScenarioRom } from "./scenario-rom.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultScenariosDirectory = join(root, "scenarios");
const defaultCheckpointDirectory = join(defaultScenariosDirectory, "checkpoints");
const defaultCatalogPath = join(defaultScenariosDirectory, "catalog.json");
const defaultRomPath = join(root, "build", "Slap Stick (Japan) [EN].sfc");

function usage() {
  return `Usage: npm run scenario -- <name-or-file> [options]

Create a directly bootable Snes9x state or self-initializing test ROM from a scenario.

Options:
  -o, --output <file>       Output (default: build/scenarios/<name>.state or .sfc)
      --format <state|rom>  Output format (default: state)
      --checkpoint <file>   Use a legacy state as the scenario seed
      --checkpoints <dir>   Directory containing legacy named checkpoints
      --catalog <file>      Override scenarios/catalog.json
      --rom <file>          Base translated ROM
      --core <file>         Snes9x libretro core used for launch and runtime steps
      --no-interaction      Ignore scenario.steps and scenario.interaction
      --dry-run             Validate and report without writing files
      --list                List available scenarios
  -h, --help                Show this help

Without --checkpoint or scenario.checkpoint, state output cold-boots a temporary
scenario ROM straight into the requested map and serializes it after the stock
map loader settles. Named checkpoint resolution also honors
SLAPSTICK_CHECKPOINT_DIR. Runtime steps honor SNES9X_LIBRETRO_CORE and otherwise
prepare the pinned project core through the visual harness.
`;
}

function fail(message) {
  throw new ScenarioError(message);
}

function parseArguments(argv) {
  const options = {
    scenario: undefined,
    output: undefined,
    checkpoint: undefined,
    checkpoints: process.env.SLAPSTICK_CHECKPOINT_DIR,
    catalog: undefined,
    rom: undefined,
    core: process.env.SNES9X_LIBRETRO_CORE,
    format: "state",
    interaction: true,
    dryRun: false,
    list: false,
  };
  const takeValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${option} needs a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--no-interaction") options.interaction = false;
    else if (argument === "--output" || argument === "-o") options.output = takeValue(index++, argument);
    else if (argument === "--checkpoint") options.checkpoint = takeValue(index++, argument);
    else if (argument === "--checkpoints") options.checkpoints = takeValue(index++, argument);
    else if (argument === "--catalog") options.catalog = takeValue(index++, argument);
    else if (argument === "--rom") options.rom = takeValue(index++, argument);
    else if (argument === "--core") options.core = takeValue(index++, argument);
    else if (argument === "--format") options.format = takeValue(index++, argument);
    else if (argument.startsWith("-")) fail(`Unknown option ${argument}`);
    else if (options.scenario === undefined) options.scenario = argument;
    else fail(`Unexpected argument ${argument}`);
  }
  if (options.format !== "state" && options.format !== "rom") {
    fail('--format must be either "state" or "rom"');
  }
  return options;
}

function readJson(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} does not exist: ${path}`);
    fail(`Could not read ${label} ${path}: ${error.message}`);
  }
  return value;
}

function scenarioPath(reference) {
  const direct = resolve(reference);
  if (existsSync(direct)) return direct;
  const candidate = join(defaultScenariosDirectory, extname(reference) ? reference : `${reference}.json`);
  if (existsSync(candidate)) return candidate;
  fail(`Scenario not found: ${reference} (looked for ${candidate})`);
}

function resolveRelative(reference, baseDirectory) {
  return isAbsolute(reference) ? reference : resolve(baseDirectory, reference);
}

function checkpointPath(reference, scenarioDirectory, checkpointDirectory) {
  const candidates = [];
  if (isAbsolute(reference)) candidates.push(reference);
  else {
    candidates.push(resolve(scenarioDirectory, reference));
    candidates.push(resolve(root, reference));
    for (const suffix of ["", ".state", ".bin"]) {
      candidates.push(resolve(checkpointDirectory, `${reference}${suffix}`));
    }
  }
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match) return match;
  fail(
    `Checkpoint ${JSON.stringify(reference)} was not found. ` +
      `Put it in ${checkpointDirectory}, use a path in scenario.checkpoint, or pass --checkpoint.`,
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}

function runSteps(state, steps, options, scenario, scenarioDirectory) {
  const romReference = options.rom ?? scenario.rom ?? defaultRomPath;
  const rom = typeof romReference === "string"
    ? resolveRelative(romReference, scenario.rom && !options.rom ? scenarioDirectory : root)
    : fail("scenario.rom must be a path string");
  if (!existsSync(rom)) {
    fail(`Runtime steps need a ROM, but none was found at ${rom}. Run npm run build:rom or pass --rom.`);
  }
  const core = options.core ? resolve(options.core) : undefined;
  if (core && !existsSync(core)) {
    fail(`Runtime steps need the Snes9x libretro core selected by --core or SNES9X_LIBRETRO_CORE, but none was found at ${core}.`);
  }

  const work = mkdtempSync(join(tmpdir(), "slapstick-scenario-"));
  const input = join(work, "patched.state");
  const output = join(work, "interacted.state");
  const runnerOutput = join(work, "runner");
  writeFileSync(input, state);
  let frameCount = 0;
  const pulses = [];
  for (const step of steps) {
    if (step.waitFrames !== undefined) {
      frameCount += step.waitFrames;
      continue;
    }
    const start = frameCount + step.delayFrames;
    pulses.push(`${step.button}:${start}:${step.holdFrames}`);
    frameCount += step.delayFrames + step.holdFrames + step.afterFrames;
  }
  const finalFrame = Math.max(0, frameCount - 1);
  const arguments_ = [
    join(root, "tools", "run-libretro-smoke.mjs"),
    rom,
    "--load-state",
    input,
    "--frames",
    String(finalFrame),
    "--snapshot-every",
    String(frameCount + 1),
    "--save-state-output",
    output,
    "--output-dir",
    runnerOutput,
  ];
  for (const pulse of pulses) arguments_.push("--pulse", pulse);
  if (core) arguments_.push("--core", core);

  try {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error && result.status === null) {
      fail(`Could not start the libretro runner: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "unknown libretro error").trim();
      fail(`Runtime steps failed: ${detail}`);
    }
    if (!existsSync(output)) fail("The libretro runner completed without writing the final state");
    let coreReport;
    const reportPath = join(runnerOutput, "report.json");
    if (existsSync(reportPath)) coreReport = readJson(reportPath, "libretro report").core;
    return { state: readFileSync(output), core: coreReport, framesRun: frameCount, pulses };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function bootstrapScenarioState(baseRom, generated, options) {
  const core = options.core ? resolve(options.core) : undefined;
  if (core && !existsSync(core)) {
    fail(`Checkpoint-free launch needs the Snes9x libretro core selected by --core or SNES9X_LIBRETRO_CORE, but none was found at ${core}.`);
  }
  const work = mkdtempSync(join(tmpdir(), "slapstick-scenario-boot-"));
  const rom = join(work, "scenario.sfc");
  const output = join(work, "scenario.state");
  const runnerOutput = join(work, "runner");
  writeFileSync(rom, generated.rom);
  const arguments_ = [
    join(root, "tools", "run-libretro-smoke.mjs"),
    rom,
    "--frames",
    String(generated.launch.timeoutFrames),
    "--snapshot-every",
    String(generated.launch.timeoutFrames + 1),
    "--stop-when-wram",
    `0x${WRAM.currentMap.toString(16)}:2:eq:0x${generated.currentMap.toString(16)}`,
    "--stop-when-wram",
    `0x${WRAM.nextMap.toString(16)}:2:eq:0`,
    "--stop-when-wram",
    `0x${WRAM.mapLoadComplete.toString(16)}:2:eq:0x70ff`,
    "--stop-when-stable",
    "1",
    "--stop-after-match",
    String(generated.launch.settleFrames),
    "--require-stop",
    "--save-state-output",
    output,
    "--output-dir",
    runnerOutput,
  ];
  if (generated.launch.ready === "field" || generated.entry.type === "battle") {
    arguments_.push(
      "--stop-when-wram",
      `0x${WRAM.playerActorSlot.toString(16)}:2:ge:0x1000`,
      "--stop-when-wram",
      `0x${WRAM.playerActorSlot.toString(16)}:2:lt:0x2000`,
    );
  }
  if (core) arguments_.push("--core", core);

  try {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error && result.status === null) {
      fail(`Could not start the checkpoint-free launcher: ${result.error.message}`);
    }
    const reportPath = join(runnerOutput, "report.json");
    const runnerReport = existsSync(reportPath) ? readJson(reportPath, "libretro report") : undefined;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "unknown libretro error").trim();
      const observed = runnerReport?.stop?.conditions
        ?.map(({ address, actual }) => `0x${address.toString(16)}=0x${actual.toString(16)}`)
        .join(", ");
      fail(`Checkpoint-free launch did not reach map 0x${generated.currentMap.toString(16).padStart(4, "0")}: ${detail}${observed ? ` (observed ${observed})` : ""}`);
    }
    if (!existsSync(output)) fail("The checkpoint-free launcher completed without writing a state");
    const state = readFileSync(output);
    const { ram } = parseSnes9xState(state);
    const currentMap = ram.readUInt16LE(WRAM.currentMap);
    if (currentMap !== generated.currentMap) {
      fail(`Checkpoint-free launch stopped on map 0x${currentMap.toString(16).padStart(4, "0")}, expected 0x${generated.currentMap.toString(16).padStart(4, "0")}`);
    }
    return {
      state,
      core: runnerReport?.core,
      framesRun: runnerReport?.framesRun,
      stop: runnerReport?.stop,
      generatedRomSha256: sha256(generated.rom),
      baseRomSha256: sha256(baseRom),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runBattleEntry(state, baseRom, baseRomPath, entry, options) {
  const prepared = applyBattleEntryToState(state, baseRom, entry);
  const core = options.core ? resolve(options.core) : undefined;
  if (core && !existsSync(core)) {
    fail(`Battle launch needs the Snes9x libretro core selected by --core or SNES9X_LIBRETRO_CORE, but none was found at ${core}.`);
  }
  const work = mkdtempSync(join(tmpdir(), "slapstick-scenario-battle-"));
  const input = join(work, "field.state");
  const output = join(work, "battle.state");
  const runnerOutput = join(work, "runner");
  writeFileSync(input, prepared.state);
  const arguments_ = [
    join(root, "tools", "run-libretro-smoke.mjs"),
    baseRomPath,
    "--load-state",
    input,
    "--frames",
    String(entry.timeoutFrames),
    "--snapshot-every",
    String(entry.timeoutFrames + 1),
    "--stop-when-wram",
    `0x${WRAM.currentMap.toString(16)}:2:eq:0x${prepared.battleMap.toString(16)}`,
    "--stop-when-wram",
    `0x${WRAM.nextMap.toString(16)}:2:eq:0`,
  ];
  if (entry.ready === "command") {
    arguments_.push(
      "--stop-when-wram",
      `0x${WRAM.battleReady.toString(16)}:2:eq:0`,
      "--stop-when-wram",
      `0x${WRAM.battleMode.toString(16)}:1:eq:0x${prepared.availabilityMask.toString(16)}`,
    );
  }
  arguments_.push(
    "--stop-when-stable",
    "1",
    "--stop-after-match",
    String(entry.settleFrames),
    "--require-stop",
    "--save-state-output",
    output,
    "--output-dir",
    runnerOutput,
  );
  if (core) arguments_.push("--core", core);

  try {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error && result.status === null) {
      fail(`Could not start the direct battle launcher: ${result.error.message}`);
    }
    const reportPath = join(runnerOutput, "report.json");
    const runnerReport = existsSync(reportPath) ? readJson(reportPath, "libretro report") : undefined;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "unknown libretro error").trim();
      fail(`Direct battle launch did not become ${entry.ready}: ${detail}`);
    }
    if (!existsSync(output)) fail("The direct battle launcher completed without writing a state");
    return {
      ...prepared,
      state: readFileSync(output),
      framesRun: runnerReport?.framesRun,
      stop: runnerReport?.stop,
      core: runnerReport?.core,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function listScenarios() {
  if (!existsSync(defaultScenariosDirectory)) return [];
  return readdirSync(defaultScenariosDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .filter((name) => name !== "catalog" && name !== "schema")
    .sort();
}

function displayPath(path) {
  const local = relative(root, path);
  return local && !local.startsWith("..") ? local : path;
}

function romPath(options, scenario, scenarioDirectory) {
  const reference = options.rom ?? scenario.rom ?? defaultRomPath;
  if (typeof reference !== "string") fail("scenario.rom must be a path string");
  return resolveRelative(reference, scenario.rom && !options.rom ? scenarioDirectory : root);
}

function runRomScenario(options, scenario, sourcePath, sourceDirectory, catalog) {
  const baseRomPath = romPath(options, scenario, sourceDirectory);
  if (!existsSync(baseRomPath)) {
    fail(`Test-ROM generation needs the translated ROM at ${baseRomPath}. Run npm run build:rom or pass --rom.`);
  }
  const baseRom = readFileSync(baseRomPath);
  const generated = createScenarioRom(baseRom, scenario, catalog);
  if (generated.entry.type !== "field") {
    fail("Direct battle entry is supported by state output; use --format state (the default)");
  }
  if (options.interaction && (generated.interaction || generated.steps.length)) {
    fail("scenario.steps and scenario.interaction are only supported for state output; pass --no-interaction to omit them from a test ROM");
  }
  const output = resolve(options.output ?? join(root, "build", "scenarios", `${scenario.name}.sfc`));
  if (output === resolve(baseRomPath)) fail("Output must not overwrite the base ROM");
  const report = {
    scenario: scenario.name,
    format: "rom",
    source: displayPath(sourcePath),
    baseRom: displayPath(baseRomPath),
    baseSha256: sha256(baseRom),
    output: displayPath(output),
    outputSha256: sha256(generated.rom),
    map: generated.currentMap,
    changes: generated.changes,
    initializer: {
      offset: `0x${generated.initializerOffset.toString(16).padStart(6, "0")}`,
      address: `$${generated.initializerAddress.toString(16).padStart(6, "0").toUpperCase()}`,
      size: generated.initializerSize,
      writes: generated.writes.map(({ address, ...write }) => ({
        address: `0x${address.toString(16).padStart(4, "0")}`,
        ...write,
      })),
    },
    autoboot: {
      offset: `0x${generated.autobootOffset.toString(16).padStart(6, "0")}`,
      address: `$${generated.autobootAddress.toString(16).padStart(6, "0").toUpperCase()}`,
      size: generated.autobootSize,
    },
    dryRun: options.dryRun,
  };

  if (!options.dryRun) {
    writeAtomic(output, generated.rom);
    writeAtomic(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  }

  const action = options.dryRun ? "Validated" : "Created";
  process.stdout.write(
    `${action} ${scenario.name} test ROM\n` +
      `  base ROM:    ${displayPath(baseRomPath)}\n` +
      `  map:         0x${generated.currentMap.toString(16).padStart(4, "0")}\n` +
      `  writes:      ${generated.writes.length}\n` +
      `  initializer: ${report.initializer.address} (${generated.initializerSize} bytes)\n` +
      `  autoboot:    ${report.autoboot.address} (${generated.autobootSize} bytes)\n` +
      `  output:      ${options.dryRun ? "(dry run)" : displayPath(output)}\n`,
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.list) {
    const names = listScenarios();
    process.stdout.write(names.length ? `${names.join("\n")}\n` : "No scenarios found.\n");
    if (!options.scenario) return;
  }
  if (!options.scenario) fail("A scenario name or JSON file is required (try --help)");

  const sourcePath = scenarioPath(options.scenario);
  const sourceDirectory = dirname(sourcePath);
  const scenario = readJson(sourcePath, "scenario");
  const catalogReference = options.catalog ?? scenario.catalog ?? defaultCatalogPath;
  if (typeof catalogReference !== "string") fail("scenario.catalog must be a path string");
  const catalogPath = resolveRelative(
    catalogReference,
    scenario.catalog && !options.catalog ? sourceDirectory : root,
  );
  const catalog = readJson(catalogPath, "scenario catalog");
  if (options.format === "rom") {
    runRomScenario(options, scenario, sourcePath, sourceDirectory, catalog);
    return;
  }
  const checkpointReference = options.checkpoint ?? scenario.checkpoint;
  let applied;
  let outputState;
  let seed;
  let checkpoint;
  let bootstrapReport;
  let selectedRomPath;
  let selectedRom;
  if (checkpointReference !== undefined) {
    if (typeof checkpointReference !== "string") fail("scenario.checkpoint must be a path string");
    const checkpointDirectory = resolve(options.checkpoints ?? defaultCheckpointDirectory);
    checkpoint = checkpointPath(checkpointReference, sourceDirectory, checkpointDirectory);
    const baseState = readFileSync(checkpoint);
    applied = applyScenarioToState(baseState, scenario, catalog);
    outputState = applied.state;
    seed = {
      type: "checkpoint",
      path: displayPath(checkpoint),
      sha256: sha256(baseState),
    };
  } else {
    selectedRomPath = romPath(options, scenario, sourceDirectory);
    if (!existsSync(selectedRomPath)) {
      fail(`Checkpoint-free launch needs the translated ROM at ${selectedRomPath}. Run npm run build:rom or pass --rom.`);
    }
    selectedRom = readFileSync(selectedRomPath);
    const generated = createScenarioRom(selectedRom, scenario, catalog);
    applied = generated;
    if (!options.dryRun) {
      bootstrapReport = bootstrapScenarioState(selectedRom, generated, options);
      outputState = bootstrapReport.state;
    }
    seed = {
      type: "cold-boot",
      baseRom: displayPath(selectedRomPath),
      baseRomSha256: sha256(selectedRom),
      generatedRomSha256: sha256(generated.rom),
      initializer: `$${generated.initializerAddress.toString(16).padStart(6, "0").toUpperCase()}`,
      autoboot: `$${generated.autobootAddress.toString(16).padStart(6, "0").toUpperCase()}`,
      framesRun: bootstrapReport?.framesRun,
      stop: bootstrapReport?.stop,
      core: bootstrapReport?.core,
    };
  }

  let entryReport;
  if (applied.entry.type === "battle") {
    selectedRomPath ??= romPath(options, scenario, sourceDirectory);
    if (!existsSync(selectedRomPath)) {
      fail(`Direct battle entry needs the translated ROM at ${selectedRomPath}. Run npm run build:rom or pass --rom.`);
    }
    selectedRom ??= readFileSync(selectedRomPath);
    if (options.dryRun) {
      entryReport = {
        ...resolveBattleEntry(selectedRom, applied.currentMap, applied.entry.encounter),
        ready: applied.entry.ready,
      };
    } else {
      entryReport = runBattleEntry(
        outputState,
        selectedRom,
        selectedRomPath,
        applied.entry,
        options,
      );
      outputState = entryReport.state;
    }
  }

  const runtimeSteps = [
    ...(applied.steps ?? []),
    ...(applied.interaction ? [applied.interaction] : []),
  ];
  let stepsReport;
  if (options.interaction && runtimeSteps.length && !options.dryRun) {
    stepsReport = runSteps(outputState, runtimeSteps, options, scenario, sourceDirectory);
    outputState = stepsReport.state;
  }

  const output = resolve(options.output ?? join(root, "build", "scenarios", `${scenario.name}.state`));
  if (checkpoint && output === resolve(checkpoint)) fail("Output must not overwrite the base checkpoint");
  const report = {
    scenario: scenario.name,
    format: "state",
    source: displayPath(sourcePath),
    seed,
    checkpoint: checkpoint ? displayPath(checkpoint) : undefined,
    output: displayPath(output),
    outputSha256: outputState ? sha256(outputState) : undefined,
    map: applied.currentMap,
    destinationMap: entryReport?.battleMap ?? applied.currentMap,
    changes: applied.changes,
    entry: entryReport
      ? {
          type: "battle",
          encounter: entryReport.encounter,
          returnMap: entryReport.returnMap,
          battleMap: entryReport.battleMap,
          ready: applied.entry.ready,
          changes: entryReport.changes,
          framesRun: entryReport.framesRun,
          stop: entryReport.stop,
          core: entryReport.core,
        }
      : { type: "field" },
    runtime: stepsReport
      ? { steps: runtimeSteps, framesRun: stepsReport.framesRun, pulses: stepsReport.pulses, core: stepsReport.core }
      : undefined,
    dryRun: options.dryRun,
  };

  if (!options.dryRun) {
    writeAtomic(output, outputState);
    writeAtomic(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  }

  const action = options.dryRun ? "Validated" : "Created";
  process.stdout.write(
      `${action} ${scenario.name}\n` +
      `  seed:       ${checkpoint ? displayPath(checkpoint) : "cold boot (no checkpoint)"}\n` +
      `  map:       0x${applied.currentMap.toString(16).padStart(4, "0")}\n` +
      `${entryReport ? `  entry:     battle 0x${entryReport.encounter.toString(16).padStart(2, "0")} on map 0x${entryReport.battleMap.toString(16).padStart(4, "0")}\n` : ""}` +
      `  changes:   ${applied.changes.length}\n` +
      `  output:    ${options.dryRun ? "(dry run)" : displayPath(output)}\n` +
      `${bootstrapReport ? `  bootstrap: ${bootstrapReport.framesRun} frames\n` : ""}` +
      `${stepsReport ? `  runtime:   ${runtimeSteps.length} steps (${stepsReport.framesRun} frames)\n` : ""}`,
  );
}

try {
  main();
} catch (error) {
  if (error instanceof ScenarioError) {
    process.stderr.write(`scenario: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
