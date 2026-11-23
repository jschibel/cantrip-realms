# Cantrip Realms - converting the world to the slice's look

The owner chose the art slice as the game's look and asked for the whole world to be built in it. That conversion is
done: the slice's code is the game's, the game page (`realms/web/index.html`) runs it over the generated Domains on
square tiles, and `slice.html`, the hex world, the hex renderer, its voxel models and the hex dungeon generator are gone.

What this file held is now in:

- realms/docs/tech.md, B5 - the look, the camera, movement, the module layout and interfaces, the renderer at world
  scale, adding to the art, the art library's ids, rooms and dungeons, the characters, and Dominaria as generated;
- realms/docs/interfaces.md - the world data, version 2 (world.json, chunks, interiors, dungeons) and places on squares.

The work went in three phases: a foundation (the slice moved into the game's modules, the version-2 format and loader),
six agents in parallel (renderer, world, art library, interiors and dungeons, characters, server), and integration.
