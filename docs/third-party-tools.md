# Current build

The release builder and validators require only Node.js 18 or newer. `xxd` is
optional but useful for inspecting the SNES header, redirect stubs, and expanded
ROM banks during verification. No external assembler is required.

# Bundled dialogue font

The English dialogue font uses a pinned subset of
[Spleen 8x16](https://github.com/fcambus/spleen), version 2.2.0, by Frederic
Cambus. Spleen is a native monospaced bitmap design and is distributed under
the BSD-2-Clause license. Its source BDF SHA-256, derived subset SHA-256, and
glyph dimensions are recorded in `assets/fonts/spleen-8x16.json`; the full
license is retained in `assets/fonts/LICENSE.spleen` and
`dist/LICENSE.spleen`.

# Visual harness

`npm run smoke` uses the headless libretro runner. On first use,
`tools/setup-libretro-core.mjs` downloads the immutable Snes9x source revision
recorded in `tools/snes9x-core.json`, verifies its SHA-256 digest, builds the
core, probes its libretro ABI, and stores it in gitignored `.cache/libretro/`.
This path requires `curl`, `tar`, `make`, a C/C++ compiler, and Python 3.

Use `npm run setup:smoke -- --check` to verify the cached binary and receipt.
Use `npm run setup:smoke -- --archive <file>` when the pinned archive was
downloaded elsewhere. An explicit `--core` argument or
`SNES9X_LIBRETRO_CORE` takes precedence over automatic discovery.

The Nix flake consumes the same source manifest. `nix build .#core` builds the
headless core alone, while `nix develop` also provides RetroArch for interactive
playtesting.

The pin matches the Snes9x 1.63 serialization format used by existing project
checkpoints. Treat a pin change as a save-state migration: regenerate all
checkpoints and verify them before accepting it. Harness reports include hashes
for the runner, core, ROM, and input state so a captured frame remains auditable.

# Research and playtesting tools

* bsnes-plus

* WindHex

* Tile Molester

* Cartographer

* Atlas

* Compression tools for Quintet games: https://github.com/Osteoclave/game-tools/tree/master/snes

* xkas
