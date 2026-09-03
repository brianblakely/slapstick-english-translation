const STATE_MAGIC = "#!s9xsnp:";
const SECTION_HEADER_LENGTH = 11;
const WRAM_SIZE = 0x20000;

// Japanese Slap Stick addresses. In particular, its player-position globals
// are two bytes earlier than the corresponding US Robotrek symbols.
export const WRAM = Object.freeze({
  mapLoadBusy: 0x0544,
  mapLoadComplete: 0x056a,
  task2Function: 0x00d3,
  nextMap: 0x05a6,
  currentMap: 0x05a8,
  currentMapTimesTwo: 0x05aa,
  robotAvailability: 0x060e,
  money: 0x06e6,
  partyMemberA: 0x0676,
  partyMemberB: 0x0678,
  playerNameDialogue: 0x0612,
  playerNameMenu: 0x0642,
  robotNameDialogue: 0x061e,
  robotNameMenu: 0x064e,
  level: 0x0686,
  statBudget: 0x0688,
  activeRobot: 0x070a,
  battleOrder: 0x070c,
  eventFlags: 0x0730,
  playerX: 0x0ba4,
  playerY: 0x0ba6,
  playerDirection: 0x0ba8,
  battleReturnMap: 0x05c2,
  battleEncounter: 0x05c6,
  battleMode: 0x05c8,
  battleReady: 0x0bbe,
  playerTileX: 0x0bb0,
  playerTileY: 0x0bb2,
  playerSnappedX: 0x0bb4,
  playerSnappedY: 0x0bb6,
  playerActorSlot: 0x0eea,
  inventory: 0x4102,
});

export const INVENTORY_SLOT_COUNT = 72;
export const INVENTORY_FIRST_BAG_SLOT = 1;
export const INVENTORY_LAST_BAG_SLOT = 70;
export const INVENTORY_TRASH_SLOT = 71;

const DIRECTION_IDS = Object.freeze({ down: 0, up: 1, left: 2, right: 3 });
const BUTTONS = new Set([
  "a",
  "b",
  "x",
  "y",
  "l",
  "r",
  "start",
  "select",
  "up",
  "down",
  "left",
  "right",
]);

const TOP_LEVEL_FIELDS = new Set([
  "$schema",
  "version",
  "name",
  "description",
  "checkpoint",
  "catalog",
  "rom",
  "map",
  "room",
  "position",
  "direction",
  "entry",
  "money",
  "flags",
  "inventory",
  "player",
  "party",
  "launch",
  "steps",
  "interaction",
  "wram",
]);

export class ScenarioError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScenarioError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new ScenarioError(`${label} must be an object`);
}

