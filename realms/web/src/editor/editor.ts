import * as THREE from "three";
import { type Hex, hex, key, spiral } from "../hex";
import { formatMap } from "../maps/format";
import { GameMap } from "../maps/gameMap";
import { loadMap, mapIds } from "../maps/load";
import {
  MAP_KINDS,
  type MapData,
  type MapKind,
  NPC_KINDS,
  PROP_KINDS,
  REGIONS,
  type Region,
  TERRAINS,
  type TileData,
  validateMap,
} from "../maps/schema";
import { DOMINARIA } from "../palette";
import { PixelRenderer } from "../render";
import { World } from "../scene/world";

// The map editor (?editor, development only; tech.md B5): paint terrain and height, block and open hexes, place
// scenery, spawns, exits, people, chests and the inn, see the lint's problems as you go, and save the map as the JSON
// its file holds (a download, to put in realms/content/<plane>/maps/). WASD or the arrow keys pan, the wheel zooms.

type Tool = "terrain" | "raise" | "lower" | "flatten" | "block" | "open" | "prop" | "spawn" | "exit" | "npc" | "chest" | "inn" | "erase";

const TOOLS: readonly { tool: Tool; caption: string }[] = [
  { tool: "terrain", caption: "Terrain" },
  { tool: "raise", caption: "Raise" },
  { tool: "lower", caption: "Lower" },
  { tool: "flatten", caption: "Flatten" },
  { tool: "block", caption: "Block" },
  { tool: "open", caption: "Open" },
  { tool: "prop", caption: "Prop" },
  { tool: "spawn", caption: "Spawn" },
  { tool: "exit", caption: "Exit" },
  { tool: "npc", caption: "Person" },
  { tool: "chest", caption: "Chest" },
  { tool: "inn", caption: "Inn hex" },
  { tool: "erase", caption: "Erase" },
];

/** Tools that paint as the pointer is dragged, over the brush's hexes. */
const PAINTS: ReadonlySet<Tool> = new Set(["terrain", "raise", "lower", "flatten", "block", "open"]);

const STEP = 0.25;

type MutableTile = [number, number, number, string, number];

interface Working {
  id: string;
  name: string;
  kind: MapKind;
  region: Region | undefined;
  floor: number | undefined;
  radius: number;
  tiles: Map<string, MutableTile>;
  props: Map<string, string>;
  exits: MapData["exits"][number][];
  spawns: MapData["spawns"][number][];
  chests: MapData["chests"][number][];
  npcs: MapData["npcs"][number][];
  inn: Hex | undefined;
  /** Another map's inn, which this map names (the generator's; the inn tool puts one here instead). */
  innElsewhere: MapData["inn"];
  encounters: MapData["encounters"];
}

function working(data: MapData): Working {
  return {
    id: data.id,
    name: data.name,
    kind: data.kind,
    region: data.region,
    floor: data.floor,
    radius: data.radius,
    tiles: new Map(data.tiles.map((t) => [`${t[0]},${t[1]}`, [...t] as MutableTile])),
    props: new Map(data.props.map((p) => [`${p.q},${p.r}`, p.kind])),
    exits: [...data.exits],
    spawns: [...data.spawns],
    chests: [...data.chests],
    npcs: [...data.npcs],
    inn: data.inn && data.inn.map === undefined ? hex(data.inn.q, data.inn.r) : undefined,
    innElsewhere: data.inn?.map !== undefined ? data.inn : undefined,
    encounters: data.encounters,
  };
}

function blank(radius: number): MapData {
  return {
    id: "new-map",
    name: "New map",
    kind: "wilderness",
    radius,
    tiles: spiral(hex(0, 0), radius).map((h) => [h.q, h.r, 0, "grass", 0] as const),
    props: [],
    exits: [],
    spawns: [],
    chests: [],
    npcs: [],
  };
}

function toData(w: Working): MapData {
  const order = spiral(hex(0, 0), w.radius).map(key);
  return {
    id: w.id,
    name: w.name,
    kind: w.kind,
    ...(w.region ? { region: w.region } : {}),
    ...(w.kind === "dungeon" ? { floor: w.floor ?? 1 } : {}),
    radius: w.radius,
    ...(w.inn ? { inn: { q: w.inn.q, r: w.inn.r } } : w.innElsewhere ? { inn: w.innElsewhere } : {}),
    tiles: order.map((k) => w.tiles.get(k)).filter((t): t is MutableTile => t !== undefined) as TileData[],
    props: order
      .filter((k) => w.props.has(k))
      .map((k) => {
        const [q, r] = k.split(",").map(Number);
        return { q: q!, r: r!, kind: w.props.get(k)! };
      }),
    exits: w.exits,
    spawns: w.spawns,
    chests: w.chests,
    npcs: w.npcs,
    ...(w.encounters ? { encounters: w.encounters } : {}),
  };
}

