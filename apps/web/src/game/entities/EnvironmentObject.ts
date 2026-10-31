import * as Phaser from "phaser";
import { pixelFont } from "../fonts";
import type { Environment, NetworkState, WorldEvent } from "@proj/contract";
import { tileToPixel } from "../layout";

// Room-wide effects driven by world state: lighting by time of day, power
// outages, network outages and markers for active world events.

export class Ambience {
  private night: Phaser.GameObjects.Rectangle;
  private warm: Phaser.GameObjects.Rectangle;
  private blackout: Phaser.GameObjects.Rectangle;
  private glitch: Phaser.GameObjects.Rectangle;
  private flicker?: Phaser.Time.TimerEvent;
  private glitchTween?: Phaser.Tweens.Tween;
  private power: Environment["power"] = "normal";

  constructor(
    private scene: Phaser.Scene,
    w: number,
    h: number,
  ) {
    const mk = (color: number, depth: number) => scene.add.rectangle(-w, -h, w * 3, h * 3, color, 1).setOrigin(0).setAlpha(0).setDepth(depth);
    this.warm = mk(0xffd9a0, 30_000).setBlendMode(Phaser.BlendModes.ADD);
    this.night = mk(0x0a0620, 30_001);
    this.blackout = mk(0x03020a, 30_002);
    this.glitch = mk(0x3fd2ff, 30_003).setBlendMode(Phaser.BlendModes.ADD);
  }

  setEnvironment(env: Environment) {
    // 0 at midday, 1 at 3am
    const hour = env.timeOfDay / 60;
    const dark = (Math.cos(((hour - 3) / 24) * Math.PI * 2) + 1) / 2;
    this.scene.tweens.add({ targets: this.night, alpha: 0.32 * dark, duration: 800 });
    this.scene.tweens.add({ targets: this.warm, alpha: 0.07 * (1 - dark), duration: 800 });

    if (env.power !== this.power) {
      this.power = env.power;
      this.flicker?.remove();
      if (env.power === "outage") {
        this.blackout.setAlpha(0.62);
        this.flicker = this.scene.time.addEvent({
          delay: 140,
          loop: true,
          callback: () => this.blackout.setAlpha(Math.random() < 0.08 ? 0.35 : 0.62),
        });
      } else if (env.power === "brownout") {
        this.blackout.setAlpha(0.3);
        this.flicker = this.scene.time.addEvent({ delay: 220, loop: true, callback: () => this.blackout.setAlpha(0.22 + Math.random() * 0.16) });
      } else {
        this.scene.tweens.add({ targets: this.blackout, alpha: 0, duration: 400 });
        // lights snapping back on
        this.scene.cameras.main.flash(250, 255, 240, 210);
      }
    }
  }

  setNetwork(net: NetworkState) {
    this.glitchTween?.stop();
    if (!net.online) {
      this.glitchTween = this.scene.tweens.add({ targets: this.glitch, alpha: { from: 0, to: 0.06 }, duration: 90, yoyo: true, repeat: -1, repeatDelay: 900 });
    } else this.glitch.setAlpha(0);
  }
}

/** A small marker for an active world event in the drawn room. */
export class WorldMarker {
  readonly obj: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, ev: WorldEvent) {
    const room = ev.room ?? "kitchen";
    const spot =
      ev.kind === "spill" ? { room, x: 4, y: 6 } : ev.kind === "grocery_delivery" ? { room, x: 6, y: 3 } : ev.kind === "human_arrives" ? { room, x: 7, y: 6 } : { room, x: 2, y: 5 };
    const p = tileToPixel(spot) ?? { x: 700, y: 700 };
    const g = scene.add.graphics();
    const parts: Phaser.GameObjects.GameObject[] = [g];
    if (ev.kind === "spill") {
      g.fillStyle(0x8fd8ff, 0.55).fillEllipse(0, 0, 120, 44).fillEllipse(48, 10, 54, 22);
      g.fillStyle(0xffffff, 0.5).fillEllipse(-20, -6, 30, 8);
    } else if (ev.kind === "grocery_delivery") {
      g.fillStyle(0xb98a52, 1).fillRect(-26, -50, 52, 50);
      g.fillStyle(0x8a6234, 1).fillRect(-26, -50, 52, 8);
      g.fillStyle(0x6ecf5b, 1).fillCircle(-10, -54, 9).fillCircle(8, -58, 7);
      g.fillStyle(0xff8a3d, 1).fillCircle(14, -50, 7);
    } else if (ev.kind === "human_arrives") {
      // a looming human shadow at the doorway
      g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 90, 30);
      g.fillStyle(0x120d22, 0.85).fillRoundedRect(-22, -170, 44, 150, 18).fillCircle(0, -186, 20);
    } else {
      const label = scene.add
        .text(0, -30, ev.kind === "firmware_update" ? "UPDATING…" : ev.kind.replace(/_/g, " ").toUpperCase(), {
          fontFamily: pixelFont(),
          fontSize: "16px",
          color: "#bff1ff",
          backgroundColor: "#10202acc",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1);
      parts.push(label);
      if (ev.kind !== "power_outage" && ev.kind !== "network_outage" && ev.kind !== "firmware_update") g.fillStyle(0x3fd2ff, 0.3).fillEllipse(0, 0, 70, 24);
      else g.setVisible(false);
      if (ev.kind === "power_outage" || ev.kind === "network_outage" || ev.kind === "firmware_update") label.setVisible(false);
    }
    this.obj = scene.add.container(p.x, p.y, parts).setDepth(p.y - 1).setAlpha(0);
    scene.tweens.add({ targets: this.obj, alpha: 1, duration: 400 });
  }

  destroy(scene: Phaser.Scene) {
    scene.tweens.add({ targets: this.obj, alpha: 0, duration: 400, onComplete: () => this.obj.destroy() });
  }
}
