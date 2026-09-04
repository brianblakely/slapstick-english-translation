# Graphic font details
* Format: Uncompressed 2bpp planar (Game Boy)
* 2 tiles wide
* Kanji: `00050000`, `00060000`
* Hiragana/Default Symbols: `00040000`
* Katakana/Alternate Symbols: `00042000`

# Control Codes
Some control codes change the text that follows it.
Others create text or modify the dialog box.

## Highlights
* `C302` - Yellow highlight
* `C303` - Pink highlight

Halt highlight effects with `C300`.

## Speed
* `D2` - Stop entirely until user presses a button.
* `DC` - Speak very slowly.
* `DD` - Speak very quickly.
* `C9XX` - Pause momentarily, where XX indicates length of pause.

## Alternate Symbols
* `D4` - Like a "shift key"

Enable katakana and other symbols, ranging from 00 to 7F.

This symbol range begins at ガ (ga) in the graphic font and goes on down.

Hiragana mode is re-enabled with `D5`.

## Name of Speaker
`E0XX` - Where "XX" corresponds to the speaker's name.

Names themselves stored at `0006F350`. End byte is `CC`.

## Formatting
* `C0` - Dialog end
* `CD` - Line break
* `D0` - Wipe dialog
* `D1` - Page break

## Dialog Controls
* `D7` or `D9` - Render at top of screen
* `D8` - Render at bottom of screen

# Locations

## Blocks

* Names: `0006F350` - `0006F4A6`

* `0001CA30` -- start of dialog?
* `000FDC00` -- end of dialog?
* `0005A3ED` -- Akihabara laughing
* `0005DE90` -- Mayor laughing

    Pointersaurus output:

    We couldn't find a valid pointer for offset 5DF31, but we did find these nearby:
    - Pointer 00DDC500 for offset 5DD00 at offset 1C5DA
    - Pointer 00E1C500 for offset 5E100 at offset 1C5DE
* `00027627` -- Unused block

# The Search for Dialog Pointer Tables

## ROM Structure

* Each bank starting with `50000` keeps dialog in pages `8000`-`FFFF`.

* A banks lists all the dialog per-character, per-location. Each progressive bank features later-game locations.

## Individual Dialog

* Each dialog box appears to be preceded by a (non-textual) description of the character.

* In this description, `02` begins each section.

* The section whose first following byte is `1D` will indicate a pointer to dialog.

* The pointer to the dialog is followed by byte `6B`, executed to flag when the dialog has been read.

# Test Strings
町*さんは
8099*45685420
の方の
53810453
あいさつが - 158774
町長
80998082

# Implemented English Build

## Source and output

The builder accepts only the 1,572,864-byte unheadered Japanese ROM whose
SHA-256 is
`08144ea1ce3cf6ab107837278d308e4e859574a047a2ee8eb456f7900ad4be21`.
It expands the ROM to 2 MiB, writes the title `SLAP STICK ENGLISH`, changes the
country byte to North America, and recalculates the checksum pair.

All 2,381 extracted dialogue and console strings live as structured JSON in
`translation/script/`. The `source` field is retained as provenance; only the
independently translated `translation` field is encoded into the English ROM.

## Text relocation

Most translated strings no longer fit their original slots. The builder
reclaims the bytes after each redirect stub and its continuation byte, packs
strings into suitable same-bank gaps when possible, and otherwise places them
in the upper half of each expanded HiROM file bank beginning at file offset
`0x188000`.

Expanded text is addressed through banks `$98`-`$9F`, not their full-ROM
`$D8`-`$DF` mirrors. The dialogue and console handlers use absolute low-bank
addresses for work RAM. Banks `$98`-`$9F` preserve those WRAM/I/O mirrors below
`$8000`, while `$D8`-`$DF` would resolve the same addresses as ROM and can lock
the renderer when it reads its box state.

Dialogue entry stubs use command `CF` followed by a 24-bit address and the
translated string's one-byte terminator. The stock recursive `CF` behavior
renders the relocated string, restores the caller's data bank and text cursor,
then reaches that terminator at the original call site. This is important for
`NXT` strings used by scripted UI such as the Invention Machine. Console entry
stubs use the previously unused command `0C` with a 24-bit address.

Dialogue containing pointer-table (`TBL`) commands remains in its original
bank; oversized entries can be split across reclaimed fragments and joined
with `CF` redirects followed by return sentinels. Four-byte dialogue slots use
the engine's existing same-bank `JMP` command instead. The two-byte Orb string
is handled directly through its existing bank-01 pointer table because it
cannot hold a redirect stub.

