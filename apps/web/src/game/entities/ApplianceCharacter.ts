import * as Phaser from "phaser";
import { bodyFont, pixelFont } from "../fonts";
import type { AgentId } from "@proj/contract";
import { moodForState } from "../presentation";
import type { BubbleKind, Mood, PresentationState, SpriteInfo } from "../types";
import { Eyes } from "./Eyes";

// One appliance on screen. The art is placed at its native pixel position;
// the "body" container pivots at the feet so squash/stretch looks grounded.

const BUBBLE_STYLE: Record<BubbleKind, { fill: number; stroke: number; text: string; label?: string }> = {
  speech: { fill: 0xf7f1ff, stroke: 0x2a2440, text: "#1d1830" },
  proposal: { fill: 0xfff3c4, stroke: 0x8a6a00, text: "#3b2c00", label: "PROPOSAL" },
  agreement: { fill: 0xd9ffe6, stroke: 0x1e7a45, text: "#0e3a21", label: "DEAL" },
  conflict: { fill: 0xffd9d6, stroke: 0xa3261c, text: "#4a0d08", label: "!" },
  thought: { fill: 0x1b1730, stroke: 0x8c7cff, text: "#d9d2ff" },
  system: { fill: 0x10202a, stroke: 0x3fd2ff, text: "#bff1ff", label: "BROADCAST" },
};

const ACTION_PARTICLES: Record<AgentId, { tint: number[]; speedY: [number, number]; gravityY: number; spread: number; lifespan: number }> = {
  toast: { tint: [0xff7a2f, 0xffc04d, 0xff3b1f], speedY: [-70, -30], gravityY: -10, spread: 30, lifespan: 900 },
  mixer: { tint: [0xb8f0ff, 0xffffff, 0x9be37a], speedY: [-60, 20], gravityY: 60, spread: 70, lifespan: 700 },
  espresso: { tint: [0xffffff, 0xe8e2ff, 0xcfc7e8], speedY: [-60, -25], gravityY: -20, spread: 18, lifespan: 1400 },
  robo: { tint: [0x5ff2ff, 0xffffff, 0xc7b8a0], speedY: [-20, 0], gravityY: 20, spread: 60, lifespan: 600 },
  fridge: { tint: [0xd8f4ff, 0xffffff, 0x9fdcff], speedY: [10, 40], gravityY: 30, spread: 60, lifespan: 1500 },
  vision: { tint: [0xffffff], speedY: [-30, 0], gravityY: 0, spread: 40, lifespan: 800 },
};

/** Speech bubbles sit above all world art and lighting overlays, so they stay readable in a blackout. */
const BUBBLE_DEPTH = 35_000;

export class ApplianceCharacter {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Image;
  private eyes: Eyes;
  private ring: Phaser.GameObjects.Ellipse;
  private tag: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Container;
  private zzz?: Phaser.GameObjects.Text;
  private emitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private loop?: Phaser.Tweens.Tween;
  private holdTimer?: Phaser.Time.TimerEvent;
  private moodTimer?: Phaser.Time.TimerEvent;

  /** Feet point in sprite pixels (bottom center of the opaque art). */
  readonly feet: { x: number; y: number };
  /** Where the sprite's top-left sits on its home tile, in world pixels. */
  readonly home: { x: number; y: number };

  baseState: PresentationState = "idle";
  private shownState: PresentationState | null = null;
  selected = false;
  hovered = false;
  moving = false;
  /** Fractional tile while walking; null when standing on a tile. */
  tileNow: { x: number; y: number } | null = null;
  private walkTween?: Phaser.Tweens.Tween;

