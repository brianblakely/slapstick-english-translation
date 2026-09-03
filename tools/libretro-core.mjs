import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const coreManifestPath = join(repositoryRoot, "tools", "snes9x-core.json");
export const coreCacheDirectory = join(repositoryRoot, ".cache", "libretro");
export const cachedCorePath = join(coreCacheDirectory, "snes9x_libretro.so");
export const coreReceiptPath = join(coreCacheDirectory, "snes9x_libretro.json");

export const systemCorePaths = Object.freeze([
  "/usr/lib/libretro/snes9x_libretro.so",
  "/usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so",
  "/usr/lib/aarch64-linux-gnu/libretro/snes9x_libretro.so",
  "/usr/local/lib/libretro/snes9x_libretro.so",
]);

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(coreManifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${coreManifestPath}: ${error.message}`);
  }
  const requiredStrings = [
    "name",
    "version",
    "sourceOwner",
    "sourceRepository",
    "revision",
    "sourceUrl",
    "sourceSha256",
    "nixSourceHash",
    "sourceDirectory",
    "libraryFile",
  ];
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported Snes9x core manifest schema: ${manifest.schemaVersion}`);
  }
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      throw new Error(`Snes9x core manifest field ${field} must be a non-empty string`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.revision)) {
    throw new Error("Snes9x core manifest revision must be a full lowercase Git commit");
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.sourceSha256)) {
    throw new Error("Snes9x core manifest sourceSha256 must be a lowercase SHA-256 digest");
  }
  return Object.freeze(manifest);
}

export const coreManifest = readManifest();
export const sourceArchivePath = join(
  coreCacheDirectory,
  `snes9x-${coreManifest.revision}.tar.gz`,
);

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function cacheStatus({
  corePath = cachedCorePath,
  receiptPath = coreReceiptPath,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  if (!existsSync(corePath)) {
    return { usable: false, reason: `core is missing at ${corePath}` };
  }
  try {
    if (!statSync(corePath).isFile()) {
      return { usable: false, reason: `core path is not a file: ${corePath}` };
    }
  } catch (error) {
    return { usable: false, reason: `could not inspect core: ${error.message}` };
  }
  if (!existsSync(receiptPath)) {
    return { usable: false, reason: `build receipt is missing at ${receiptPath}` };
  }

  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    return { usable: false, reason: `build receipt is invalid: ${error.message}` };
  }

  const expected = {
    schemaVersion: 1,
    name: coreManifest.name,
    version: coreManifest.version,
    sourceRevision: coreManifest.revision,
    sourceSha256: coreManifest.sourceSha256,
    platform,
    architecture,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      return {
        usable: false,
        reason: `build receipt has ${field}=${JSON.stringify(receipt[field])}; expected ${JSON.stringify(value)}`,
      };
    }
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.coreSha256 ?? "")) {
    return { usable: false, reason: "build receipt has no valid core SHA-256 digest" };
  }

  let actualHash;
  try {
    actualHash = sha256File(corePath);
  } catch (error) {
    return { usable: false, reason: `could not hash cached core: ${error.message}` };
  }
  if (actualHash !== receipt.coreSha256) {
    return {
      usable: false,
      reason: `cached core SHA-256 is ${actualHash}; expected ${receipt.coreSha256}`,
    };
  }
  return { usable: true, path: corePath, receipt };
}

function absolutePath(path) {
  return isAbsolute(path) ? path : resolve(path);
}

export function configuredCore({ explicitCore, environment = process.env } = {}) {
  if (explicitCore) {
    const path = absolutePath(explicitCore);
    return { path, source: "--core", exists: existsSync(path) };
  }
  if (environment.SNES9X_LIBRETRO_CORE) {
    const path = absolutePath(environment.SNES9X_LIBRETRO_CORE);
    return { path, source: "SNES9X_LIBRETRO_CORE", exists: existsSync(path) };
  }
  const cache = cacheStatus();
  if (cache.usable) return { path: cache.path, source: "project cache", exists: true };
  const systemPath = systemCorePaths.find((path) => existsSync(path));
  if (systemPath) return { path: systemPath, source: "system", exists: true };
  return undefined;
}