Three runtime-filled text buffers are deliberately preserved. Their redirects
begin at the first static text command instead:

- `07B1B3` patches from `07B1C9`
- `09847B` patches from `09849A`
- `0ADBDC` patches from `0ADBF1`

## Interpreter hooks

The dialogue `CF` handler at `0x049FF9` retains its recursive behavior but is
relocated to `0x180020` behind a long-call trampoline. The recursive dialogue
`TBL` handler at `0x04A0F7` preserves and restores the data bank around nested
strings, allowing redirected table entries to execute safely.

Console command-table slot `0C` at `0x04ACEA` points through a small trampoline
at `0x049FFE` to the redirect routine at `0x180000`. The console interpreter's
existing bank-preservation behavior then resumes the caller correctly.

Some console `TBL` and `FIL` commands keep only the 16-bit address of the
stock name/icon selector at `0x01E9D6`. When a translated string runs from an
expanded bank, those commands read through that bank instead. The build reserves
the corresponding range and mirrors the selector into banks `$98`-`$9F`, keeping
dynamic player names and menu/icon selections intact across equipment, robot,
battle-command, and exit-menu paths. Shared robot point-allocation and Program
panels reached through `STR` remain inline at their stock addresses so the
console interpreter never has to follow two relocation redirects at once.
The three main-menu robot summary rows at `0x01EB23`, `0x01EB52`, and
`0x01EB81` also remain inline because each row nests its robot name and EXP
value through `STR`. Each translated row fits its original 35-byte slot; if a
row is relocated, its nested return resumes against the redirect stub and can
corrupt the following robot names.

## Dialogue font and layout

The original dialogue alphabet is stored as 16x16, four-tile 2bpp glyphs at
`0x040000` and `0x042000`, with a 12-pixel advance. Horizontally resampling
those glyphs made narrow letters irregular and difficult to distinguish, so the
build now installs the native 8x16 Spleen 2.2.0 bitmap glyphs in the left half
of each cell. It changes the three renderer increments at `0x04A65A`,
`0x04A768`, and `0x04A772` from three tile units to two, preserving the
26-column dialogue layout with an exact eight-pixel advance.

The bundled subset and its upstream BDF digest are pinned in
`assets/fonts/spleen-8x16.json`. The build validates the subset hash, cell
dimensions, version, and every bitmap before modifying the ROM. Spleen is
Copyright (c) 2018-2026 Frederic Cambus and distributed under BSD-2-Clause;
the complete license is in `assets/fonts/LICENSE.spleen` and alongside the
binary patches in `dist/LICENSE.spleen`.

The base-font byte `0x1F` draws the Japanese circular full stop, so the dialogue
encoder never uses it for an English period. ASCII `.` always selects the
alternate-font Western dot at `0x7E`; console text uses its Western dot at
`0xFE`. Alternate-font cell `0x76` is reserved for the compact `A` marker that
menus address directly, so it is not available to the dialogue encoder.

Dialogue commands `NAM`, `TBL`, `NUM`, `STR`, `DEC`, `TPL`, and `E2` insert text
through stock runtime routines which return in base-font mode. The encoder emits
`D5` before any of these commands when lowercase mode is active, then tracks the
base mode for following text. This keeps names and template suffixes correctly
cased, prevents alternate spaces and punctuation from becoming base-font
symbols, protects numeric inserts, and keeps dynamic A/B/X/Y labels uppercase.

`tools/reflow-dialog.mjs` removes dialogue newlines whenever the next word fits,
then wraps normal dialogue to 26 English columns and four rows while retaining
speaker, intentional page, and choice boundaries. Soft page markers are
repaginated from the current row count; if that would leave only one or two
words on a generated page, the last line of the preceding page moves forward.
Entries whose
row structure is itself meaningful, such as the Invention Machine's two-line
control legend, opt out with `"reflow": false`.
`tools/validate-script.mjs` additionally checks custom box dimensions, dynamic
inserts, supported characters, control structure, and full translation
coverage.

Map names at `0x06F910` through `0x06FD89` are nested inside the one-row
location banner. The English banner uses a 14-tile box (28 English columns),
with one fixed margin column on either side of a 26-column label area. Each
nested name is padded by `floor((26 - width) / 2)` columns, and the validator
enforces that centering. The player's variable-length home label uses the fixed
name `Your House` so it remains centered for every chosen player name.