function formatHex(value, width = 4) {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function parseInteger(value, label, minimum, maximum) {
  let parsed = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\$[0-9a-f]+$/i.test(text)) parsed = Number.parseInt(text.slice(1), 16);
    else if (/^0x[0-9a-f]+$/i.test(text)) parsed = Number.parseInt(text.slice(2), 16);
    else if (/^[0-9]+$/.test(text)) parsed = Number.parseInt(text, 10);
  }
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ScenarioError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function numericReference(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (/^\$[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  return undefined;
}

export function normalizeScenarioName(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function catalogIndex(entries, label) {
  if (entries === undefined) return new Map();
  assertPlainObject(entries, `catalog.${label}`);
  const index = new Map();
  for (const [name, value] of Object.entries(entries)) {
    const normalized = normalizeScenarioName(name);
    if (!normalized) throw new ScenarioError(`catalog.${label} contains an empty name`);
    if (index.has(normalized)) {
      throw new ScenarioError(`catalog.${label} contains duplicate alias ${JSON.stringify(name)}`);
    }
    index.set(normalized, value);
  }
  return index;
}

function catalogId(value) {
  if (isPlainObject(value) && Object.hasOwn(value, "id")) return value.id;
  return value;
}

function resolveReference(value, entries, label, maximum) {
  if (isPlainObject(value) && Object.hasOwn(value, "id")) value = value.id;
  const numeric = numericReference(value);
  if (numeric !== undefined) return parseInteger(numeric, label, 0, maximum);
  if (typeof value !== "string") {
    throw new ScenarioError(`${label} must be a catalog name or numeric ID`);
  }
  const match = entries.get(normalizeScenarioName(value));
  if (match === undefined) {
    throw new ScenarioError(`Unknown ${label} ${JSON.stringify(value)}; add it to the scenario catalog or use a numeric ID`);
  }
  return parseInteger(catalogId(match), label, 0, maximum);
}

export function parseSnes9xState(input) {
  const state = Buffer.from(input);
  const newline = state.indexOf(0x0a);
  if (newline < 0 || !state.subarray(0, newline).toString("ascii").startsWith(STATE_MAGIC)) {
    throw new ScenarioError("Checkpoint is not an uncompressed Snes9x save state");
  }

  const sections = [];
  let cursor = newline + 1;
  while (cursor < state.length) {
    if (cursor + SECTION_HEADER_LENGTH > state.length) {
      throw new ScenarioError(`Truncated Snes9x section header at file offset ${formatHex(cursor, 6)}`);
    }
    const header = state.subarray(cursor, cursor + SECTION_HEADER_LENGTH).toString("ascii");
    const match = /^([A-Z0-9]{3}):(\d{6}):$/.exec(header);
    if (!match) {
      throw new ScenarioError(`Invalid Snes9x section header at file offset ${formatHex(cursor, 6)}`);
    }
    const length = Number.parseInt(match[2], 10);
    const dataStart = cursor + SECTION_HEADER_LENGTH;
    const dataEnd = dataStart + length;
    if (dataEnd > state.length) {
      throw new ScenarioError(`Snes9x ${match[1]} section is truncated`);
    }
    sections.push({ tag: match[1], length, headerStart: cursor, dataStart, dataEnd });
    cursor = dataEnd;
  }

  const ramSection = sections.find(({ tag }) => tag === "RAM");
  if (!ramSection) throw new ScenarioError("Checkpoint has no Snes9x RAM section");
  if (ramSection.length !== WRAM_SIZE) {
    throw new ScenarioError(`Checkpoint RAM section is ${ramSection.length} bytes; expected ${WRAM_SIZE}`);
  }

  return {
    state,
    sections,
    ram: state.subarray(ramSection.dataStart, ramSection.dataEnd),
  };
}

function resolveDirection(value, label) {
  if (typeof value === "string") {
    const named = DIRECTION_IDS[value.trim().toLowerCase()];
    if (named !== undefined) return named;
  }
  return parseInteger(value, label, 0, 3);
}

function normalizeInventory(value) {
  if (Array.isArray(value)) return { mode: "replace", items: value };
  assertPlainObject(value, "inventory");
  const allowed = new Set(["mode", "items", "equipped"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown inventory field ${JSON.stringify(key)}`);
  }
  const mode = value.mode ?? "replace";
  if (mode !== "replace" && mode !== "merge") {
    throw new ScenarioError('inventory.mode must be "replace" or "merge"');
  }
  const items = value.items ?? [];
  if (!Array.isArray(items)) throw new ScenarioError("inventory.items must be an array");
  return { mode, items, equipped: value.equipped };
}

function resolveItemWords(items, itemCatalog) {
  const words = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    let reference = entry;
    let quantity = 1;
    let level = 0;
    let raw;
    if (isPlainObject(entry)) {
      const allowed = new Set(["item", "id", "quantity", "level", "raw"]);
      for (const key of Object.keys(entry)) {
        if (!allowed.has(key)) throw new ScenarioError(`Unknown inventory.items[${index}] field ${JSON.stringify(key)}`);
      }
      if (Object.hasOwn(entry, "raw")) {
        if (Object.hasOwn(entry, "item") || Object.hasOwn(entry, "id") || Object.hasOwn(entry, "level")) {
          throw new ScenarioError(`inventory.items[${index}].raw cannot be combined with item, id, or level`);
        }
        raw = parseInteger(entry.raw, `inventory.items[${index}].raw`, 0, 0xffff);
      } else {
        if (Object.hasOwn(entry, "item") && Object.hasOwn(entry, "id")) {
          throw new ScenarioError(`inventory.items[${index}] cannot contain both item and id`);
        }
        reference = entry.item ?? entry.id;
        if (reference === undefined) {
          throw new ScenarioError(`inventory.items[${index}] needs item, id, or raw`);
        }
        level = parseInteger(entry.level ?? 0, `inventory.items[${index}].level`, 0, 0xff);
      }
      quantity = parseInteger(entry.quantity ?? 1, `inventory.items[${index}].quantity`, 1, 70);
    }
    const word = raw ?? (resolveReference(reference, itemCatalog, `inventory item at index ${index}`, 0xff) | (level << 8));
    for (let count = 0; count < quantity; count += 1) words.push(word);
  }
  if (words.length > INVENTORY_LAST_BAG_SLOT) {
    throw new ScenarioError(`Inventory contains ${words.length} items, but only ${INVENTORY_LAST_BAG_SLOT} bag slots are available`);
  }
  return words;
}

function normalizeParty(value) {
  if (Array.isArray(value)) return { members: value };
  assertPlainObject(value, "party");
  const allowed = new Set(["members", "robots", "robotsAvailable", "active", "activeRobot", "order"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown party field ${JSON.stringify(key)}`);
  }
  if (value.robots !== undefined && value.robotsAvailable !== undefined) {
    throw new ScenarioError("party cannot contain both robots and robotsAvailable");
  }
  if (value.active !== undefined && value.activeRobot !== undefined) {
    throw new ScenarioError("party cannot contain both active and activeRobot");
  }
  return {
    members: value.members,
    robots: value.robotsAvailable ?? value.robots,
    activeRobot: value.activeRobot ?? value.active,
    order: value.order,
  };
}

function normalizePlayer(value) {
  if (value === undefined) return undefined;
  assertPlainObject(value, "player");
  const allowed = new Set(["name", "level"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown player field ${JSON.stringify(key)}`);
  }
  if (value.name !== undefined &&
      (typeof value.name !== "string" || !/^[A-Za-z]{1,5}$/.test(value.name))) {
    throw new ScenarioError("player.name must contain 1 through 5 ASCII letters");
  }
  if (value.name === undefined && value.level === undefined) {
    throw new ScenarioError("player needs name or level");
  }
  return {
    name: value.name,
    level: value.level === undefined
      ? undefined
      : parseInteger(value.level, "player.level", 1, 99),
  };
}

function encodeMenuName(name) {
  return [...name].map((character) => {
    const code = character.codePointAt(0);
    if (code >= 0x41 && code <= 0x5a) return code - 0x41 + 0x21;
    return code - 0x61 + 0xa1;
  });
}

function encodeDialogueName(name) {
  const encoded = [];
  let lowercase = false;
  for (const character of name) {
    const code = character.codePointAt(0);
    const nextLowercase = code >= 0x61 && code <= 0x7a;
    if (nextLowercase !== lowercase) encoded.push(nextLowercase ? 0xd4 : 0xd5);
    lowercase = nextLowercase;
    encoded.push((nextLowercase ? code - 0x61 : code - 0x41) + 0x21);
  }
  encoded.push(0xd5, 0xcc);
  return encoded;
}

export function normalizeInteraction(value) {
  if (value === undefined || value === null || value === false) return undefined;
  let interaction = value;
  if (typeof value === "string") interaction = { button: value };
  assertPlainObject(interaction, "interaction");
  const allowed = new Set(["button", "delayFrames", "holdFrames", "afterFrames"]);
  for (const key of Object.keys(interaction)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown interaction field ${JSON.stringify(key)}`);
  }
  const button = String(interaction.button ?? "a").toLowerCase();
  if (!BUTTONS.has(button)) throw new ScenarioError(`Unknown interaction button ${JSON.stringify(button)}`);
  return {
    button,
    delayFrames: parseInteger(interaction.delayFrames ?? 1, "interaction.delayFrames", 0, 60000),
    holdFrames: parseInteger(interaction.holdFrames ?? 1, "interaction.holdFrames", 1, 60000),
    afterFrames: parseInteger(interaction.afterFrames ?? 2, "interaction.afterFrames", 0, 60000),
  };
}

export function normalizeSteps(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ScenarioError("scenario.steps must be an array");
  return value.map((step, index) => {
    if (typeof step === "string") return normalizeInteraction(step);
    assertPlainObject(step, `steps[${index}]`);
    if (Object.hasOwn(step, "waitFrames")) {
      if (Object.keys(step).length !== 1) {
        throw new ScenarioError(`steps[${index}].waitFrames cannot be combined with an input`);
      }
      return {
        waitFrames: parseInteger(step.waitFrames, `steps[${index}].waitFrames`, 1, 60000),
      };
    }
    return normalizeInteraction(step);
  });
}

export function normalizeLaunch(value) {
  if (value === undefined) {
    return { ready: "map", settleFrames: 120, timeoutFrames: 3600 };
  }
  assertPlainObject(value, "scenario.launch");
  const allowed = new Set(["ready", "settleFrames", "timeoutFrames"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown launch field ${JSON.stringify(key)}`);
  }
  const ready = value.ready ?? "map";
  if (ready !== "map" && ready !== "field") {
    throw new ScenarioError('launch.ready must be "map" or "field"');
  }
  return {
    ready,
    settleFrames: parseInteger(value.settleFrames ?? 120, "launch.settleFrames", 0, 60000),
    timeoutFrames: parseInteger(value.timeoutFrames ?? 3600, "launch.timeoutFrames", 1, 60000),
  };
}

function normalizeWramWrites(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ScenarioError("scenario.wram must be an array");
  return value.map((write, index) => {
    assertPlainObject(write, `wram[${index}]`);
    const allowed = new Set(["address", "width", "value"]);
    for (const key of Object.keys(write)) {
      if (!allowed.has(key)) throw new ScenarioError(`Unknown wram[${index}] field ${JSON.stringify(key)}`);
    }
    if (write.address === undefined || write.value === undefined) {
      throw new ScenarioError(`wram[${index}] needs address and value`);
    }
    const width = parseInteger(write.width ?? 2, `wram[${index}].width`, 1, 2);
    const address = parseInteger(write.address, `wram[${index}].address`, 0, WRAM_SIZE - width);
    const maximum = width === 1 ? 0xff : 0xffff;
    const writeValue = parseInteger(write.value, `wram[${index}].value`, 0, maximum);
    return { address, width, value: writeValue };
  });
}

function validateEntry(value) {
  if (value === undefined || value === "field") return { type: "field" };
  assertPlainObject(value, "entry");
  const allowed = new Set(["type", "encounter", "ready", "settleFrames", "timeoutFrames"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ScenarioError(`Unknown entry field ${JSON.stringify(key)}`);
  }
  const type = value.type ?? "field";
  if (type !== "field" && type !== "battle") {
    throw new ScenarioError('entry.type must be "field" or "battle"');
  }
  if (type === "field") {
    if (Object.keys(value).some((key) => key !== "type")) {
      throw new ScenarioError("A field entry cannot contain battle options");
    }
    return { type };
  }
  if (value.encounter === undefined) throw new ScenarioError("A battle entry needs encounter");
  const ready = value.ready ?? "command";
  if (ready !== "loaded" && ready !== "command") {
    throw new ScenarioError('entry.ready must be "loaded" or "command"');
  }
  return {
    type,
    encounter: value.encounter,
    ready,
    // A command-ready battle is already interactive at the matching frame;
    // even a short delay can let a fast encounter resolve autonomously.
    settleFrames: parseInteger(
      value.settleFrames ?? (ready === "command" ? 0 : 30),
      "entry.settleFrames",
      0,
      60000,
    ),
    timeoutFrames: parseInteger(value.timeoutFrames ?? 3600, "entry.timeoutFrames", 1, 60000),
  };
}

export function validateScenario(scenario) {
  assertPlainObject(scenario, "scenario");
  for (const key of Object.keys(scenario)) {
    if (!TOP_LEVEL_FIELDS.has(key)) throw new ScenarioError(`Unknown scenario field ${JSON.stringify(key)}`);
  }
  if (typeof scenario.name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(scenario.name)) {
    throw new ScenarioError("scenario.name must be a filename-safe name");
  }
  if (scenario.checkpoint !== undefined &&
      (typeof scenario.checkpoint !== "string" || !scenario.checkpoint.trim())) {
    throw new ScenarioError("scenario.checkpoint must name a non-empty base checkpoint");
  }
  for (const field of ["$schema", "description", "catalog", "rom"]) {
    if (scenario[field] !== undefined && typeof scenario[field] !== "string") {
      throw new ScenarioError(`scenario.${field} must be a string`);
    }
  }
  for (const field of ["catalog", "rom"]) {
    if (scenario[field] !== undefined && !scenario[field].trim()) {
      throw new ScenarioError(`scenario.${field} must not be empty`);
    }
  }
  if (scenario.version !== undefined && scenario.version !== 1) {
    throw new ScenarioError(`Unsupported scenario version ${JSON.stringify(scenario.version)}`);
  }
  normalizeInteraction(scenario.interaction);
  normalizeLaunch(scenario.launch);
  normalizePlayer(scenario.player);
  normalizeSteps(scenario.steps);
  normalizeWramWrites(scenario.wram);
  validateEntry(scenario.entry);
  return scenario;
}

function applyScenarioToRam(
  ram,
  scenario,
  catalog = {},
  { allowMapChange = false, updateLiveActor = true, initializeRobots = false } = {},
) {
  validateScenario(scenario);
  assertPlainObject(catalog, "catalog");
  if (catalog.version !== undefined && catalog.version !== 1) {
    throw new ScenarioError(`Unsupported scenario catalog version ${JSON.stringify(catalog.version)}`);
  }
  const maps = catalogIndex(catalog.maps, "maps");
  const flags = catalogIndex(catalog.flags, "flags");
  const items = catalogIndex(catalog.items, "items");
  const partyMembers = catalogIndex(catalog.partyMembers, "partyMembers");
  const encounters = catalogIndex(catalog.encounters, "encounters");
  const changes = [];

  const readByte = (offset) => ram.readUInt8(offset);
  const readWord = (offset) => ram.readUInt16LE(offset);
  const writeByte = (offset, value, field) => {
    const before = readByte(offset);
    if (before === value) return;
    ram.writeUInt8(value, offset);
    changes.push({ field, offset: formatHex(offset), width: 1, before, after: value });
  };
  const writeWord = (offset, value, field) => {
    const before = readWord(offset);
    if (before === value) return;
    ram.writeUInt16LE(value, offset);
    changes.push({ field, offset: formatHex(offset), width: 2, before, after: value });
  };

  let requestedMap;
  if (scenario.map !== undefined) requestedMap = resolveReference(scenario.map, maps, "map", 0x01f3);
  if (scenario.room !== undefined) {
    const room = resolveReference(scenario.room, maps, "room", 0x01f3);
    if (requestedMap !== undefined && requestedMap !== room) {
      throw new ScenarioError(`scenario.map and scenario.room resolve to different map IDs (${formatHex(requestedMap)} and ${formatHex(room)})`);
    }
    requestedMap = room;
  }
  const startingMap = readWord(WRAM.currentMap);
  if (requestedMap !== undefined && startingMap !== requestedMap) {
    if (!allowMapChange) {
      throw new ScenarioError(
        `Scenario requests map ${formatHex(requestedMap)}, but checkpoint is on ${formatHex(startingMap)}. ` +
        "Use a checkpoint captured in the requested room; changing only the map ID would leave stale tiles, actors, and scripts.",
      );
    }
    writeWord(WRAM.currentMap, requestedMap, "map");
    writeWord(WRAM.currentMapTimesTwo, (requestedMap * 2) & 0xffff, "map.timesTwo");
  }

  let direction = scenario.direction;
  if (scenario.position !== undefined) {
    assertPlainObject(scenario.position, "position");
    const allowed = new Set(["x", "y", "direction"]);
    for (const key of Object.keys(scenario.position)) {
      if (!allowed.has(key)) throw new ScenarioError(`Unknown position field ${JSON.stringify(key)}`);
    }
    if (scenario.position.x === undefined || scenario.position.y === undefined) {
      throw new ScenarioError("position must contain both x and y");
    }
    if (direction !== undefined && scenario.position.direction !== undefined) {
      const outer = resolveDirection(direction, "direction");
      const inner = resolveDirection(scenario.position.direction, "position.direction");
      if (outer !== inner) throw new ScenarioError("direction and position.direction disagree");
    }
    direction ??= scenario.position.direction;
    const x = parseInteger(scenario.position.x, "position.x", 0, 0xfff7);
    const y = parseInteger(scenario.position.y, "position.y", 0, 0xffef);
    writeWord(WRAM.playerX, x, "position.x");
    writeWord(WRAM.playerY, y, "position.y");
    if (updateLiveActor) {
      const actorSlot = readWord(WRAM.playerActorSlot);
      if (actorSlot < 0x1000 || actorSlot + 0x0e > ram.length) {
        throw new ScenarioError(`Checkpoint has no usable player actor slot (${formatHex(actorSlot)})`);
      }
      writeWord(WRAM.playerTileX, x >>> 4, "position.tileX");
      writeWord(WRAM.playerTileY, y >>> 4, "position.tileY");
      writeWord(WRAM.playerSnappedX, x & 0xfff0, "position.snappedX");
      writeWord(WRAM.playerSnappedY, y & 0xfff0, "position.snappedY");
      writeWord(actorSlot, x + 8, "position.actorX");
      writeWord(actorSlot + 2, y + 16, "position.actorY");
    }
  }

  if (direction !== undefined) {
    const value = resolveDirection(direction, "direction");
    writeWord(WRAM.playerDirection, value, "direction");
    if (updateLiveActor) {
      const actorSlot = readWord(WRAM.playerActorSlot);
      if (actorSlot < 0x1000 || actorSlot + 0x0e > ram.length) {
        throw new ScenarioError(`Checkpoint has no usable player actor slot (${formatHex(actorSlot)})`);
      }
      writeWord(actorSlot + 0x0c, value, "direction.actor");
    }
  }

  if (scenario.money !== undefined) {
    const amount = parseInteger(scenario.money, "money", 0, 99999);
    const digits = String(amount).padStart(5, "0");
    const packed = [
      Number(digits[4]) | (Number(digits[3]) << 4),
      Number(digits[2]) | (Number(digits[1]) << 4),
      Number(digits[0]),
    ];
    packed.forEach((value, index) => writeByte(WRAM.money + index, value, "money"));
  }

  const player = normalizePlayer(scenario.player);
  if (player?.name) {
    const encoded = encodeMenuName(player.name);
    const dialogueEncoded = encodeDialogueName(player.name);
    const dialogue = Buffer.alloc(12);
    Buffer.from(dialogueEncoded).copy(dialogue);
    const menu = Buffer.alloc(12);
    menu.fill(0x20, 0, 5);
    Buffer.from(encoded).copy(menu);
    for (let index = 0; index < 12; index += 1) {
      writeByte(WRAM.playerNameDialogue + index, dialogue[index], `player.name.dialogue[${index}]`);
      writeByte(WRAM.playerNameMenu + index, menu[index], `player.name.menu[${index}]`);
    }
  }
  if (player?.level !== undefined) {
    writeWord(WRAM.level, player.level, "player.level");
    writeWord(WRAM.statBudget, 30 + 10 * player.level, "player.statBudget");
  }

  if (scenario.flags !== undefined) {
    assertPlainObject(scenario.flags, "flags");
    for (const [name, enabled] of Object.entries(scenario.flags)) {
      if (typeof enabled !== "boolean") throw new ScenarioError(`flags.${name} must be true or false`);
      const id = resolveReference(name, flags, `flag ${JSON.stringify(name)}`, 0x03ff);
      const offset = WRAM.eventFlags + (id >>> 3);
      const mask = 1 << (id & 7);
      const byte = readByte(offset);
      const before = (byte & mask) !== 0;
      if (before === enabled) continue;
      writeByte(offset, enabled ? byte | mask : byte & ~mask, `flags.${name}`);
      const last = changes.at(-1);
      last.flagId = id;
      last.before = before;
      last.after = enabled;
    }
  }

  if (scenario.inventory !== undefined) {
    const inventory = normalizeInventory(scenario.inventory);
    const words = resolveItemWords(inventory.items, items);
    if (inventory.mode === "replace") {
      for (let slot = INVENTORY_FIRST_BAG_SLOT; slot <= INVENTORY_LAST_BAG_SLOT; slot += 1) {
        writeWord(WRAM.inventory + slot * 2, 0, `inventory.slots[${slot}]`);
      }
    }
    const availableSlots = [];
    for (let slot = INVENTORY_FIRST_BAG_SLOT; slot <= INVENTORY_LAST_BAG_SLOT; slot += 1) {
      if (readWord(WRAM.inventory + slot * 2) === 0) availableSlots.push(slot);
    }
    if (words.length > availableSlots.length) {
      throw new ScenarioError(`Inventory needs ${words.length} free slots, but only ${availableSlots.length} are available`);
    }
    words.forEach((word, index) => {
      const slot = availableSlots[index];
      writeWord(WRAM.inventory + slot * 2, word, `inventory.slots[${slot}]`);
    });
    if (inventory.equipped !== undefined) {
      let equippedWord = 0;
      if (inventory.equipped !== null) {
        const equippedWords = resolveItemWords([inventory.equipped], items);
        if (equippedWords.length !== 1) {
          throw new ScenarioError("inventory.equipped must resolve to exactly one item");
        }
        [equippedWord] = equippedWords;
      }
      writeWord(WRAM.inventory, equippedWord, "inventory.equipped");
    }
  }

  if (scenario.party !== undefined) {
    const party = normalizeParty(scenario.party);
    if (party.members !== undefined) {
      if (!Array.isArray(party.members) || party.members.length > 2) {
        throw new ScenarioError("party.members must be an array with at most two entries");
      }
      const resolved = party.members.map((member, index) =>
        resolveReference(member, partyMembers, `party member at index ${index}`, 0xffff),
      );
      writeWord(WRAM.partyMemberA, resolved[0] ?? 0, "party.members[0]");
      writeWord(WRAM.partyMemberB, resolved[1] ?? 0, "party.members[1]");
    }
    let robots;
    if (party.robots !== undefined) {
      if (!Array.isArray(party.robots)) throw new ScenarioError("party.robots must be an array");
      robots = party.robots.map((robot, index) => parseInteger(robot, `party.robots[${index}]`, 1, 3));
      if (new Set(robots).size !== robots.length) throw new ScenarioError("party.robots cannot contain duplicates");
      const mask = robots.reduce((result, robot) => result | (1 << (robot - 1)), 0);
      writeWord(
        WRAM.robotAvailability,
        (readWord(WRAM.robotAvailability) & ~0x0707) | mask | (mask << 8),
        "party.robots",
      );
      if (initializeRobots) {
        const level = player?.level ?? 1;
        const energy = 30 + 10 * level;
        const names = ["Alpha", "Beta", "Gamma"];
        for (const robot of robots) {
          const wordIndex = robot * 2;
          writeWord(0x0688 + wordIndex, energy, `party.robots[${robot}].energy`);
          writeWord(0x068e + wordIndex, energy, `party.robots[${robot}].maxEnergy`);
          for (const address of [0x0694, 0x069a, 0x06a0, 0x06a6]) {
            writeWord(address + wordIndex, 0, `party.robots[${robot}].stats`);
          }
          for (const [address, value, slot] of [
            [0x06c4, 0x0101, "right"],
            [0x06ca, 0x0118, "left"],
            [0x06d0, 0x011e, "back"],
            [0x06d6, 0x002d, "movement"],
          ]) {
            writeWord(address + wordIndex, value, `party.robots[${robot}].equipment.${slot}`);
          }
          const menuName = encodeMenuName(names[robot - 1]);
          const dialogueName = encodeDialogueName(names[robot - 1]);
          const dialogue = Buffer.alloc(12);
          const menu = Buffer.alloc(12);
          Buffer.from(dialogueName).copy(dialogue);
          menu.fill(0x20, 0, 5);
          Buffer.from(menuName).copy(menu);
          for (let byte = 0; byte < 12; byte += 1) {
            writeByte(
              WRAM.robotNameDialogue + (robot - 1) * 12 + byte,
              dialogue[byte],
              `party.robots[${robot}].name.dialogue[${byte}]`,
            );
            writeByte(
              WRAM.robotNameMenu + (robot - 1) * 12 + byte,
              menu[byte],
              `party.robots[${robot}].name.menu[${byte}]`,
            );
          }
        }
      }
    }
    const activeRobot = party.activeRobot ??
      (initializeRobots && robots?.length ? robots[0] : undefined);
    if (activeRobot !== undefined) {
      const active = parseInteger(activeRobot, "party.activeRobot", 1, 3);
      if (robots !== undefined && !robots.includes(active)) {
        throw new ScenarioError(`party.activeRobot ${active} is not included in party.robots`);
      }
      writeWord(WRAM.activeRobot, active * 2, "party.activeRobot");
    }
    if (party.order !== undefined) {
      if (!Array.isArray(party.order) || party.order.length !== 3) {
        throw new ScenarioError("party.order must contain all three robot numbers");
      }
      const order = party.order.map((robot, index) => parseInteger(robot, `party.order[${index}]`, 1, 3));
      if (new Set(order).size !== 3) throw new ScenarioError("party.order must contain each robot exactly once");
      order.forEach((robot, index) => writeWord(WRAM.battleOrder + index * 2, robot, `party.order[${index}]`));
    }
  }

  for (const [index, write] of normalizeWramWrites(scenario.wram).entries()) {
    const field = `wram[${index}]`;
    if (write.width === 1) writeByte(write.address, write.value, field);
    else writeWord(write.address, write.value, field);
  }

  const entry = validateEntry(scenario.entry);
  if (entry.type === "battle") {
    entry.encounter = resolveReference(entry.encounter, encounters, "encounter", 0xffff);
  }

  return {
    ram,
    changes,
    currentMap: readWord(WRAM.currentMap),
    requestedMap,
    entry,
    interaction: normalizeInteraction(scenario.interaction),
    launch: normalizeLaunch(scenario.launch),
    steps: normalizeSteps(scenario.steps),
  };
}

export function resolveBattleEntry(romInput, returnMapInput, encounterInput) {
  const rom = Buffer.from(romInput);
  const returnMap = parseInteger(returnMapInput, "battle return map", 0, 0xffff);
  const battleMapTable = 0x01ad3b;
  if (returnMap > 0x01c1 || battleMapTable + returnMap * 2 + 2 > rom.length) {
    throw new ScenarioError(`Map ${formatHex(returnMap)} has no normal battle-map lookup entry`);
  }
  const battleMap = rom.readUInt16LE(battleMapTable + returnMap * 2);
  if (battleMap === 0) {
    throw new ScenarioError(`Map ${formatHex(returnMap)} cannot start a normal encounter`);
  }
  const encounter = parseInteger(encounterInput, "entry.encounter", 0, 0xd1);
  const encounterPointer = rom.readUInt16LE(0x038000 + encounter * 2);
  if (encounterPointer === 0) {
    throw new ScenarioError(`Encounter ${formatHex(encounter, 2)} has no ROM definition`);
  }
  return { battleMap, returnMap, encounter };
}

export function applyBattleEntryToState(input, romInput, entry) {
  const parsed = parseSnes9xState(input);
  const ram = parsed.ram;
  if (!entry || entry.type !== "battle") {
    throw new ScenarioError("applyBattleEntryToState needs a normalized battle entry");
  }
  const resolved = resolveBattleEntry(
    romInput,
    ram.readUInt16LE(WRAM.currentMap),
    entry.encounter,
  );
  const { battleMap, returnMap, encounter } = resolved;
  const actorSlot = ram.readUInt16LE(WRAM.playerActorSlot);
  if (actorSlot < 0x1000 || actorSlot >= 0x2000) {
    throw new ScenarioError(
      `Battle entry needs a loaded field player, but player actor slot is ${formatHex(actorSlot)}`,
    );
  }
  const availabilityMask = ram.readUInt16LE(WRAM.robotAvailability) & 0x0007;
  if (availabilityMask === 0) {
    throw new ScenarioError("Battle entry needs at least one available robot in party.robots");
  }

  const changes = [];
  const writeWord = (address, value, field) => {
    const before = ram.readUInt16LE(address);
    if (before === value) return;
    ram.writeUInt16LE(value, address);
    changes.push({ field, offset: formatHex(address), width: 2, before, after: value });
  };
  writeWord(WRAM.battleReturnMap, returnMap, "entry.battle.returnMap");
  writeWord(WRAM.nextMap, battleMap, "entry.battle.map");
  writeWord(0x05b6, 0, "entry.battle.direction");
  writeWord(0x05ba, 0x0120, "entry.battle.x");
  writeWord(0x05be, 0x0080, "entry.battle.y");
  writeWord(WRAM.battleEncounter, encounter, "entry.battle.encounter");
  for (const address of [0x05ca, 0x05cc, 0x05ce, 0x05d0, 0x05d2]) {
    writeWord(address, 0, "entry.battle.runtime");
  }
  writeWord(WRAM.battleMode, 0x8000, "entry.battle.mode");
  writeWord(WRAM.task2Function, 0x84cb, "entry.battle.scheduler");
  return {
    state: parsed.state,
    changes,
    battleMap,
    returnMap,
    encounter,
    availabilityMask,
  };
}

export function applyScenarioToState(input, scenario, catalog = {}) {
  const parsed = parseSnes9xState(input);
  const applied = applyScenarioToRam(parsed.ram, scenario, catalog);
  return { ...applied, state: parsed.state };
}

export function applyScenarioToNewGameRam(scenario, catalog = {}) {
  // Validate the caller's object before adding launcher-only defaults so an
  // invalid value (for example player: null) cannot be hidden by the merge.
  validateScenario(scenario);
  const initialRam = Buffer.alloc(WRAM_SIZE);
  initialRam.writeUInt16LE(11, WRAM.currentMap);
  initialRam.writeUInt16LE(22, WRAM.currentMapTimesTwo);
  initialRam.writeUInt16LE(48, WRAM.playerX);
  initialRam.writeUInt16LE(640, WRAM.playerY);
  initialRam.writeUInt16LE(0, WRAM.playerDirection);
  initialRam.writeUInt16LE(0x00cc, 0x061e);
  initialRam.writeUInt16LE(0x00cc, 0x062a);
  initialRam.writeUInt16LE(0x00cc, 0x0636);
  initialRam.writeUInt16LE(1, 0x0608);
  initialRam.writeUInt16LE(0x0070, 0x060a);
  initialRam.writeUInt16LE(0x0070, 0x060c);
  initialRam.writeUInt16LE(2, WRAM.activeRobot);
  initialRam.writeUInt16LE(1, WRAM.battleOrder);
  initialRam.writeUInt16LE(2, WRAM.battleOrder + 2);
  initialRam.writeUInt16LE(3, WRAM.battleOrder + 4);
  initialRam.writeUInt16LE(0x0087, WRAM.inventory + INVENTORY_TRASH_SLOT * 2);
  initialRam.writeUInt16LE(0x0087, 0x4220);

  const ram = Buffer.from(initialRam);
  // The normal name-entry screen is deliberately bypassed by checkpoint-free
  // launches, so provide its English default unless the scenario supplies a
  // name. Preserve independent player settings such as level while doing so.
  const launchScenario = {
    ...scenario,
    player: { name: "Rask", ...(scenario.player ?? {}) },
  };
  const applied = applyScenarioToRam(ram, launchScenario, catalog, {
    allowMapChange: true,
    updateLiveActor: false,
    initializeRobots: true,
  });
  return { ...applied, initialRam };
}
