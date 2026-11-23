// The room recipes, by interior kind (registry.ts). Importing this module defines them all, with the rooms' floors and
// the furniture's palettes (styles.ts).
import "./styles";
import "./hall";
import "./tower";
import "./crypt";

export { ROOMS } from "./registry";
export { exitGap, roomShell, type ShellSpec } from "./shell";
export { ROOM_STYLES, type RoomStyle, finishOf, styleOf } from "./styles";
