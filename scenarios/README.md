# Runtime scenarios

Scenarios create focused, directly bootable test states from small JSON files.
No gameplay checkpoint is needed: the runner makes a temporary scenario ROM,
cold-boots it through the game's normal map loader, waits for the requested
scene to settle, and saves a state that is compatible with the unmodified
translated ROM.

## Quick start

Build the private translated ROM once, then launch any checked-in scenario:

```sh
npm run build:rom
npm run scenario -- chicken-farm
npm run scenario -- final-dungeon
npm run scenario -- forest-battle
```

The default state and its provenance report are written under
`build/scenarios/`. The report records both ROM hashes, the injected launcher,
the core version, the readiness condition, every state change, and any runtime
inputs. `npm run scenario -- --list` lists checked-in scenarios, while
`npm run scenario -- --help` lists all command options.

Two high-density fixtures support the automated menu regression suite:

- `menu-suite-populated.json` fills all 70 bag slots, enables and equips all
  three robots, marks every invention as known, and primes the main menu.
- `invention-machine-build.json` starts before the first construction so the
  complete introduction, price prompt, animation, naming, and point-allocation
  flow can be exercised.

Run `npm run test:menus` after `npm run build:rom` to drive both fixtures
through every Invention Machine function and main-menu tab. The generated
gallery and contact sheet are under `build/menu-suite/`; gameplay assertions
and exact visual baselines make the run fail on either behavioral or rendering
regressions.

A self-booting test ROM can be emitted instead:

```sh
npm run scenario -- final-dungeon --format rom
```

It enters the requested scene from reset without title-screen or name-entry
input. The source ROM is never modified. Direct battle entry and controller
steps produce a final state, so they require the default `state` format.

## Scene selection

`catalog.json` contains every named scene from the Robotrek disassembly, plus
project aliases such as `home-r-and-d`, `chicken-farm`, and `final-dungeon`.
Name lookup ignores case and treats spaces, underscores, and hyphens alike.
The `map` and equivalent `room` field also accept decimal, `0x` hex, or `$` hex
IDs throughout the ROM's 500-entry map-script table (`0` through `$01F3`).
This numeric form reaches unnamed maps, cutscenes, menus, battle backdrops, and
other special scenes that do not have a catalog name.

For an ordinary field, request field readiness and give a usable position:

```json
{
  "$schema": "./schema.json",
  "version": 1,
  "name": "chicken-farm",
  "map": "chicken-farm",
  "position": { "x": 128, "y": 128, "direction": "down" },
  "launch": { "ready": "field" }
}
```

Positions are world pixels in the Japanese ROM. Directions are `down`, `up`,
`left`, or `right`, with numeric values 0 through 3 also accepted.

`launch.ready` controls when the generated state is captured:

- `map` (the default) waits for map loading, then works for actorless scenes,
  menus, and cutscenes.
- `field` additionally waits for a live player actor, making it the safer choice
  for walkable rooms.
- `settleFrames` runs extra frames after readiness is first observed; it
  defaults to 120. `timeoutFrames` defaults to 3600 and makes invalid scene
  requests fail with the observed WRAM values instead of writing a bad state.

Cold boot begins from the game's normal new-game data. Declare the story flags,
inventory, party, and other state needed for the exact branch of a late scene
you want to inspect.

## Player, story, inventory, and party state

A scenario can declaratively set the most common gameplay state:

```json
{
  "name": "inventory-and-party-example",
  "map": "research-lab",
  "player": { "name": "Rask", "level": 12 },
  "money": 99999,
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

Checkpoint-free launches default the player name to `Rask`; specifying only a
level retains that name. Newly enabled robots receive valid default names,
energy, stats, and equipment, so they can enter battle immediately.

`inventory.mode` defaults to `replace`. It clears the 70 normal bag slots but
preserves the equipped and trash slots; set `equipped` explicitly to change the
equipped slot. `merge` instead fills empty slots. An item object may specify
`quantity`, an upper-byte `level`, or a fully encoded `raw` word.

Flags and item references accept catalog names or numeric IDs. Unnamed event
flags can therefore be addressed directly without waiting for catalog work.

For state not yet modeled semantically, `wram` applies explicit one- or two-byte
writes during initialization:

```json
"wram": [
  { "address": "0x1234", "width": 1, "value": "0x5A" },
  { "address": "0x2340", "width": 2, "value": 0 }
]
```

Use raw writes only for understood persistent state. Live actor and map-loader
structures should be created by `map`, `position`, `launch`, and `entry` so the
stock engine initializes their dependent data.

## Direct battle entry

Use a real field map as the return map, make at least one robot available, and
select an encounter:

```json
{
  "name": "forest-battle",
  "map": "forest",
  "position": { "x": 128, "y": 128, "direction": "down" },
  "party": { "robots": [1], "activeRobot": 1, "order": [1, 2, 3] },
  "entry": {
    "type": "battle",
    "encounter": 0,
    "ready": "command"
  }
}
```

The runner first cold-boots the field, then uses the game's normal field-to-
battle transition and waits for either `loaded` or `command` readiness. It
resolves the correct battle map from the ROM's field lookup table and rejects
maps or encounter IDs with no definition. Command-ready capture has no default
settle delay because short encounters can resolve on their own; loaded capture
settles for 30 frames unless `entry.settleFrames` is supplied.

## Ordered runtime input

`steps` can advance a cutscene, open a menu, or reach a particular scripted
beat after scene initialization:

```json
"steps": [
  { "waitFrames": 30 },
  { "button": "a", "delayFrames": 1, "holdFrames": 1, "afterFrames": 45 },
  "start"
]
```

String steps use a one-frame delay, one held frame, and two frames afterward.
The older singular `interaction` field remains as shorthand and runs after
`steps`. Pass `--no-interaction` to skip both.

## Legacy checkpoints

Existing checkpoints remain supported with `--checkpoint path/to/base.state`
or a scenario-level `checkpoint` field. In that compatibility mode, the
scenario map must match the checkpoint because changing only a loaded state's
map ID leaves stale tiles, actors, and scripts. New scenarios should omit
`checkpoint` and use the cold-boot path.

Named checkpoint lookup checks `scenarios/checkpoints/` and
`SLAPSTICK_CHECKPOINT_DIR`. Checkpoints must be uncompressed states from the
pinned Snes9x core.

## Mapping maintenance

The named scene catalog comes from the
[GaiaLabs Robotrek disassembly](https://github.com/Azarem/gaia-robotrek-baserom).
The WRAM layout and initial item aliases also use the community
[Robotrek RAM map](https://datacrystal.tcrf.net/wiki/Robotrek/RAM_map) and
[item-ID notes](https://datacrystal.tcrf.net/wiki/Robotrek/Notes#Item_IDs).
Japanese-release offsets and the direct map/battle transitions were checked
against this project's ROM and live Snes9x WRAM. Keep friendly aliases in
`catalog.json`; numeric references remain available for newly understood data.
