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
`0xFE`.

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
palettes, and cursors remain aligned.

Console boxes advance one eight-pixel cell per Latin character. The main-menu
caption has eight cells, and the selected-item header has nine; the latter is
why inventory names use compact menu forms such as `THNDR SWD` and `CHAM LENS`.
The validator checks every literal console line against its active `BOX`, plus
the complete item-name, machine-option, main-caption, and battle-target tables.

## Build verification

`tools/build-patch.mjs` asserts the clean ROM hash and every modified code
signature before patching. It generates BPS and IPS, reapplies each patch in
memory, compares the resulting ROM byte-for-byte, and validates the final SNES
header checksum. These checks establish deterministic patch construction; an
emulator or hardware playthrough is still needed to assess every visual and
gameplay context.
