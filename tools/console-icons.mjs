export const CONSOLE_EQUIPMENT_ICON_REFERENCE_URL =
  "https://www.thesupersnes.tv/compendium/robotrek/equipment/";

// Hand-drawn, one-bit 8x8 reductions of the level-1 equipment sprites, excluding
// their blue backgrounds and frames. Keep the original orientation and use
// negative space for knuckles, gun barrels, and other identifying details.
// The names here follow the translated item families; the source calls STONE
// "Celtis" and uses Empty Pack as the first PACK sprite.
export const CONSOLE_EQUIPMENT_ICONS = Object.freeze({
  SWORD: {
    code: 0x3b,
    referenceItem: "Sword 1",
    pixels: [
      "......##",
      ".....##.",
      "....##..",
      ".#.##...",
      "..###...",
      "..##.#..",
      ".##.....",
      "##......",
    ],
  },
  AXE: {
    code: 0x3c,
    referenceItem: "Axe 1",
    pixels: [
      "..###...",
      ".#..#.#.",
      "#...####",
      "#####..#",
      "...#.##.",
      "..##..#.",
      ".##.....",
      "##......",
    ],
  },
  BLADE: {
    code: 0x3d,
    referenceItem: "Blade 1",
    pixels: [
      "##......",
      "###.....",
      ".###..##",
      "..#####.",
      "...###..",
      "....###.",
      "...##.##",
      "......##",
    ],
  },
  HAMMER: {
    code: 0x3e,
    referenceItem: "Hammer 1",
    pixels: [
      "...##...",
      "..####..",
      "..##.##.",
      "...##.##",
      "...#####",
      "..##.##.",
      ".##.....",
      "##......",
    ],
  },
  STONE: {
    code: 0x3f,
    referenceItem: "Celtis 1",
    pixels: [
      "..####..",
      "###..###",
      "#.####.#",
      "###..###",
      "...##...",
      "...##...",
      "...##...",
      "...##...",
    ],
  },
  PUNCH: {
    code: 0x40,
    referenceItem: "Punch 1",
    pixels: [
      "..###...",
      ".##.##..",
      "##.#.##.",
      "#..#.#.#",
      "#.##.#.#",
      "#....##.",
      ".##..#..",
      "...##...",
    ],
  },
  BLOW: {
    code: 0x41,
    referenceItem: "Blow 1",
    pixels: [
      "..####..",
      ".##.#.#.",
      "#.#.#.##",
      "#......#",
      ".######.",
      "...##...",
      "..#####.",
      "..#.#.#.",
    ],
  },
  SHOT: {
    code: 0x42,
    referenceItem: "Shot 1",
    pixels: [
      "........",
      "#######.",
      "#.#...#.",
      "#######.",
      ".#..#.##",
      "..###.##",
      "......##",
      "........",
    ],
  },
  LASER: {
    code: 0x43,
    referenceItem: "Laser 1",
    pixels: [
      "........",
      ".##.....",
      "#..####.",
      "#..##.#.",
      ".######.",
      ".....##.",
      "......##",
      ".....###",
    ],
  },
  BOMB: {
    code: 0x44,
    referenceItem: "Bomb 1",
    pixels: [
      "..####..",
      ".##..##.",
      ".##.###.",
      ".######.",
      "..####..",
      "...##...",
      "..####..",
      ".##..##.",
    ],
  },
  SHIELD: {
    code: 0x45,
    referenceItem: "Shield 1",
    pixels: [
      ".######.",
      ".#....#.",
      ".#.##.#.",
      ".#.##.#.",
      ".#.##.#.",
      ".#....#.",
      "..#..#..",
      "...##...",
    ],
  },
  PACK: {
    code: 0x46,
    referenceItem: "Empty Pack",
    pixels: [
      ".##..##.",
      "#..##..#",
      "#.####.#",
      "#..##..#",
      "#......#",
      "#..##..#",
      ".#....#.",
      ".##..##.",
    ],
  },
  BOOTS: {
    code: 0x47,
    referenceItem: "Boots 1",
    pixels: [
      "....###.",
      "....#.#.",
      "...#.##.",
      "...####.",
      ".######.",
      "########",
      "###..###",
      "........",
    ],
  },
});

export const EQUIPMENT_ICON_BY_OFFSET = new Map([
  ...iconRange("SWORD", ["01F8B3", "01F8BD", "01F8C8", "01F8D2"]),
  ...iconRange("AXE", ["01F8DD", "01F8E6", "01F8F0"]),
  ...iconRange("BLADE", ["01F8F9", "01F904", "01F911", "01F91D"]),
  ...iconRange("HAMMER", ["01F928", "01F933", "01F93D"]),
  ...iconRange("STONE", ["01F947", "01F951", "01F95B"]),
  ...iconRange("PUNCH", ["01F965", "01F971", "01F97C"]),
  ...iconRange("BLOW", ["01F986", "01F990", "01F99B"]),
  ...iconRange("SHOT", ["01F9A5", "01F9AF", "01F9B8"]),
  ...iconRange("LASER", ["01F9C3", "01F9CD", "01F9D8"]),
  ...iconRange("BOMB", ["01F9E3", "01F9ED", "01F9F8", "01FA02"]),
  ...iconRange("SHIELD", ["01FA0C", "01FA17", "01FA23", "01FA2D", "01FA37"]),
  ...iconRange("PACK", ["01FA42", "01FA4E", "01FA59", "01FA64", "01FA6F", "01FA79"]),
  ...iconRange("BOOTS", ["01FA83", "01FA8D", "01FA98", "01FAA3", "01FAAD", "01FAB7"]),
]);

// Console TBL commands need an item-indexed pointer table to render the type
// glyph separately from the translated name. Keep it at the beginning of the
// first WRAM-mirrored expansion bank, immediately below relocated text.
export const CONSOLE_EQUIPMENT_ICON_TABLE = Object.freeze({
  pcOffset: 0x188000,
  snesAddress: 0x988000,
  entryCount: 0x100,
});

export const EQUIPMENT_ICON_BY_ITEM_ID = new Map(
  [...EQUIPMENT_ICON_BY_OFFSET.values()].map((family, index) => [index + 1, family]),
);

export function createConsoleEquipmentIconTable() {
  const { snesAddress, entryCount } = CONSOLE_EQUIPMENT_ICON_TABLE;
  const tableLength = entryCount * 2;
  const tableAddress = snesAddress & 0xffff;
  const emptyStringAddress = tableAddress + tableLength;
  const families = Object.keys(CONSOLE_EQUIPMENT_ICONS);
  const familyStringAddress = new Map(
    families.map((family, index) => [family, emptyStringAddress + 1 + index * 2]),
  );
  const data = Buffer.alloc(tableLength + 1 + families.length * 2);

  for (let itemId = 0; itemId < entryCount; itemId += 1) {
    data.writeUInt16LE(emptyStringAddress, itemId * 2);
  }
  for (const [itemId, family] of EQUIPMENT_ICON_BY_ITEM_ID) {
    data.writeUInt16LE(familyStringAddress.get(family), itemId * 2);
  }
  for (const [index, family] of families.entries()) {
    data[tableLength + 1 + index * 2] = CONSOLE_EQUIPMENT_ICONS[family].code;
  }

  return data;
}

export function consoleEquipmentIcon(name) {
  return CONSOLE_EQUIPMENT_ICONS[name.toUpperCase()];
}

function iconRange(name, offsets) {
  return offsets.map((offset) => [offset, name]);
}
