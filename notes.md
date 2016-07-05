# Graphic font details
* Format: Uncompressed 2bpp planar (Game Boy)
* 2 tiles wide
* Kanji: `00050000`, `00060000`
* Everything else: `00040000`

# Other important locations
* `0001CA30` -- start of dialog?
* `000FDC00` -- end of dialog?
* `0005A3ED` -- Akihabara laughing

# Control codes
Some control codes change the following text.

Halt effects with `C300`.

## Highlights
* `C302` - Yellow highlight
* `C303` - Pink highlight

## Speed
* `D2` - Stop entirely until user presses a button
* `DC` - Speak very slowly
* `C9XX` - Pause momentarily, where XX indicates length of pause.

## Alternate Symbols
* `D4` - Like a "shift key"

Enable katakana and other symbols, ranging from 00 to 7F.
This symbol range begins at ガ (ga) in the graphic font and goes on down.

Hiragana mode is re-enabled with `D5`.

## Name of Speaker
`E0XX` - Where "XX" corresponds to the speaker's name.

Names stored somewhere around `0006F3C0`.

## Formatting
* `C0` - Dialog end
* `CD` - Line break
* `D0` - Wipe dialog
* `D1` - Page break

# Test Strings
町*さんは
8099*45685420
の方の
53810453
あいさつが - 158774
