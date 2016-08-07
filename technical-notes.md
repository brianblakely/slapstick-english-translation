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

# Test Strings
町*さんは
8099*45685420
の方の
53810453
あいさつが - 158774
町長
80998082
