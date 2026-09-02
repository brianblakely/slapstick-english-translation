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
import { applyScenarioToState, ScenarioError } from "./scenario-state.mjs";
import { createScenarioRom } from "./scenario-rom.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultScenariosDirectory = join(root, "scenarios");
const defaultCheckpointDirectory = join(defaultScenariosDirectory, "checkpoints");
const defaultCatalogPath = join(defaultScenariosDirectory, "catalog.json");
const defaultRomPath = join(root, "build", "Slap Stick (Japan) [EN].sfc");
const defaultCorePath = "/usr/lib/libretro/snes9x_libretro.so";

function usage() {
  return `Usage: npm run scenario -- <name-or-file> [options]

Create an Snes9x checkpoint or self-initializing test ROM from a scenario.

Options:
  -o, --output <file>       Output (default: build/scenarios/<name>.state or .sfc)
      --format <state|rom>  Output format (default: state)
      --checkpoint <file>   Override the scenario's base checkpoint
      --checkpoints <dir>   Directory containing named checkpoints
      --catalog <file>      Override scenarios/catalog.json
      --rom <file>          Base ROM, or ROM used for an immediate interaction
      --core <file>         Snes9x libretro core used for an interaction
      --no-interaction      Apply memory only, ignoring scenario.interaction
      --dry-run             Validate and report without writing files
      --list                List available scenarios
  -h, --help                Show this help

Named checkpoint resolution also honors SLAPSTICK_CHECKPOINT_DIR. The core
defaults to SNES9X_LIBRETRO_CORE, then ${defaultCorePath}.
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

function runInteraction(state, interaction, options, scenario, scenarioDirectory) {
  const romReference = options.rom ?? scenario.rom ?? defaultRomPath;
  const rom = typeof romReference === "string"
    ? resolveRelative(romReference, scenario.rom && !options.rom ? scenarioDirectory : root)
    : fail("scenario.rom must be a path string");
  if (!existsSync(rom)) {
    fail(`Interaction needs a ROM, but none was found at ${rom}. Build one or pass --rom.`);
  }
  const core = resolve(options.core ?? defaultCorePath);
  if (!existsSync(core)) {
    fail(`Interaction needs the Snes9x libretro core, but none was found at ${core}. Enter nix develop or pass --core.`);
  }

  const work = mkdtempSync(join(tmpdir(), "slapstick-scenario-"));
  const input = join(work, "patched.state");
  const output = join(work, "interacted.state");
  const runnerOutput = join(work, "runner");
  writeFileSync(input, state);
  const frameCount = interaction.delayFrames + interaction.holdFrames + interaction.afterFrames;
  const finalFrame = Math.max(0, frameCount - 1);
  const arguments_ = [
    join(root, "tools", "libretro-smoke.py"),
    rom,
    "--core",
    core,
    "--load-state",
    input,
    "--frames",
    String(finalFrame),
    "--snapshot-every",
    String(frameCount + 1),
    "--pulse",
    `${interaction.button}:${interaction.delayFrames}:${interaction.holdFrames}`,
    "--save-state-output",
    output,
    "--output-dir",
    runnerOutput,
  ];

  try {
    const result = spawnSync(process.env.PYTHON ?? "python3", arguments_, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error && result.status === null) {
      fail(`Could not start the libretro runner: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "unknown libretro error").trim();
      fail(`Immediate interaction failed: ${detail}`);
    }
    if (!existsSync(output)) fail("The libretro runner completed without writing the final state");
    let coreReport;
    const reportPath = join(runnerOutput, "report.json");
    if (existsSync(reportPath)) coreReport = readJson(reportPath, "libretro report").core;
    return { state: readFileSync(output), core: coreReport, framesRun: frameCount };
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
    fail(`Test-ROM generation needs the translated ROM at ${baseRomPath}. Run npm run build or pass --rom.`);
  }
  const baseRom = readFileSync(baseRomPath);
  const generated = createScenarioRom(baseRom, scenario, catalog);
  if (options.interaction && generated.interaction) {
    fail("scenario.interaction is only supported for state output; pass --no-interaction to omit it from a test ROM");
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
  if (typeof checkpointReference !== "string") fail("scenario.checkpoint must be a path string");
  const checkpointDirectory = resolve(options.checkpoints ?? defaultCheckpointDirectory);
  const checkpoint = checkpointPath(checkpointReference, sourceDirectory, checkpointDirectory);
  const baseState = readFileSync(checkpoint);
  const applied = applyScenarioToState(baseState, scenario, catalog);

  let outputState = applied.state;
  let interactionReport;
  if (options.interaction && applied.interaction && !options.dryRun) {
    interactionReport = runInteraction(outputState, applied.interaction, options, scenario, sourceDirectory);
    outputState = interactionReport.state;
  }

  const output = resolve(options.output ?? join(root, "build", "scenarios", `${scenario.name}.state`));
  if (output === resolve(checkpoint)) fail("Output must not overwrite the base checkpoint");
  const report = {
    scenario: scenario.name,
    format: "state",
    source: displayPath(sourcePath),
    checkpoint: displayPath(checkpoint),
    baseSha256: sha256(baseState),
    output: displayPath(output),
    outputSha256: sha256(outputState),
    map: applied.currentMap,
    changes: applied.changes,
    interaction: interactionReport
      ? { ...applied.interaction, framesRun: interactionReport.framesRun, core: interactionReport.core }
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
      `  checkpoint: ${displayPath(checkpoint)}\n` +
      `  map:       0x${applied.currentMap.toString(16).padStart(4, "0")}\n` +
      `  changes:   ${applied.changes.length}\n` +
      `  output:    ${options.dryRun ? "(dry run)" : displayPath(output)}\n` +
      `${interactionReport ? `  input:     ${applied.interaction.button} (${interactionReport.framesRun} frames)\n` : ""}`,
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
