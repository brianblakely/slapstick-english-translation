#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  cacheStatus,
  cachedCorePath,
  coreCacheDirectory,
  coreManifest,
  coreReceiptPath,
  repositoryRoot,
  sha256File,
  sourceArchivePath,
} from "./libretro-core.mjs";

function usage() {
  return `Usage: node tools/setup-libretro-core.mjs [options]

Build and cache the pinned Snes9x libretro core used by the visual harness.

Options:
      --archive <file>  Use an already-downloaded source archive
      --check           Check the cache without downloading or building
      --force           Rebuild even when the cached core is current
  -h, --help            Show this help
`;
}

function parseArguments(argv) {
  const options = { archive: undefined, check: false, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--archive") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--archive needs a file path");
      options.archive = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown option ${argument}`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error && result.status === null) {
    if (result.error.code === "ENOENT") {
      throw new Error(`${command} is required to build the Snes9x core`);
    }
    throw new Error(`Could not start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit status ${result.status}`).trim();
    throw new Error(`${command} failed: ${detail}`);
  }
  return result;
}

function writeAtomic(path, data) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, data);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function verifyArchive(path) {
  if (!existsSync(path)) throw new Error(`Source archive does not exist: ${path}`);
  const hash = sha256File(path);
  if (hash !== coreManifest.sourceSha256) {
    throw new Error(
      `Source archive SHA-256 is ${hash}; expected ${coreManifest.sourceSha256}`,
    );
  }
}

function downloadArchive() {
  mkdirSync(dirname(sourceArchivePath), { recursive: true });
  const temporary = `${sourceArchivePath}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  process.stderr.write(`Downloading pinned Snes9x source ${coreManifest.revision.slice(0, 12)}...\n`);
  try {
    run(
      "curl",
      [
        "--fail",
        "--location",
        "--retry",
        "3",
        "--output",
        temporary,
        coreManifest.sourceUrl,
      ],
      { stdio: "inherit" },
    );
    verifyArchive(temporary);
    renameSync(temporary, sourceArchivePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function prepareArchive(providedArchive) {
  if (providedArchive) {
    verifyArchive(providedArchive);
    if (resolve(providedArchive) !== resolve(sourceArchivePath)) {
      mkdirSync(dirname(sourceArchivePath), { recursive: true });
      const temporary = `${sourceArchivePath}.tmp-${process.pid}`;
      try {
        copyFileSync(providedArchive, temporary);
        renameSync(temporary, sourceArchivePath);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return sourceArchivePath;
  }

  if (existsSync(sourceArchivePath)) {
    try {
      verifyArchive(sourceArchivePath);
      return sourceArchivePath;
    } catch (error) {
      process.stderr.write(`Discarding stale source cache: ${error.message}\n`);
      rmSync(sourceArchivePath, { force: true });
    }
  }
  downloadArchive();
  return sourceArchivePath;
}

function probeCore(path) {
  const program = `
import ctypes
import json
import sys

class SystemInfo(ctypes.Structure):
    _fields_ = [
        ("library_name", ctypes.c_char_p),
        ("library_version", ctypes.c_char_p),
        ("valid_extensions", ctypes.c_char_p),
        ("need_fullpath", ctypes.c_bool),
        ("block_extract", ctypes.c_bool),
    ]

core = ctypes.CDLL(sys.argv[1])
core.retro_api_version.restype = ctypes.c_uint
core.retro_get_system_info.argtypes = [ctypes.POINTER(SystemInfo)]
info = SystemInfo()
core.retro_get_system_info(ctypes.byref(info))
print(json.dumps({
    "apiVersion": core.retro_api_version(),
    "name": info.library_name.decode(),
    "version": info.library_version.decode(),
}))
`;
  const result = run(process.env.PYTHON || "python3", ["-c", program, path]);
  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not read libretro core metadata: ${error.message}`);
  }
  if (info.apiVersion !== 1) {
    throw new Error(`Snes9x core uses unsupported libretro API version ${info.apiVersion}`);
  }
  if (info.name !== coreManifest.name || info.version !== coreManifest.version) {
    throw new Error(
      `Built core reports ${JSON.stringify(`${info.name} ${info.version}`)}; ` +
        `expected ${JSON.stringify(`${coreManifest.name} ${coreManifest.version}`)}`,
    );
  }
  return info;
}

function compilerDescription() {
  const result = run(process.env.CXX || "g++", ["--version"]);
  return result.stdout.split(/\r?\n/, 1)[0];
}

function buildCore(archive) {
  if (process.platform !== "linux") {
    throw new Error("The automatic core bootstrap currently supports Linux only; pass --core on this platform");
  }
  const workDirectory = mkdtempSync(join(tmpdir(), "slapstick-snes9x-"));
  try {
    process.stderr.write("Extracting Snes9x source...\n");
    run("tar", ["-xzf", archive, "--strip-components=1", "-C", workDirectory]);
    const sourceDirectory = join(workDirectory, coreManifest.sourceDirectory);
    const makefilePath = join(sourceDirectory, "Makefile");
    const makefile = readFileSync(makefilePath, "utf8");
    const noisyGitProbe = "git rev-parse --short HEAD || echo unknown";
    if (!makefile.includes(noisyGitProbe)) {
      throw new Error("Pinned Snes9x Makefile no longer contains the expected Git version probe");
    }
    writeFileSync(
      makefilePath,
      makefile.replace(noisyGitProbe, "git rev-parse --short HEAD 2>/dev/null || echo unknown"),
    );
    const jobs = Math.max(1, Math.min(cpus().length, 4));
    process.stderr.write(`Building Snes9x core with ${jobs} job${jobs === 1 ? "" : "s"}...\n`);
    run(
      "make",
      ["-C", sourceDirectory, "--silent", `-j${jobs}`],
      { stdio: "inherit" },
    );

    const builtCore = join(sourceDirectory, coreManifest.libraryFile);
    if (!existsSync(builtCore)) {
      throw new Error(`Snes9x build completed without creating ${builtCore}`);
    }
    probeCore(builtCore);

    mkdirSync(coreCacheDirectory, { recursive: true });
    const temporaryCore = `${cachedCorePath}.tmp-${process.pid}`;
    try {
      copyFileSync(builtCore, temporaryCore);
      chmodSync(temporaryCore, 0o755);
      const coreInfo = probeCore(temporaryCore);
      const receipt = {
        schemaVersion: 1,
        name: coreInfo.name,
        version: coreInfo.version,
        sourceRevision: coreManifest.revision,
        sourceSha256: coreManifest.sourceSha256,
        platform: process.platform,
        architecture: process.arch,
        compiler: compilerDescription(),
        coreSha256: sha256File(temporaryCore),
      };
      renameSync(temporaryCore, cachedCorePath);
      writeAtomic(coreReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      return receipt;
    } finally {
      rmSync(temporaryCore, { force: true });
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const status = cacheStatus();
  if (options.check) {
    if (!status.usable) throw new Error(`Snes9x core cache is not ready: ${status.reason}`);
    process.stdout.write(`${status.path}\n`);
    return;
  }
  if (status.usable && !options.force) {
    process.stdout.write(`Pinned Snes9x core is ready: ${status.path}\n`);
    return;
  }
  if (existsSync(cachedCorePath)) {
    const reason = options.force && status.usable ? "requested by --force" : status.reason;
    process.stderr.write(`Rebuilding Snes9x core cache: ${reason}\n`);
  }

  const archive = prepareArchive(options.archive);
  const receipt = buildCore(archive);
  process.stdout.write(
    `Pinned ${receipt.name} ${receipt.version} core is ready: ${cachedCorePath}\n` +
      `SHA-256: ${receipt.coreSha256}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`setup-libretro-core: ${error.message}\n`);
  process.exitCode = 1;
}
