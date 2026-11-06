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
`translation/script/`. The `source` field is retained as provenance. Every
console entry also has a `literal` field: a direct English rendering that keeps
control codes and dynamic references but is not constrained by ROM space, UI
layout, or localization style. Only the independently localized `translation`
field is encoded into the English ROM.

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

Dialogue `TBL` stores only a 16-bit pointer-table address, so the interpreter
reads both the table and the string it selects through the current data bank.
Dialogue containing `TBL` commands is therefore placed in the bank that holds
its tables, which is normally its original bank. The Inventor's Friend reread
line at `0x07B181` is the exception: its Japanese text called the shared
bank-01 "It describes..." string through `STR`, and the inlined English line
reads the bank-01 item-name table, so it runs from bank 01. Oversized entries
can be split across reclaimed fragments and joined
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

Console `STR` (`02`) renders a nested string from a 24-bit pointer. The stock
handler at `0x04AD0C` loads the pointer's bank into the data bank before it
reads the pointer's 16-bit address, so it reads that address from the target's
bank. Every stock console string shares bank 01 with its targets, so the
Japanese game never notices. A translated string running from an expansion bank
does: each `STR` back into bank 01 jumped to garbage. Robots 2 and 3's status
screens lost their boxes, labels, names, and energy, the robot-order screen
lost Gamma's energy, and the naming screen's third character page garbled its
command column. The build replaces the handler's operand reads at `0x04AD11`
with a long call to a 14-byte routine at `0x180040`. It reads both operands
through the caller's bank, then switches banks and returns to the stock
recursive call.

Some console `TBL` and `FIL` commands keep only the 16-bit address of the
stock name/icon selector at `0x01E9D6`. When a translated string runs from an
expanded bank, those commands read through that bank instead. The build reserves
the corresponding range and mirrors the selector into banks `$98`-`$9F`, keeping
dynamic player names and menu/icon selections intact across equipment, robot,
battle-command, and exit-menu paths.

