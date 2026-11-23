// The renderer's API: what the game calls to draw the world (realms/docs/conversion.md, "Module interfaces").
//
//   CameraRig        the view: a PixelRenderer on the canvas, the three headings, the stepped zoom, the turn and zoom
//                    easing, the focus held to a place's bounds (camera.ts)
//   PixelRenderer    draws a THREE.Scene small and shows it in whole pixels: texel snapping, the edge pass (outlines
//                    and highlights), the iris over a doorway; screen <-> world (renderer.ts)
//   Place            one place as drawn: ground, merged scenery, cut-aways, flames, scrolling water, standing grass,
//                    lights; `addFigure` / `removeFigure`; `update(time, yaw, toward)` and `follow(player)` each frame
//                    (place.ts)
//   assembleWorld    world data (WorldData + loaded ChunkData) -> a Place and its doors, every id through the art
//                    registries; assembleInterior: an InteriorData -> a Place, its doorway and bounds (assemble.ts)
//   Actor            a figure walking a grid: paths, facing, the walk cycle, townsfolk's wandering (actor.ts)
//   View, THREE_QUARTER, blendViews   the camera's view and easing between views (view.ts)
//   lights           sunlight, LightSpec -> three.js lights, flicker (lights.ts)
//   buildGround, grassField, blobShadow, lit, glow, bandShader, textureOf   the shaders and materials underneath

export { Actor, type Behaviour, behaviourOf, centre } from "./actor";
export { type AssembledRoom, type AssembledWorld, type DoorSpot, INDOOR_BACKGROUND, OUTDOOR_BACKGROUND, assembleInterior, assembleWorld } from "./assemble";
export { CameraRig, type Framing, HEADING_NAMES, type Heading, NAME_OF, ZOOM_EASE, type Zoom } from "./camera";
export { type GrassField, grassField } from "./grass";
export { type GroundSurface, buildGround } from "./ground";
export { type LitOptions, TEXELS, bandShader, glow, lit, textureOf } from "./lighting";
export { type Flicker, addLight, stepFlicker, sunlight } from "./lights";
export { Place } from "./place";
export { PixelRenderer } from "./renderer";
export { blobShadow } from "./shadow";
export { THREE_QUARTER, type View, blendViews } from "./view";
