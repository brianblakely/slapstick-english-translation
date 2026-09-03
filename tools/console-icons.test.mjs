import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSOLE_EQUIPMENT_ICON_REFERENCE_URL,
  CONSOLE_EQUIPMENT_ICONS,
  CONSOLE_EQUIPMENT_ICON_TABLE,
  EQUIPMENT_ICON_BY_ITEM_ID,
  EQUIPMENT_ICON_BY_OFFSET,
  consoleEquipmentIcon,
  createConsoleEquipmentIconTable,
} from "./console-icons.mjs";

const REFERENCE_ITEMS = [
  "Sword 1",
  "Axe 1",
  "Blade 1",
  "Hammer 1",
  "Celtis 1",
  "Punch 1",
  "Blow 1",
  "Shot 1",
  "Laser 1",
  "Bomb 1",
  "Shield 1",
  "Empty Pack",
  "Boots 1",
];

test("defines one valid console glyph for every equipment family", () => {
  const entries = Object.entries(CONSOLE_EQUIPMENT_ICONS);
  assert.equal(
    CONSOLE_EQUIPMENT_ICON_REFERENCE_URL,
    "https://www.thesupersnes.tv/compendium/robotrek/equipment/",
  );
  assert.equal(entries.length, REFERENCE_ITEMS.length);
  assert.deepEqual(entries.map(([, icon]) => icon.referenceItem), REFERENCE_ITEMS);
  assert.deepEqual(entries.map(([, icon]) => icon.code),
    Array.from({ length: entries.length }, (_, index) => 0x3b + index));

  const bitmaps = new Set();
  for (const [name, icon] of entries) {
    assert.equal(icon.pixels.length, 8, `${name} height`);
    for (const row of icon.pixels) assert.match(row, /^[.#]{8}$/, `${name} row`);
    const bitmap = icon.pixels.join("\n");
    assert(!bitmaps.has(bitmap), `${name} duplicates another glyph`);
    bitmaps.add(bitmap);
    assert.equal(consoleEquipmentIcon(name.toLowerCase()), icon);
  }
});

test("assigns a family icon to all 50 equipment-name entries", () => {
  assert.equal(EQUIPMENT_ICON_BY_OFFSET.size, 50);
  assert.equal(EQUIPMENT_ICON_BY_ITEM_ID.size, 50);
  const counts = Object.fromEntries(Object.keys(CONSOLE_EQUIPMENT_ICONS).map((name) => [name, 0]));
  for (const family of EQUIPMENT_ICON_BY_OFFSET.values()) counts[family] += 1;
  assert.deepEqual(counts, {
    SWORD: 4,
    AXE: 3,
    BLADE: 4,
    HAMMER: 3,
    STONE: 3,
    PUNCH: 3,
    BLOW: 3,
    SHOT: 3,
    LASER: 3,
    BOMB: 4,
    SHIELD: 5,
    PACK: 6,
    BOOTS: 6,
  });
});

test("builds a total item lookup table for dynamic equipment icons", () => {
  const { snesAddress, entryCount } = CONSOLE_EQUIPMENT_ICON_TABLE;
  const table = createConsoleEquipmentIconTable();
  const pointerBytes = entryCount * 2;
  const emptyStringAddress = (snesAddress & 0xffff) + pointerBytes;
  assert.equal(table.length, pointerBytes + 1 + Object.keys(CONSOLE_EQUIPMENT_ICONS).length * 2);
  assert.equal(table[emptyStringAddress - (snesAddress & 0xffff)], 0x00);

  for (let itemId = 0; itemId < entryCount; itemId += 1) {
    const pointer = table.readUInt16LE(itemId * 2);
    const family = EQUIPMENT_ICON_BY_ITEM_ID.get(itemId);
    if (!family) {
      assert.equal(pointer, emptyStringAddress, `item ${itemId} uses the empty icon string`);
      continue;
    }
    const stringOffset = pointer - (snesAddress & 0xffff);
    assert.equal(table[stringOffset], CONSOLE_EQUIPMENT_ICONS[family].code, `item ${itemId}`);
    assert.equal(table[stringOffset + 1], 0x00, `item ${itemId} icon terminator`);
  }
});