export async function runEditor(canvas: HTMLCanvasElement, mapId: string | null): Promise<void> {
  const pixels = new PixelRenderer(canvas, DOMINARIA);
  let map = working(mapId && mapId !== "new" ? (await loadMap(mapId)).data : blank(12));
  let world = new World(new GameMap(toData(map)));
  let dirty = false;
  let tool: Tool = "terrain";
  const focus = new THREE.Vector3();
  const held = new Set<string>();
  let painting = false;
  let lastPainted = "";

  // The toolbar.
  const bar = document.createElement("div");
  bar.className = "editor-bar panel";
  bar.innerHTML = `
    <label>Map <select data-test="editor:map"><option value="new">(new map)</option>${mapIds().map((id) => `<option>${id}</option>`).join("")}</select></label>
    <label>Id <input data-field="id" /></label>
    <label>Name <input data-field="name" /></label>
    <label>Kind <select data-field="kind">${MAP_KINDS.map((k) => `<option>${k}</option>`).join("")}</select></label>
    <label>Region <select data-field="region"><option value="">(none)</option>${REGIONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
    <label>Floor <input data-field="floor" type="number" min="1" /></label>
    <div class="tools">${TOOLS.map((t) => `<button data-tool="${t.tool}" data-test="editor:tool:${t.tool}">${t.caption}</button>`).join("")}</div>
    <label>Brush <input data-field="brush" type="range" min="0" max="3" value="0" /></label>
    <label>Terrain <select data-field="terrain" data-test="editor:terrain">${TERRAINS.map((t) => `<option>${t}</option>`).join("")}</select></label>
    <label>Prop <select data-field="prop">${PROP_KINDS.map((p) => `<option>${p}</option>`).join("")}</select></label>
    <label>Spawn mobs <input data-field="mobs" placeholder="phyrexian-scout, urborg-ghoul" /></label>
    <label>Exit to <input data-field="to" value="world" /></label>
    <label>Person <select data-field="npc">${NPC_KINDS.map((k) => `<option>${k}</option>`).join("")}</select></label>
    <label>Vendor id, name <input data-field="vendor" placeholder="vendor id" /><input data-field="npcName" placeholder="name" /></label>
    <button class="primary" data-test="editor:save">Save JSON</button>
    <div class="problems" data-test="editor:problems"></div>`;
  document.body.appendChild(bar);
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => bar.querySelector<T>(`[data-field=${name}]`)!;
  const fill = () => {
    field("id").value = map.id;
    field("name").value = map.name;
    field<HTMLSelectElement>("kind").value = map.kind;
    field<HTMLSelectElement>("region").value = map.region ?? "";
    field("floor").value = map.floor === undefined ? "" : String(map.floor);
    bar.querySelector<HTMLSelectElement>("[data-test='editor:map']")!.value = mapIds().includes(map.id) ? map.id : "new";
  };
  fill();
  const chooseTool = (t: Tool) => {
    tool = t;
    bar.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => b.classList.toggle("chosen", b.dataset.tool === t));
  };
  chooseTool("terrain");
  bar.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.addEventListener("click", () => chooseTool(b.dataset.tool as Tool)));
  const on = (name: string, change: (value: string) => void) =>
    field(name).addEventListener("change", (e) => {
      change((e.target as HTMLInputElement).value);
      dirty = true;
    });
  on("id", (v) => (map.id = v.trim()));
  on("name", (v) => (map.name = v));
  on("kind", (v) => (map.kind = v as MapKind));
  on("region", (v) => (map.region = (v || undefined) as Region | undefined));
  on("floor", (v) => (map.floor = Number(v) || undefined));
  bar.querySelector<HTMLSelectElement>("[data-test='editor:map']")!.addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    void (id === "new" ? Promise.resolve(blank(12)) : loadMap(id).then((m) => m.data)).then((data) => {
      map = working(data);
      fill();
      dirty = true;
    });
  });
  bar.querySelector("[data-test='editor:save']")!.addEventListener("click", () => {
    const blob = new Blob([formatMap(toData(map))], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${map.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  const problems = bar.querySelector<HTMLElement>(".problems")!;
  const lint = () => {
    const found = validateMap(toData(map), new Set([...mapIds(), map.id]));
    problems.textContent = found.length === 0 ? "No problems." : found.slice(0, 30).join("\n");
    problems.classList.toggle("clean", found.length === 0);
  };
  lint();

  // Editing.
  const atHex = (list: readonly { q: number; r: number }[], h: Hex) => list.findIndex((x) => x.q === h.q && x.r === h.r);
  const freshId = (prefix: string, list: readonly { id: string }[]) => {
    for (let i = 1; ; i++) if (!list.some((x) => x.id === `${prefix}${i}`)) return `${prefix}${i}`;
  };
  const apply = (h: Hex) => {
    const k = key(h);
    const tile = map.tiles.get(k);
    if (!tile) return;
    const brush = Number(field("brush").value);
    const area = PAINTS.has(tool) ? spiral(h, brush).filter((b) => map.tiles.has(key(b))) : [h];
    const each = (change: (t: MutableTile) => void) => area.forEach((b) => change(map.tiles.get(key(b))!));
    switch (tool) {
      case "terrain":
        each((t) => {
          t[3] = field<HTMLSelectElement>("terrain").value;
          if (t[3] === "water" || t[3] === "deep-water" || t[3] === "lava") t[4] = 1;
        });
        break;
      case "raise":
      case "lower":
        each((t) => (t[2] = Math.round((t[2] + (tool === "raise" ? STEP : -STEP)) * 100) / 100));
        break;
      case "flatten": {
        const level = tile[2];
        each((t) => (t[2] = level));
        break;
      }
      case "block":
      case "open":
        each((t) => (t[4] = tool === "block" ? 1 : 0));
        break;
      case "prop":
        map.props.set(k, field<HTMLSelectElement>("prop").value);
        tile[4] = 1;
        break;
      case "spawn": {
        const mobs = field("mobs").value.split(",").map((m) => m.trim()).filter(Boolean);
        if (mobs.length === 0 || atHex(map.spawns, h) >= 0) return;
        map.spawns.push({ id: freshId("s", map.spawns), q: h.q, r: h.r, mobs, radius: 4, respawnSeconds: 600 });
        tile[4] = 0;
        break;
      }
      case "exit":
        if (atHex(map.exits, h) >= 0) return;
        map.exits.push({ q: h.q, r: h.r, to: field("to").value.trim() || "world" });
        tile[4] = 0;
        map.props.delete(k);
        break;
      case "npc": {
        if (atHex(map.npcs, h) >= 0) return;
        const kind = field<HTMLSelectElement>("npc").value;
        const vendor = field("vendor").value.trim();
        const name = field("npcName").value.trim();
        map.npcs.push({
          id: kind === "vendor" && vendor ? vendor : freshId(`${kind}-`, map.npcs),
          q: h.q,
          r: h.r,
          kind,
          ...(kind === "vendor" ? { vendor } : {}),
          ...(name ? { name } : {}),
        });
        tile[4] = 1;
        break;
      }
      case "chest":
        if (atHex(map.chests, h) >= 0) return;
        map.chests.push({ id: freshId("c", map.chests), q: h.q, r: h.r, gold: [50, 200], respawnSeconds: 86400 });
        tile[4] = 1;
        break;
      case "inn":
        map.inn = h;
        map.innElsewhere = undefined;
        tile[4] = 0;
        break;
      case "erase":
        map.props.delete(k);
        for (const list of [map.exits, map.spawns, map.chests, map.npcs] as { q: number; r: number }[][]) {
          const i = atHex(list, h);
          if (i >= 0) list.splice(i, 1);
        }
        if (map.inn && map.inn.q === h.q && map.inn.r === h.r) map.inn = undefined;
        tile[4] = 0;
        break;
    }
    dirty = true;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    painting = true;
    const h = world.pick(pixels.rayAt(e.clientX, e.clientY));
    lastPainted = h ? key(h) : "";
    if (h) apply(h);
  });
  window.addEventListener("pointerup", () => (painting = false));
  canvas.addEventListener("pointermove", (e) => {
    const h = world.pick(pixels.rayAt(e.clientX, e.clientY));
    world.mark(h);
    if (painting && h && key(h) !== lastPainted && (PAINTS.has(tool) || tool === "prop" || tool === "erase")) {
      lastPainted = key(h);
      apply(h);
    }
  });
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName !== "INPUT") held.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
  canvas.addEventListener("wheel", (e) => {
    pixels.camera.zoom = Math.min(3, Math.max(0.5, pixels.camera.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    pixels.camera.updateProjectionMatrix();
  });
  window.addEventListener("resize", () => pixels.resize());

  // The editor's test hooks.
  (globalThis as Record<string, unknown>).realmEditor = {
    tile: (q: number, r: number) => map.tiles.get(`${q},${r}`) ?? null,
    screenOfHex: (q: number, r: number) => pixels.toScreen(world.surface({ q, r })),
    get data() {
      return toData(map);
    },
    get problems() {
      return validateMap(toData(map), new Set([...mapIds(), map.id]));
    },
  };

  // Panning moves the focus along the screen's axes.
  const clock = new THREE.Clock();
  const right = new THREE.Vector3(1, 0, -1).normalize();
  const down = new THREE.Vector3(1, 0, 1).normalize();
  const frame = () => {
    const seconds = Math.min(clock.getDelta(), 0.1);
    const speed = (14 * seconds) / pixels.camera.zoom;
    if (held.has("a") || held.has("arrowleft")) focus.addScaledVector(right, -speed);
    if (held.has("d") || held.has("arrowright")) focus.addScaledVector(right, speed);
    if (held.has("w") || held.has("arrowup")) focus.addScaledVector(down, -speed);
    if (held.has("s") || held.has("arrowdown")) focus.addScaledVector(down, speed);
    if (dirty) {
      dirty = false;
      const old = world;
      world = new World(new GameMap(toData(map)));
      old.dispose();
      lint();
    }
    world.update(seconds);
    pixels.lookAt(focus);
    pixels.render(world.scene);
    requestAnimationFrame(frame);
  };
  frame();
}