  constructor(
    private scene: Phaser.Scene,
    readonly id: AgentId,
    readonly name: string,
    info: SpriteInfo,
    textureKey: string,
  ) {
    this.feet = findFeet(scene, textureKey, info);
    this.home = { x: info.x, y: info.y };

    this.root = scene.add.container(info.x, info.y);
    this.ring = scene.add.ellipse(this.feet.x, this.feet.y - 2, info.w * 0.62, info.w * 0.22).setStrokeStyle(3, 0x7cf7ff, 0.95).setFillStyle(0x7cf7ff, 0.12).setVisible(false);
    this.body = scene.add.container(this.feet.x, this.feet.y);
    this.sprite = scene.add.image(-this.feet.x, -this.feet.y, textureKey).setOrigin(0, 0);
    this.eyes = new Eyes(scene, info.visors);
    this.eyes.g.setPosition(-this.feet.x, -this.feet.y);
    this.body.add([this.sprite, this.eyes.g]);

    const top = topOfArt(scene, textureKey, info);
    this.tag = scene.add
      .text(this.feet.x, top - 10, name, { fontFamily: pixelFont(), fontSize: "18px", color: "#ffffff", backgroundColor: "#1a1530cc", padding: { x: 6, y: 2 } })
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.root.add([this.ring, this.body, this.tag]);
    this.root.setDepth(info.y + this.feet.y);

    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 40 });
    this.setState("idle");
  }

  get input() {
    return this.sprite;
  }

  /** World pixel of the feet. */
  get feetWorld() {
    return { x: this.root.x + this.feet.x, y: this.root.y + this.feet.y };
  }

  get topWorldY() {
    return this.root.y + this.tag.y;
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.ring.setVisible(on);
    this.tag.setVisible(on || this.hovered);
    this.scene.tweens.killTweensOf(this.ring);
    if (on) this.scene.tweens.add({ targets: this.ring, scaleX: 1.08, scaleY: 1.08, alpha: 0.7, yoyo: true, repeat: -1, duration: 700 });
  }

  setHovered(on: boolean) {
    this.hovered = on;
    this.tag.setVisible(on || this.selected);
    this.sprite.setTint(on ? 0xfff6e8 : 0xffffff);
    if (this.baseState === "offline") this.sprite.setTint(0x6a6680);
  }

  setMood(mood: Mood, holdMs?: number) {
    this.eyes.setMood(mood);
    this.moodTimer?.remove();
    if (holdMs) this.moodTimer = this.scene.time.delayedCall(holdMs, () => this.eyes.setMood(moodForState(this.currentState())));
  }

  look(dir: number, holdMs = 2000) {
    this.eyes.setLook(dir);
    this.scene.time.delayedCall(holdMs, () => this.eyes.setLook(0));
  }

  private currentState() {
    return this.shownState ?? this.baseState;
  }

  /** Persistent state from the backend status. */
  setBaseState(state: PresentationState) {
    this.baseState = state;
    if (!this.holdTimer) this.show(state);
  }

  /** Temporary state, e.g. celebrating for a few seconds, then back to base. */
  setState(state: PresentationState, holdMs?: number) {
    this.holdTimer?.remove();
    this.holdTimer = undefined;
    this.show(state);
    if (holdMs) {
      this.holdTimer = this.scene.time.delayedCall(holdMs, () => {
        this.holdTimer = undefined;
        this.show(this.baseState);
      });
    }
  }

  private show(state: PresentationState) {
    if (this.moving && state !== "moving") {
      this.shownState = state;
      return;
    }
    this.shownState = state;
    this.loop?.stop();
    this.scene.tweens.killTweensOf(this.body);
    this.body.setScale(1).setAngle(0).setPosition(this.feet.x, this.feet.y);
    this.stopParticles();
    this.zzz?.destroy();
    this.zzz = undefined;
    this.eyes.setDim(state === "offline");
    this.sprite.setTint(state === "offline" ? 0x6a6680 : 0xffffff);
    this.eyes.setMood(moodForState(state));

    const t = this.scene.tweens;
    const big = this.id === "fridge";
    switch (state) {
      case "idle":
        this.loop = t.add({ targets: this.body, scaleY: big ? 1.006 : 1.018, scaleX: big ? 0.998 : 0.992, duration: 1500 + Math.random() * 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        break;
      case "thinking":
        this.loop = t.add({ targets: this.body, angle: big ? 0.6 : 2.2, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        break;
      case "communicating":
        this.loop = t.add({ targets: this.body, y: this.feet.y - (big ? 3 : 7), scaleY: 1.03, duration: 160, yoyo: true, repeat: -1, repeatDelay: 260, ease: "Quad.easeOut" });
        break;
      case "negotiating":
        this.loop = t.add({ targets: this.body, angle: big ? 1 : 4, scaleY: 1.02, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        break;
      case "performing_action":
        this.loop = t.add({ targets: this.body, x: this.feet.x + (big ? 1 : 2), duration: 45, yoyo: true, repeat: -1 });
        this.startParticles();
        break;
      case "celebrating":
        this.loop = t.chain({
          targets: this.body,
          loop: -1,
          tweens: [
            { scaleY: 0.86, scaleX: 1.1, duration: 110, ease: "Quad.easeOut" },
            { y: this.feet.y - (big ? 10 : 26), scaleY: 1.12, scaleX: 0.92, duration: 220, ease: "Quad.easeOut" },
            { y: this.feet.y, scaleY: 1, scaleX: 1, duration: 200, ease: "Bounce.easeOut" },
          ],
        }) as unknown as Phaser.Tweens.Tween;
        this.confetti();
        break;
      case "concerned":
        this.loop = t.add({ targets: this.body, x: this.feet.x + (big ? 2 : 4), duration: 60, yoyo: true, repeat: 7, onComplete: () => this.body.setX(this.feet.x) });
        this.popIcon("!", "#ff5a4f");
        break;
      case "offline":
        this.zzz = this.scene.add.text(this.feet.x + 20, this.tag.y + 6, "z Z", { fontFamily: pixelFont(), fontSize: "20px", color: "#a9b4ff" }).setOrigin(0.5, 1);
        this.root.add(this.zzz);
        t.add({ targets: this.zzz, y: this.tag.y - 14, alpha: 0.2, duration: 1600, repeat: -1 });
        break;
      case "moving":
        break;
    }
  }

  say(kind: BubbleKind, text: string, ms = 4200) {
    this.bubble?.destroy();
    const style = BUBBLE_STYLE[kind];
    const pad = 10;
    const label = style.label ? `${style.label}  ` : "";
    const txt = this.scene.add.text(0, 0, `${label}${text}`, {
      fontFamily: kind === "thought" ? pixelFont() : bodyFont(),
      fontSize: "17px",
      color: style.text,
      wordWrap: { width: 260 },
      lineSpacing: 2,
    });
    const w = Math.min(280, txt.width) + pad * 2, h = txt.height + pad * 2;
    txt.setPosition(-w / 2 + pad, -h + pad - 14);
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2 + 3, -h - 14 + 4, w, h, 10);
    g.fillStyle(style.fill, kind === "thought" ? 0.94 : 1).lineStyle(3, style.stroke, 1);
    g.fillRoundedRect(-w / 2, -h - 14, w, h, 10).strokeRoundedRect(-w / 2, -h - 14, w, h, 10);
    if (kind === "thought") {
      g.fillCircle(-6, -8, 6).strokeCircle(-6, -8, 6);
      g.fillCircle(-14, 2, 3.5).strokeCircle(-14, 2, 3.5);
    } else {
      g.fillTriangle(-9, -16, 9, -16, -2, 0);
      g.lineStyle(3, style.stroke, 1).lineBetween(-9, -15, -2, 0).lineBetween(9, -15, -2, 0);
    }
    const c = this.scene.add.container(0, 0, [g, txt]).setDepth(BUBBLE_DEPTH);
    c.setScale(0.6).setAlpha(0);
    this.bubble = c;
    this.scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 180, ease: "Back.easeOut" });
    this.scene.tweens.add({
      targets: c,
      alpha: 0,
      delay: ms,
      duration: 300,
      onComplete: () => {
        c.destroy();
        if (this.bubble === c) this.bubble = undefined;
      },
    });
    this.sync();
  }

  /** Keeps top-layer overlays (bubble) attached to the character. Call every frame. */
  sync() {
    this.bubble?.setPosition(this.root.x + this.feet.x, this.root.y + this.tag.y - 2).setVisible(this.root.visible);
  }

  /**
   * Walks (or rolls) along waypoints. `points` are sprite top-left positions,
   * `tiles` the matching tile coordinates, so the scene can depth-sort by the
   * tile the character is crossing (`tileNow`) rather than by pixels.
   */
  walk(points: { x: number; y: number }[], tiles: { x: number; y: number }[], onDone?: () => void) {
    const t = this.scene.tweens;
    t.killTweensOf(this.root);
    this.walkTween?.stop();
    this.loop?.stop();
    this.body.setScale(1).setAngle(0).setPosition(this.feet.x, this.feet.y);
    const pts = [{ x: this.root.x, y: this.root.y }, ...points.slice(1)];
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1) {
      this.root.setPosition(pts.at(-1)!.x, pts.at(-1)!.y);
      this.tileNow = null;
      onDone?.();
      return;
    }
    this.moving = true;
    const wheels = this.id === "robo";
    if (!wheels) this.loop = t.add({ targets: this.body, y: this.feet.y - 8, duration: 140, yoyo: true, repeat: -1, ease: "Quad.easeOut" });
    const cursor = { d: 0 };
    this.walkTween = t.add({
      targets: cursor,
      d: total,
      duration: Math.max(500, total * (wheels ? 6 : 9)),
      ease: "Sine.easeInOut",
      onUpdate: () => {
        let d = cursor.d, i = 0;
        while (i < lens.length - 1 && d > lens[i]!) d -= lens[i++]!;
        const k = lens[i]! ? Math.min(1, d / lens[i]!) : 1;
        const a = pts[i]!, b = pts[i + 1]!, ta = tiles[i]!, tb = tiles[i + 1]!;
        this.root.setPosition(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        this.tileNow = { x: ta.x + (tb.x - ta.x) * k, y: ta.y + (tb.y - ta.y) * k };
        if (wheels) this.body.setAngle(b.x >= a.x ? 2 : -2);
      },
      onComplete: () => {
        this.moving = false;
        this.tileNow = null;
        this.walkTween = undefined;
        this.show(this.shownState === "moving" || !this.shownState ? this.baseState : this.shownState);
        onDone?.();
      },
    });
  }

  setVisible(on: boolean) {
    this.root.setVisible(on);
  }

  private popIcon(text: string, color: string) {
    const icon = this.scene.add.text(this.feet.x + 26, this.tag.y + 8, text, { fontFamily: pixelFont(), fontSize: "34px", color, stroke: "#1a1020", strokeThickness: 5 }).setOrigin(0.5, 1).setScale(0.4);
    this.root.add(icon);
    this.scene.tweens.add({ targets: icon, scale: 1, duration: 200, ease: "Back.easeOut" });
    this.scene.tweens.add({ targets: icon, alpha: 0, y: icon.y - 16, delay: 1200, duration: 400, onComplete: () => icon.destroy() });
  }

  private startParticles() {
    const p = ACTION_PARTICLES[this.id];
    this.emitter = this.scene.add.particles(this.root.x + this.feet.x, this.topWorldY + 30, "px", {
      speedX: { min: -p.spread / 2, max: p.spread / 2 },
      speedY: { min: p.speedY[0], max: p.speedY[1] },
      gravityY: p.gravityY,
      lifespan: p.lifespan,
      scale: { start: 1.6, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      tint: p.tint,
      frequency: 70,
      quantity: 1,
    });
    this.emitter.setDepth(this.root.depth + 1);
  }

  private stopParticles() {
    if (!this.emitter) return;
    const e = this.emitter;
    e.stop();
    this.scene.time.delayedCall(1600, () => e.destroy());
    this.emitter = undefined;
  }

  private confetti() {
    const e = this.scene.add.particles(this.root.x + this.feet.x, this.topWorldY + 10, "px", {
      speedX: { min: -140, max: 140 },
      speedY: { min: -260, max: -120 },
      gravityY: 420,
      lifespan: 1300,
      scale: { start: 1.8, end: 1 },
      rotate: { min: 0, max: 360 },
      tint: [0xff5fa2, 0x7cf7ff, 0xffd84d, 0x9be37a, 0xb48cff],
      emitting: false,
    });
    e.setDepth(20_000);
    e.explode(40);
    this.scene.time.delayedCall(1600, () => e.destroy());
  }

  destroy() {
    this.bubble?.destroy();
    this.eyes.destroy();
    this.emitter?.destroy();
    this.root.destroy();
  }
}

/** Bottom-center of the opaque pixels, ignoring the faint contact shadow. */
function findFeet(scene: Phaser.Scene, key: string, info: SpriteInfo) {
  const data = alphaData(scene, key, info);
  if (!data) return { x: info.w / 2, y: info.h * 0.9 };
  let bottom = 0, minX = info.w, maxX = 0;
  for (let y = 0; y < info.h; y++)
    for (let x = 0; x < info.w; x++)
      if (data[(y * info.w + x) * 4 + 3]! > 200) {
        if (y > bottom) bottom = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
  return { x: (minX + maxX) / 2, y: bottom };
}

function topOfArt(scene: Phaser.Scene, key: string, info: SpriteInfo) {
  const data = alphaData(scene, key, info);
  if (!data) return 0;
  for (let y = 0; y < info.h; y++) for (let x = 0; x < info.w; x++) if (data[(y * info.w + x) * 4 + 3]! > 200) return y;
  return 0;
}

const alphaCache = new Map<string, Uint8ClampedArray | null>();
function alphaData(scene: Phaser.Scene, key: string, info: SpriteInfo) {
  if (alphaCache.has(key)) return alphaCache.get(key)!;
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = info.w;
  canvas.height = info.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, info.w, info.h);
  const data = ctx.getImageData(0, 0, info.w, info.h).data;
  alphaCache.set(key, data);
  return data;
}
