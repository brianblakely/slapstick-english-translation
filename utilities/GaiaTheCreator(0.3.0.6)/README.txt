******************************************************************
 _______  _______ _________ _______   _________          _______ 
(  ____ \(  ___  )\__   __/(  ___  )  \__   __/|\     /|(  ____ \
| (    \/| (   ) |   ) (   | (   ) |     ) (   | )   ( || (    \/
| |      | (___) |   | |   | (___) |     | |   | (___) || (__    
| | ____ |  ___  |   | |   |  ___  |     | |   |  ___  ||  __)   
| | \_  )| (   ) |   | |   | (   ) |     | |   | (   ) || (      
| (___) || )   ( |___) (___| )   ( |     | |   | )   ( || (____/\
(_______)|/     \|\_______/|/     \|     )_(   |/     \|(_______/
                                                                 
 _______  _______  _______  _______ _________ _______  _______ 
(  ____ \(  ____ )(  ____ \(  ___  )\__   __/(  ___  )(  ____ )
| (    \/| (    )|| (    \/| (   ) |   ) (   | (   ) || (    )|
| |      | (____)|| (__    | (___) |   | |   | |   | || (____)|
| |      |     __)|  __)   |  ___  |   | |   | |   | ||     __)
| |      | (\ (   | (      | (   ) |   | |   | |   | || (\ (   
| (____/\| ) \ \__| (____/\| )   ( |   | |   | (___) || ) \ \__
(_______/|/   \__/(_______/|/     \|   )_(   (_______)|/   \__/

****************************************************************
Version 0.3.0.0
****************************************************************

****************************************************************
Notes
****************************************************************
- Only the US ROM of Illusion of Gaia is supported yet!

****************************************************************
Version History
****************************************************************
Version 0.3.0.6 (2016-03-12)
- View and edit sprites (no export to ROM)
- View and edit maps (export to ROM only for map layer 1, doesn't work for all maps yet)
- View and edit map tiles
- View event, item and character move sprites
- View and edit character text profiles
- Added several commands that are displayed in the event editor
- Added editor version information
- Display of map exit areas

Version 0.2.0.0 (2015-08-23)
- View character animations for Will (still in an early development state)
- The decompression of the map arrangement data is implemented. The tile arrangement is shown for the maps but the tiles don’t fit yet because tileset decompression is still in development..
- Added several event commands that are displayed in the event editor
- Added a tab for world map events. Events can be displayed in the event editor. Also the map display names are shown in the editor. Still in a very early development state.

Version 0.1.0.0 (2014-12-30)
- View and edit text profiles for the main characters.
- Display map exits for every map and view them in the Event Editor.
- Display item and move graphics.
- Display character animation tiles (Will).

Version 0.0.1.3 (2014-11-10)
- Improved the LZSS decompression routine. Decompression will now be much faster now.
- The XML data file is now automatically created and doesn't need to be copied in the
  project directory anymore.
- Save and display the project name in the editor.
- Support of US roms with header.
- Scroll and zoom in the map view.
- Filter option for the display of the map events.
- Display several event commands (Some events might still crash the editor).

Version 0.0.1.2 (2014-07-11)
- Pause screen texts are fully editable
- Map data sets can be edited (only music edit is confirmed working)
- Compressed tilesets consisting of more than one single tileset are
  now treated as one tileset internally

Version 0.0.1.1 (2014-06-20)
- Edit item names, item descriptions and item handlers (not all of
  them are displayed correctly yet)
- Rename data identifiers (e.g. for tilesets or items)
- Change the speed of the background in the item menu

Version 0.0.1.0 (2014-05-14)
- Display every uncompressed (15 Tilesets) and compressed graphics (118 Tilesets)
- View the tilesets with different palettes (not all of them are displayed correct yet)
- Edit the tilesets
- Write the tilesets back to the ROM
