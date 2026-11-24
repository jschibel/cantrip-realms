// The renderer's API: what the game calls to draw the world (realms/docs/tech.md B5, "Module interfaces").
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
//
// At world scale (phase 2):
//   Stage            the frame every page runs: camera rig, the place the player is in, walking, doors with the iris,
//                    the world streamed round the view, the sun's shadows fitted to it, the x-ray, the far zoom's detail
//                    level (stage.ts); Spot, Spots, Arrival, StageDoor are what a page gives it
//   StreamedWorld, WorldPlaces, roomSpot, npcActor   a version-2 world and its rooms as spots (spots.ts)
//   ChunkStreamer, buildChunk   chunks read, built a step at a time, dropped; the walk grid as a window (chunks.ts)
//   floorAt, cornersOf, banksOf, floorGeometry, RAMP   terrain from the tiles' heights (terrain.ts)
//   OCCLUDE, aimOccluders, occluderOf, FADE_MIN   the fade of what stands in front of the player (occlude.ts)
//   WalkInput        click and hold-to-walk on the canvas (pointer.ts)
//   runBench         the benchmark's scripted walk (bench.ts; e2e/bench)

export { Actor, type Behaviour, behaviourOf, centre } from "./actor";
export { type AssembledRoom, type AssembledWorld, type DoorSpot, INDOOR_BACKGROUND, OUTDOOR_BACKGROUND, assembleInterior, assembleWorld, openAir } from "./assemble";
export { type BenchLeg, type LegReport, runBench, yieldFrame } from "./bench";
export { type Budget, ChunkStreamer, type StreamReach, buildChunk } from "./chunks";
export { WalkInput } from "./pointer";
export { StreamedWorld, WorldPlaces, npcActor, roomSpot } from "./spots";
export { type Arrival, LEAN, type Spot, type Spots, Stage, type StageDoor, type StageOptions } from "./stage";
export { RAMP, banksOf, cornersOf, floorAt, floorGeometry } from "./terrain";
export { FADE_MIN, OCCLUDE, aimOccluders, occluderOf } from "./occlude";
export { CameraRig, type Framing, HEADING_NAMES, type Heading, NAME_OF, ZOOM_EASE, type Zoom } from "./camera";
export { type GrassField, grassField } from "./grass";
export { type GroundSurface, buildGround } from "./ground";
export { type LitOptions, TEXELS, bandShader, glow, lit, textureOf } from "./lighting";
export { type Flicker, addLight, stepFlicker, sunlight } from "./lights";
export { Place, Section, type SceneryGroup, mergedMeshes, sortScenery } from "./place";
export { PixelRenderer } from "./renderer";
export { blobShadow } from "./shadow";
export { THREE_QUARTER, type View, blendViews } from "./view";
