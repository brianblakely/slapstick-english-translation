# Runtime scenarios

Scenarios turn a known Snes9x checkpoint into a focused test state without a
manual playthrough. They are small JSON files, while ROMs and checkpoints stay
local and gitignored.

## Quick start

1. Capture an **uncompressed Snes9x/libretro state** while standing in the room
   the scenario targets.
2. Save it as `scenarios/checkpoints/<checkpoint>.state`. For the included
   example, that is `scenarios/checkpoints/after-mayor.state` and it must be a
   checkpoint inside the research lab (`home-r-and-d`, map `$000C`).
3. Run:

   ```sh
   npm run scenario -- invention-machine
   ```

The default command writes:

- `build/scenarios/invention-machine-first-use.state`
- `build/scenarios/invention-machine-first-use.state.json`, a provenance and
  memory-change report

Use `--checkpoint path/to/base.state` to override the named checkpoint and
`--dry-run` to validate without writing anything. `npm run scenario -- --help`
lists all options.

To generate a test ROM instead, first build the translated ROM and select the
ROM format:

```sh
npm run build
npm run scenario -- invention-machine --format rom
```

That writes `build/scenarios/invention-machine-first-use.sfc` plus a JSON
report describing the injected initializer and every WRAM write. The source
ROM is never modified. Use `--rom path/to/translated.sfc` to select another
2 MiB translated build.

## Format

```json
{
  "$schema": "./schema.json",
  "version": 1,
  "name": "inventory-and-party-example",
  "checkpoint": "research-lab-ready",
  "map": "research-lab",
  "position": { "x": 128, "y": 144, "direction": "up" },
  "flags": {
    "robotBookRead": true,
    "machineUsed": false,
    "0x22": true
  },
  "inventory": {
    "mode": "replace",
    "equipped": "transceiver",
    "items": [
      "quick-fix",
      { "item": "scrap-a", "quantity": 3 },
      { "id": "0x77", "level": 2 }
    ]
  },
  "party": {
    "members": ["companion-1", "companion-2"],
    "robots": [1, 2],
    "activeRobot": 1,
    "order": [1, 2, 3]
  }
}
```

Robotrek represents rooms as map IDs, so `room` is accepted as an alias for
`map`. A scenario may use catalog names, decimal IDs, `0x` hex IDs, or `$` hex
IDs. Add project-specific names to `catalog.json`; name lookup ignores case,
spaces, underscores, and hyphens. `checkpoint` names the baseline used for
state output. ROM output starts with the game's normal new-game defaults, so a
scenario intended for both formats should declare every flag and item it
needs rather than relying on values already present in its checkpoint.

Positions use the Japanese build's world-pixel coordinates. The runner updates
the player globals, tile/snapped mirrors, and live actor coordinates together.
Directions are `down`, `up`, `left`, or `right` (numeric values 0 through 3 are
also accepted).

`inventory.mode` defaults to `replace`. It clears the 70 normal bag slots but
preserves the game's reserved equipped and trash slots; set `equipped`
explicitly to change the equipped slot. `merge` instead fills currently empty
slots. Repeated objects model quantities, and `level` is stored in the upper
byte of an inventory slot. A `{ "raw": "0x1234" }` entry is available for
formats that are still being reverse engineered.

`party.members` controls the two field-companion IDs. `party.robots` controls
which of robots 1–3 are available, and `activeRobot`/`order` control the battle
selection state. Omit any subfield that should remain as captured.

## Immediate interaction

Add an input to run it immediately after applying memory changes:

```json
"interaction": {
  "button": "a",
  "delayFrames": 1,
  "holdFrames": 1,
  "afterFrames": 30
}
```

The shorthand `"interaction": "a"` uses 1 delay frame, 1 held frame, and 2
frames afterward. This path loads the patched state in the existing libretro
harness, sends the input, and serializes the resulting state. It needs the
private patched ROM plus Snes9x core; `nix develop` supplies the core through
`SNES9X_LIBRETRO_CORE`. Use `--rom`, `--core`, or `--no-interaction` as needed.
Interactions are intentionally state-only: a generated ROM applies memory
initialization when New Game is selected but does not synthesize controller
input. Pass `--no-interaction` when generating a ROM from a scenario that also
contains an interaction.

## Why map changes are checked, not patched

A loaded room consists of tile data, actor instances, script state, camera
bounds, and more than the two-byte current-map ID. If a scenario names a map
different from its checkpoint, state generation stops with an actionable
error instead of creating a corrupt-looking state. Capture one stable
checkpoint per room and reuse it across as many variants as needed.

ROM generation may change maps safely because its 65816 initializer runs
before the first gameplay room is loaded. It relocates the game's stock
new-game initializer into free expanded-ROM code space, appends the scenario's
WRAM writes, and hooks that routine only for New Game. Loading a normal save
does not rerun it.

## Mapping maintenance

The initial catalog and WRAM layout use the community
[Robotrek RAM map](https://datacrystal.tcrf.net/wiki/Robotrek/RAM_map),
[item-ID notes](https://datacrystal.tcrf.net/wiki/Robotrek/Notes#Item_IDs), and
[GaiaLabs Robotrek disassembly](https://github.com/Azarem/gaia-robotrek-baserom)
as starting points. Japanese-release offsets used here were then checked
against this project's ROM and live Snes9x WRAM. Keep new aliases in
`catalog.json` rather than scattering numeric IDs through scenario files.