Dialogue `PAL` (`C3`) stores a tilemap palette at `$0EC2` and recolors every
tile from the cursor to the end of the box, so the text that follows takes
the new color. The stock handler at `0x04A013` first ran the glyph wrap check
at `0x04A657` as though a glyph were about to be drawn. After a full
26-column line, that check found no room and started a new line, so a color
change at the end of a line broke the line by itself. A line break that
followed left a blank row, and on a box's last row the forced break scrolled
the first line out of view, as with the password doors' `This door needs a
password` prompt. The build rewrites the handler in its stock slot without
the wrap check. When the cursor is at or past the end of its line, recoloring
starts at the next line; on the last row there is nothing below to recolor,
and the scroll routine already gives each new row the current palette. The
half-tile alignment for 12-pixel glyphs, the recolor loop, the tilemap upload,
and the one-frame wait are unchanged. The rewrite is 11 bytes shorter than the
stock handler, and the remaining bytes are `NOP`s.

Before the `STR` fix, the strings that contain or are reached through `STR`
were pinned to their stock addresses to avoid it: the main-menu robot rows at
`0x01EB23`, `0x01EB52`, and `0x01EB81`, the robot equipment summaries, and the
shared stat, point-allocation, combo, and Program panels. Each still fits its
stock slot, so they remain inline. A test build that relocated all sixteen,
ten of them into an expansion bank, rendered every menu-suite capture
identically.

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

Invention Machine dialogue appends an equipment level from the pointer table at
`0x01E6B3`. Its entries keep the stock two-glyph "Lv" ligatures from the
12-pixel sheet (`Ł` plus `Ⅰ`-`Ⅸ` in the script, encoded as `80 29` plus
`80 90`-`80 97` or `80 2A`), so each level takes three English columns. Every
non-empty level begins with its own space and entry 0 stays empty, so an
unleveled item reads `Battle Sword.` rather than `Battle Sword .`. The battle
menu draws its levels with the console font's separate ligatures and does not
use this table. The reflow tool and validator reserve 15 columns for item names
and 4 for a level, and the validator holds every item name to that width.

`tools/reflow-dialog.mjs` removes dialogue newlines whenever the next word fits,
then wraps normal dialogue to 26 English columns and four rows while retaining
speaker, intentional page, and choice boundaries. Soft page markers are
repaginated from the current row count; if that would leave only one or two
words on a generated page, the last line of the preceding page moves forward.
A line that opens with two or more spaces is laid out by hand, such as a
book's centered title or byline, so the break that ends it is always kept.
A line that opens with one space is indented, the Japanese style for letters,
notices, and signs; when it wraps, its continuation keeps the indent. A line
that continues an indented sentence without its indent, as earlier passes
left dozens of them, is joined back and wrapped again.
Entries whose
row structure is itself meaningful, such as the Invention Machine's two-line
control legend, opt out with `"reflow": false`.
`tools/validate-script.mjs` additionally checks custom box dimensions, dynamic
inserts, supported characters, control structure, and full translation
coverage, and fails any line that continues an indented sentence unindented. It models the final rendered row of every dialogue choice prompt and
checks the engine's fixed cursor row, including prompts whose speaker template
or scrolling changes the apparent source-line count. Side-by-side choices, such
as the Invention Machine's `Make it` and `Never mind`, must also leave columns 0
and 12 blank because the stock cursor is drawn there.

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
Inventory item names are limited to eight cells, enemy names to nine, and
mid-battle messages to twenty-four. In battle, choosing the player opens a box
(`0x01F61D`) that lists `SWAP ROBOT` and the usable items in two columns 12
cells apart; the right column's cursor is drawn in the cell before its text,
so each left-column label gets eleven cells. That box lists items by these
console names, so dialogue item names are held only to their 15-column
dialogue width. The eight
item cells include the equipment icon, because the hovered-item box, the
equipped-item box, and the status screen's equipped row each hold exactly
eight; `CHEM` and `WRECKED` replace `CHEMICAL` and `WRECKAGE` for that reason.
At runtime, equipment displays prepend the type glyph and level to produce
`[icon][level][name]`; equipment without a level uses `[icon][name]`. Thus the
full name `THUNDER` replaces `THDR SWD` without changing the field width. The
validator reserves the icon cell on every equipment name and enforces dynamic
icon/name pairing, plus icon/level/name order wherever separate table calls are
used.

The equipment glyphs occupy console character codes `0x3B` through `0x47`,
which were unused kana in the English script. Their one-color 8x8 silhouettes
are reductions of the level-1 Sword, Axe, Blade, Hammer, Celtis/Stone, Punch,
Blow, Shot, Laser, Bomb, Shield, Empty Pack, and Boots art from the
[Robotrek equipment compendium](https://www.thesupersnes.tv/compendium/robotrek/equipment/).
Each glyph uses only columns 0–6 and rows 0–6 of its 8x8 cell, the menu font's
capital height and baseline, leaving the right column and bottom row blank for
separation from adjacent text.
The build expands the stock 4 KiB console font bitmap at
`0x12873D`, replaces those tiles, and uses an optimal parse of the game's
Quintet-LZ format to keep the modified bitmap inside its original compressed
slot. It verifies exact decompression before writing the ROM. A 256-entry
lookup table at PC `0x188000` returns the proper glyph for equipment IDs 1–50
and an empty string for every other item. The build-time `[EICON:offset]`
pseudo-command expands to the stock `TBL` operation against this lookup, so it
inherits each display's live item selector without adding runtime code.
The same font is used by robot naming. Its stock Latin letters, digits, and
punctuation mixed serif and sans-serif shapes, and the stock glyphs raised the
bowls of `g`, `p`, `q`, and `y` to fit a seven-row cell. The build replaces those
75 cells with glyphs from Press Start 2P 3.000 (OFL-1.1), an 8x8 font based on
classic arcade lettering. `assets/fonts/menu-font-8x8.json` stores the
converted subset. It pins the upstream TrueType file's SHA-256, and each glyph
samples the outline at the centers of an 8x8 pixel grid (125 font units per
pixel). The converted subset is a Modified Version under the OFL and does not
use the font's Reserved Font Name. Its license is in
`assets/fonts/LICENSE.press-start-2p` and ships beside the patches as
`dist/LICENSE.press-start-2p`.

The build validates the subset hash, the source metadata, and a blank
eighth column in every glyph, because console text advances exactly eight
pixels. Capitals fill rows 0-6, and descenders use row 7. The battle menu's
single-tile `L1`-`L9` level ligatures (`0x90`-`0x98`) move up one row to
share that baseline. Their stock digits filled the eighth column and butted
against the following name. The build shortens each L's foot to two pixels and
moves the unchanged four-pixel digit one column left, so every ligature leaves
that column blank like the font's own glyphs. The equipment-type icons sit on
the same rows, so a label such as `[sword icon]L5METAL` lines up with even
one-pixel spacing. Frames, kana,
the small `ENERGY`/`ENEMY` labels, and cursors are unchanged.

The small-caps `ENERGY` label spans three tiles (`0x99`-`0x9B`, written `ℇ℞⅁`
in the script). Its five-pixel capitals sit on rows 2-6, so they already share
the menu font's baseline. As in the Japanese, the main menu, the Invention
Machine's robot lists, and the robot-order screen use it to label each robot's
energy; robots have no experience points. The validator requires every console
string whose Japanese source uses the label to keep it.

Press Start 2P's digits use the cell's first column. The money box that sits
beside the Invention Machine and robot-service headers (`0x01F07B`) therefore
keeps its stock eight-column frame at its stock position. `99999 tr` fills that
frame exactly, so the digits keep the frame's own left margin instead of
touching the neighboring panel's border.
A second 256-entry lookup at PC `0x1F8000` contains fixed nine-cell
`[icon][name]` labels, with every name padded to eight cells. `[ELBL:offset]`
also compiles to a stock `TBL` command. It lets nested robot panels retain their
original byte length and leaves the equipment level in the stock column after
the combined label.

The combo assignment panel places single-letter R/L/X labels at console column
14, just left of the equipment sprites. Its third label follows the current
control mapping, so the tilemap operand at PC `0x0BC73E` moves from `0x01D6` to
`0x01DC` to keep that runtime redraw in the same column.

The item screen's top-left box has 16 console columns. The Japanese text is a
space, the three-character `そうび` caption, four blank columns, then the
eight-column item name. The engine draws the 16x16 equipped-item graphic over
the middle two blank columns, on the same 16-pixel grid as the bag slots, and
the hand that marks where a held item will go points at it from the blank
column before. That hand adds the stock X offset at PC `0x0BC2A1` to every
destination, bag slots included, so the build leaves it unchanged. The English
caption is the four-column `GEAR`, which keeps the label, hand, graphic, and
name in their stock positions without writing past the box's right border.
`tools/validate-script.mjs` enforces that layout.

The player status screen's right panel also has 16 columns. The Japanese
labels each value with two rows: `そうび` above `アイテム` for the held item, and
`ひらめき` above `アイテム` for the number of invention ideas. The second row
uses `FIL` to draw each kana as a single tile at `POS:19C` and `POS:25C`, beside
the value. The engine draws the held item's 16x16 graphic over panel columns
6-7 (screen columns 20-21) across both rows, and the item's name follows it in
columns 8-15. English drops the `FIL` rows and puts a one-row label beside each
value: `GEAR`, which matches the item screen and ends before the graphic, and
`IDEAS`, the term the game uses when you learn a new invention. The validator
keeps the held-item caption clear of the graphic and the item label inside the
panel.

The main menu and Invention Machine share a 16x16 exit graphic whose Japanese
`おわり` lettering is baked into four uncompressed 4bpp tiles at PC `0x0CB090`,
`0x0CB0B0`, `0x0CB290`, and `0x0CB2B0`. The build replaces them with Robotrek's
orange/cyan/yellow `END` icon, preserving the stock palette and frame. The
indexed pixels in `assets/graphics/robotrek-exit-icon.json` come directly from
the 16x16 crop at `(112, 10)` in this
[Robotrek menu screenshot](https://www.mobygames.com/game/12678/robotrek/screenshots/snes/66124/).
The asset records the screenshot URL and digest; the builder verifies both the
original tile digest and the encoded replacement digest. No Robotrek ROM or
network access is needed to build the patch.

The Rust-Off bottle's orange label carries the Japanese `サビ` ("rust"). The
art is stored twice as uncompressed 4bpp tiles: in the item sheet used by the
item screen, the status screen's ideas grid, and the Invention Machine's
catalog (top-left `0x0CAB10`, bottom row `0x0CAD10` and `0x0CAD30`; the
tilemap draws the top-right as the mirrored top-left), and as the four-tile
sprite beside `Use on which robot?` (`0x168000`, `0x168020`, `0x168200`,
`0x168220`). The label lies entirely in the bottom two tiles. The build
reletters it as `OIL` in dark ink on a yellow label, using only the icon's
existing palette entries, and writes those two tiles to both copies.
`assets/graphics/rust-off-icon.json` holds the whole icon as palette indices;
the builder verifies the stock tile digests, checks that the asset's top half
still encodes to the stock tiles, and pins the encoded label digest.

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
