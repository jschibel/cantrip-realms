import type { InteriorData } from "../../world/format";
import { Registry } from "../recipe";

// The rooms registry, by interior kind: each kind is one entry, laying out a room's shell - its walls, the frame of
// its way out, its own light - from an `InteriorData` and a palette. What furnishes the room is the interior's `props`
// (art/props), and the lights its fires and windows give are its `lights`: the room's file holds what the generator
// chose, and the recipe draws the room round it. A recipe returns `doorway` (where the iris closes going out) and
// `bounds` (the ground the camera keeps to); its side walls are `cutaways` toward the camera.

export const ROOMS = new Registry<InteriorData>("room kind");