The configuration screen uses hard-coded tile positions rather than measuring
its labels. Message-speed choices occupy three-column slots beginning at
columns 9, 15, and 21; sound choices occupy four-column slots beginning at
columns 9 and 15. Button action labels have 14 columns before the fixed A/B/X/Y
choices. The script validator enforces these constraints so text, selection
palettes, and cursors remain aligned. New games initialize with high message
speed and stereo sound; the duplicated message-speed runtime setting is patched
at both initialization sites.

Console boxes advance one eight-pixel cell per Latin character. Main-menu and
Invention Machine captions have eight cells. Battle attack names have seven
cells for their distinctive text, while the selected-item header has eight.
At runtime, equipment displays prepend the type glyph and level to produce
`[icon][level][name]`; equipment without a level uses `[icon][name]`. Thus the
full name `THUNDER` replaces `THDR SWD` without changing the field width. The
validator reserves the icon cell on every equipment name and enforces the
dynamic icon, level, name command order in every item-table display.

The equipment glyphs occupy console character codes `0x3B` through `0x47`,
which were unused kana in the English script. Their one-color 8x8 silhouettes
are reductions of the level-1 Sword, Axe, Blade, Hammer, Celtis/Stone, Punch,
Blow, Shot, Laser, Bomb, Shield, Empty Pack, and Boots art from the
[Robotrek equipment compendium](https://www.thesupersnes.tv/compendium/robotrek/equipment/).
The build expands the stock 4 KiB console font bitmap at
`0x12873D`, replaces those tiles, and uses an optimal parse of the game's
Quintet-LZ format to keep the modified bitmap inside its original compressed
slot. It verifies exact decompression before writing the ROM. A 256-entry
lookup table at PC `0x188000` returns the proper glyph for equipment IDs 1–50
and an empty string for every other item. The build-time `[EICON:offset]`
pseudo-command expands to the stock `TBL` operation against this lookup, so it
inherits each display's live item selector without adding runtime code.

The validator also checks every literal console line against its active `BOX`,
plus the complete item-name, machine-option, main-caption, and battle-target
tables.

Battle damage uses two special 8x8 tiles for the zero-damage indicator. The
build expands the stock Quintet-LZ battle bitmap at `0x132D06`, replaces the
Japanese `スカ` tiles with paired `MI`/`SS` glyphs, recompresses the bitmap into
its original slot, and verifies an exact decompression round trip.

## Checkpoint-free scenario entry

Scenario ROMs reuse the engine's real reset and map-loading path. The generator
changes the reset destination operand at `0x0085DC` to title map `$0004`, hooks
that map's director at `0x04E705`, and relocates the stock new-game initializer
from `0x04CB0B` into unused expanded-ROM code space. A small wrapper applies the
scenario's WRAM values, calls the stock level/stat derivation at `$87F576`,
mirrors map, direction, and position into the persistent load block, and jumps
to the normal new-game map transition at `$C4B40B`. Map `$0004` has a separate
one-shot return path so targeting the title itself cannot recurse through the
hook. All three original code regions are fingerprinted before patching and the
temporary ROM checksum is regenerated.

The libretro harness can stop on ANDed one-, two-, or four-byte WRAM
comparisons. The scenario runner latches the transient `$056A == $70FF` map-
load completion signal, verifies `$05A8`/`$05A6`, optionally waits for the real
player actor pointer at `$0EEA`, and then runs configurable settle frames before
serializing. This makes field, actorless, menu, and cutscene readiness explicit
without baking emulator checkpoints into the repository.

Direct battle scenarios start from that initialized field state, resolve the
battle map through the field table at ROM `0x01AD3B`, validate the encounter
definition table at `0x038000`, and schedule the stock field-to-battle task at
WRAM `$00D3`. Command readiness is detected from `$0BBE` and the low byte of
`$05C8`; the saved state therefore contains the engine-created battle actors
and resources rather than a fabricated battle map ID.

## Build verification

`tools/build-patch.mjs` asserts the clean ROM hash and every modified code
signature before patching. It generates BPS and IPS, reapplies each patch in
memory, compares the resulting ROM byte-for-byte, and validates the final SNES
header checksum. These checks establish deterministic patch construction; an
emulator or hardware playthrough is still needed to assess every visual and
gameplay context.
