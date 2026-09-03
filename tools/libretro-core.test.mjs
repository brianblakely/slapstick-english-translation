import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cacheStatus,
  configuredCore,
  coreManifest,
  repositoryRoot,
  sha256File,
} from "./libretro-core.mjs";

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "slapstick-core-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("the core source manifest contains immutable, verified inputs", () => {
  assert.equal(coreManifest.schemaVersion, 1);
  assert.equal(coreManifest.name, "Snes9x");
  assert.equal(coreManifest.version, "1.63");
  assert.equal(coreManifest.revision, "890b5d445538fe790aa3add3d5702c80f551e0ae");
  assert.match(coreManifest.revision, /^[0-9a-f]{40}$/);
  assert.match(coreManifest.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(coreManifest.sourceUrl, new RegExp(coreManifest.revision));
  assert.match(coreManifest.nixSourceHash, /^sha256-/);
});

test("cacheStatus accepts a matching receipt and rejects changed core bytes", (t) => {
  const directory = temporaryDirectory(t);
  const corePath = join(directory, "snes9x_libretro.so");
  const receiptPath = join(directory, "snes9x_libretro.json");
  writeFileSync(corePath, "test core");
  writeFileSync(
    receiptPath,
    JSON.stringify({
      schemaVersion: 1,
      name: coreManifest.name,
      version: coreManifest.version,
      sourceRevision: coreManifest.revision,
      sourceSha256: coreManifest.sourceSha256,
      platform: process.platform,
      architecture: process.arch,
      coreSha256: sha256File(corePath),
    }),
  );

  assert.equal(cacheStatus({ corePath, receiptPath }).usable, true);
  writeFileSync(corePath, "changed core");
  const changed = cacheStatus({ corePath, receiptPath });
  assert.equal(changed.usable, false);
  assert.match(changed.reason, /cached core SHA-256/);
});

test("cacheStatus rejects a cache built for another architecture", (t) => {
  const directory = temporaryDirectory(t);
  const corePath = join(directory, "snes9x_libretro.so");
  const receiptPath = join(directory, "snes9x_libretro.json");
  writeFileSync(corePath, "test core");
  writeFileSync(
    receiptPath,
    JSON.stringify({
      schemaVersion: 1,
      name: coreManifest.name,
      version: coreManifest.version,
      sourceRevision: coreManifest.revision,
      sourceSha256: coreManifest.sourceSha256,
      platform: process.platform,
      architecture: "definitely-not-this-machine",
      coreSha256: sha256File(corePath),
    }),
  );

  const status = cacheStatus({ corePath, receiptPath });
  assert.equal(status.usable, false);
  assert.match(status.reason, /architecture/);
});

test("configuredCore treats an explicit path as authoritative", (t) => {
  const directory = temporaryDirectory(t);
  const corePath = join(directory, "custom.so");
  writeFileSync(corePath, "custom core");
  assert.deepEqual(configuredCore({ explicitCore: corePath, environment: {} }), {
    path: corePath,
    source: "--core",
    exists: true,
  });
});

test("the Python harness reports invalid core and snapshot arguments cleanly", (t) => {
  const directory = temporaryDirectory(t);
  const romPath = join(directory, "test.sfc");
  const staleReport = join(directory, "report.json");
  const staleFrame = join(directory, "frame-999999.ppm");
  writeFileSync(romPath, "not needed for argument validation");
  writeFileSync(staleReport, "stale report");
  writeFileSync(staleFrame, "stale frame");
  const runner = join(repositoryRoot, "tools", "libretro-smoke.py");

  const missingCore = spawnSync(
    process.env.PYTHON || "python3",
    [runner, romPath, "--core", join(directory, "missing.so"), "--output-dir", directory],
    { encoding: "utf8" },
  );
  assert.equal(missingCore.status, 1);
  assert.match(missingCore.stderr, /selected by --core does not exist/);
  assert.doesNotMatch(missingCore.stderr, /Traceback/);
  assert.equal(existsSync(staleReport), false);
  assert.equal(existsSync(staleFrame), false);

  const invalidInterval = spawnSync(
    process.env.PYTHON || "python3",
    [runner, romPath, "--snapshot-every", "0", "--output-dir", directory],
    { encoding: "utf8" },
  );
  assert.equal(invalidInterval.status, 1);
  assert.match(invalidInterval.stderr, /--snapshot-every must be positive/);
  assert.doesNotMatch(invalidInterval.stderr, /Traceback/);

  const missingState = spawnSync(
    process.env.PYTHON || "python3",
    [
      runner,
      romPath,
      "--load-state",
      join(directory, "missing.state"),
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(missingState.status, 1);
  assert.match(missingState.stderr, /Save state does not exist/);
  assert.doesNotMatch(missingState.stderr, /Traceback/);
});
