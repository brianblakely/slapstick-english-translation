# Slap Stick English Translation

This repository builds an English patch for the 1994 Super Famicom RPG
`Slap Stick`.

The complete 2,381-entry script was translated directly from the Japanese ROM
with GPT. The commercial `Robotrek` English script was not used as a
translation source. The notes already in this repository were used only to
keep names and recurring terms consistent.

## Build

Requirements:

- Node.js 18 or newer
- A clean, unheadered Japanese ROM at `roms/Slap Stick (Japan).sfc`

The required source ROM is 1,572,864 bytes and has this SHA-256 digest:

```text
08144ea1ce3cf6ab107837278d308e4e859574a047a2ee8eb456f7900ad4be21
```

Run:

```sh
npm test
npm run build
```

The build creates these redistributable files in `dist/`:

- `Slap Stick (Japan) [EN].bps`
- `Slap Stick (Japan) [EN].ips`
- `manifest.json`

Apply either patch to the exact clean ROM above with a compatible patching
utility. BPS is the preferred format because it verifies its source and target.
No ROM image is written or distributed by the normal build.

For a private local smoke test, the builder can also write a patched ROM:

```sh
node tools/build-patch.mjs --rom-output "build/Slap Stick (Japan) [EN].sfc"
```

## Headless visual harness

The deterministic visual harness builds its pinned Snes9x core on first use and
caches it under gitignored `.cache/libretro/`. The bootstrap verifies the source
archive before compiling it, so it never depends on a system-wide core or a
moving upstream build:

```sh
npm run smoke -- \
  "build/Slap Stick (Japan) [EN].sfc" \
  --frames 1800 \
  --output-dir build/smoke
```

Run `npm run setup:smoke` to prepare the core without starting a ROM, or
`npm run setup:smoke -- --check` to validate the cache. An offline source
archive can be supplied with `--archive <file>`. The bootstrap requires
`curl`, `tar`, `make`, a C/C++ compiler, and Python 3; `--core <file>` and
`SNES9X_LIBRETRO_CORE` remain available for an explicitly managed core.
Each `report.json` records the runner, core, ROM, and loaded-state hashes plus
the complete input schedule. The source revision is intentionally frozen to the
Snes9x 1.63 build used by the project's legacy checkpoints; recapture those
checkpoints before changing that pin. Reusing an output directory replaces its
prior numbered snapshots, dumps, states, and completion report.

## Nix development workflow

With [Nix](https://nixos.org/download/) and flakes enabled, enter the pinned
development shell:

```sh
nix develop
```

The shell contains Node.js, Python, RetroArch, and only the Snes9x libretro
core. Build a private patched ROM and launch it with the pinned emulator:

```sh
node tools/build-patch.mjs --rom-output "build/Slap Stick (Japan) [EN].sfc"
slapstick-retroarch "build/Slap Stick (Japan) [EN].sfc"
```

The launcher keeps RetroArch's configuration, saves, states, caches, and other
runtime data in the gitignored `.retroarch/` directory. Set
`SLAPSTICK_RETROARCH_HOME` to use a different project-local directory.

The same launcher can be used without entering the shell:

```sh
nix run . -- "build/Slap Stick (Japan) [EN].sfc"
```

Inside the shell, `slapstick-smoke` passes the exact same pinned Snes9x source
revision to `tools/libretro-smoke.py`:

```sh
slapstick-smoke \
  "build/Slap Stick (Japan) [EN].sfc" \
  --frames 1800 \
  --output-dir build/smoke

# Equivalent without entering the shell:
nix run .#smoke -- \
  "build/Slap Stick (Japan) [EN].sfc" \
  --frames 1800 \
  --output-dir build/smoke
```

`nix build .#core` builds only the pinned core. It does not pull the RetroArch
desktop frontend into the headless harness closure.

## Runtime scenarios

Focused test states can be generated from small, reviewable scenario files:

```sh
npm run build:rom
npm run scenario -- chicken-farm
npm run scenario -- final-dungeon
```

The runner cold-boots directly into the requested map through the stock loader,
then serializes a state after the scene is ready—no playthrough or captured
checkpoint is needed. Scenarios can select any numeric map, all named scenes in
the catalog, direct battles, player position and progression state, and ordered
controller inputs. Self-booting test ROMs and legacy checkpoint seeds are also
supported. See [scenarios/README.md](scenarios/README.md) for the JSON format
and examples.

Run `nix flake check` to build the pinned core and verify that the expected
`snes9x_libretro.so` is present. Snes9x has a non-commercial license, so
Nixpkgs classifies it as unfree; this flake opts in to that package explicitly.

## What the build does

- Checks the source ROM size and SHA-256 before changing anything.
- Encodes the freshly translated dialogue, menus, items, equipment, and enemy
  names from `translation/script/`.
- Expands the ROM from 1.5 MiB to 2 MiB and installs bank-safe text redirects.
- Installs the native 8×16 Spleen bitmap font for crisp, legible dialogue.
- Replaces equipment-type abbreviations with 13 compact 8×8 menu icons.
- Reflows prose at word boundaries and validates custom dialogue-box sizes.
- Recalculates the SNES checksum and verifies both generated patches by
  applying them in memory and comparing every output byte.

`translation/glossary.md` records localization choices. `npm run reflow`
reapplies the deterministic line-wrapping pass after script edits. The patch is
structurally verified, but a complete emulator or hardware playthrough is still
recommended before calling it fully playtested.
