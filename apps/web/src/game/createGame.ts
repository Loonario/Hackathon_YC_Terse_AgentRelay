import * as Phaser from "phaser";
import type { GameBridge } from "./bridge";
import { KitchenScene } from "./scenes/KitchenScene";

/** Boots Phaser into `parent`. Client-only: import this module dynamically. */
export function createGame(parent: HTMLElement, bridge: GameBridge) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0b0a17",
    pixelArt: true,
    antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    input: { mouse: { preventDefaultWheel: true } },
    banner: false,
  });
  game.scene.add("kitchen", KitchenScene, true, { bridge });
  return game;
}
