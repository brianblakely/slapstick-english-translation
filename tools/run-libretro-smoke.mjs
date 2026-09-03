#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cacheStatus,
  cachedCorePath,
  repositoryRoot,
} from "./libretro-core.mjs";

function hasExplicitCore(arguments_) {
  return arguments_.some((argument) => argument === "--core" || argument.startsWith("--core="));
}

function run(command, arguments_, environment = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error && result.status === null) {
    process.stderr.write(`libretro-smoke: could not start ${command}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal) {
    process.stderr.write(`libretro-smoke: ${command} stopped with ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function main() {
  const arguments_ = process.argv.slice(2);
  const python = process.env.PYTHON || "python3";
  const runner = join(repositoryRoot, "tools", "libretro-smoke.py");
  const bypassBootstrap = hasExplicitCore(arguments_) || Boolean(process.env.SNES9X_LIBRETRO_CORE);
  const helpOnly = arguments_.includes("--help") || arguments_.includes("-h");

  let environment = process.env;
  if (!bypassBootstrap && !helpOnly) {
    let status = cacheStatus();
    if (!status.usable) {
      process.stderr.write(`Snes9x core cache is not ready (${status.reason}).\n`);
      const setupStatus = run(process.execPath, [join(repositoryRoot, "tools", "setup-libretro-core.mjs")]);
      if (setupStatus !== 0) return setupStatus;
      status = cacheStatus();
      if (!status.usable) {
        process.stderr.write(`libretro-smoke: setup completed but the core cache is invalid: ${status.reason}\n`);
        return 1;
      }
    }
    if (!existsSync(cachedCorePath)) {
      process.stderr.write(`libretro-smoke: cached core disappeared: ${cachedCorePath}\n`);
      return 1;
    }
    environment = { ...process.env, SNES9X_LIBRETRO_CORE: cachedCorePath };
  }
  return run(python, [runner, ...arguments_], environment);
}

process.exitCode = main();
