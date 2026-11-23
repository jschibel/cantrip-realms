import { ATTACH_POINTS, type AttachPoint, MOTIONS, type VoxModel, type VoxPart } from "./format";

// Every voxel model of realms/content/models, read at build time (they are small): bodies, gear pieces and mobs, by
// id. scripts/models.ts writes them; they may be tuned by hand after, so each is checked on load by the tests.

const files = import.meta.glob<VoxModel>("../../../content/models/*.vox.json", { eager: true, import: "default" });

const byId = new Map<string, VoxModel>();
for (const model of Object.values(files)) {
  byId.set(model.id, model);
}

/** The model with this id, or undefined when there is none. */
export function getModel(id: string): VoxModel | undefined {
  return byId.get(id);
}

/** Every model, with the file name it came from. */
export function allModels(): { file: string; model: VoxModel }[] {
  return Object.entries(files).map(([path, model]) => ({ file: path.split("/").pop()!, model }));
}

const COLOR = /^(#[0-9a-fA-F]{6}|\$\d+)$/;

/** What is wrong with a model, in words; empty when nothing is. */
export function validateModel(model: VoxModel): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${model.id}: ${text}`);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(model.id)) say("the id is not kebab-case");
  if (!["body", "mob", "gear"].includes(model.kind)) say(`unknown kind "${model.kind}"`);
  if (!(model.voxel > 0)) say("the voxel size is not positive");
  if (model.palette.length === 0 || model.palette.length > 36) say("the palette must have 1-36 colors");
  model.palette.forEach((c, i) => {
    if (!COLOR.test(c)) say(`palette ${i} "${c}" is neither #rrggbb nor $n`);
  });
  if (model.parts.length === 0) say("it has no parts");

  const names = new Set<string>();
  for (const part of model.parts) {
    if (names.has(part.name)) say(`two parts are called "${part.name}"`);
    names.add(part.name);
  }

  for (const part of model.parts) {
    const where = `part "${part.name}"`;
    checkLayers(part, model.palette.length, (text) => say(`${where}: ${text}`));
    if (part.motion !== undefined && !(MOTIONS as readonly string[]).includes(part.motion)) say(`${where}: unknown motion "${part.motion}"`);
    if (part.parent !== undefined && !names.has(part.parent)) say(`${where}: its parent "${part.parent}" is not a part`);
    if (part.mount !== undefined && !(ATTACH_POINTS as readonly string[]).includes(part.mount)) say(`${where}: unknown mount "${part.mount}"`);
    if (model.kind === "gear" && part.mount === undefined && part.parent === undefined) say(`${where}: a gear piece needs a mount`);
    if (model.kind !== "gear" && part.mount !== undefined) say(`${where}: only gear is mounted`);
  }

  // Parents form trees: no part is its own ancestor.
  const parentOf = new Map(model.parts.map((p) => [p.name, p.parent]));
  for (const part of model.parts) {
    const seen = new Set<string>();
    for (let at: string | undefined = part.name; at !== undefined; at = parentOf.get(at)) {
      if (seen.has(at)) {
        say(`part "${part.name}": its parents go round in a circle`);
        break;
      }
      seen.add(at);
    }
  }

  for (const [point, attach] of Object.entries(model.attach ?? {})) {
    if (!(ATTACH_POINTS as readonly string[]).includes(point)) say(`unknown attachment point "${point}"`);
    if (attach && !names.has(attach.part)) say(`attachment point "${point}" is on "${attach.part}", which is not a part`);
  }
  if (model.kind === "body") {
    for (const point of ATTACH_POINTS) {
      if (!model.attach?.[point]) say(`a body needs the attachment point "${point}"`);
    }
  }
  return problems;
}

function checkLayers(part: VoxPart, colors: number, say: (text: string) => void): void {
  const [w, h, d] = part.size;
  if (part.layers.length !== h) {
    say(`${part.layers.length} layers for a height of ${h}`);
  }
  part.layers.forEach((layer, y) => {
    if (layer.length !== d) say(`layer ${y} has ${layer.length} rows for a depth of ${d}`);
    layer.forEach((row, z) => {
      if (row.length !== w) say(`layer ${y} row ${z} is ${row.length} long for a width of ${w}`);
      for (const char of row) {
        if (char === ".") continue;
        const index = parseInt(char, 36);
        if (Number.isNaN(index) || index >= colors) say(`layer ${y} row ${z}: "${char}" is not a palette index`);
      }
    });
  });
}

/** The attachment points a gear model's pieces hang on. */
export function mountsOf(model: VoxModel): AttachPoint[] {
  return model.parts.flatMap((p) => (p.mount ? [p.mount] : []));
}
