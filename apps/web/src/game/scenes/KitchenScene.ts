import * as Phaser from "phaser";
import { HOUSE, isCounter, ROSTER, type Agent, type AgentId, type Position, type SimulationEvent, type WorldState } from "@proj/contract";
import type { GameBridge } from "../bridge";
import { ApplianceCharacter } from "../entities/ApplianceCharacter";
import { Ambience, WorldMarker } from "../entities/EnvironmentObject";
import { ROOM_ART, tileCorners, tileToPixel } from "../layout";
import { findPath } from "../pathfinding";
import { cuesForEvent, stateForStatus } from "../presentation";
import type { CharacterCue, SpriteManifest } from "../types";

const ROOM = "kitchen" as const;
const ART = ROOM_ART[ROOM]!;

/** Depth bands: characters behind foreground furniture < furniture < characters in front. */
const DEPTH = { behind: 0, foreground: 2_000, front: 3_000 };

interface Foreground {
  key: string;
  x: number;
  y: number;
  footprint: { x: number; y: number; w: number; h: number };
}

export class KitchenScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private chars = new Map<AgentId, ApplianceCharacter>();
  private manifest: SpriteManifest = {};
  private ambience!: Ambience;
  private markers = new Map<string, WorldMarker>();
  private grid?: Phaser.GameObjects.Graphics;
  private selected: AgentId | null = null;
  private fitZoom = 1;
  private offs: (() => void)[] = [];
  private foreground: Foreground[] = [];
  /** Last known logical tile per agent (counter tiles can't be read back from pixels). */
  private tiles = new Map<AgentId, Position>();

  constructor() {
    super("kitchen");
  }

  init(data: { bridge: GameBridge }) {
    this.bridge = data.bridge;
  }

  preload() {
    this.load.image("kitchen", ART.art);
    this.load.json("sprites", "/game/sprites.json");
    this.load.json("foreground", "/game/foreground.json");
    this.load.image("island_fg", "/game/island_fg.png");
    for (const id of Object.keys(ROSTER)) this.load.image(`${id}`, `/game/${id}_neutral.png`);
    this.load.on("loaderror", () => {}); // optional agents (vision) have no art yet
  }

  create() {
    this.manifest = this.cache.json.get("sprites") as SpriteManifest;
    this.add.image(0, 0, "kitchen").setOrigin(0).setDepth(-1);
    this.foreground = Object.values((this.cache.json.get("foreground") ?? {}) as Record<string, Foreground>);
    for (const f of this.foreground) this.add.image(f.x, f.y, f.key).setOrigin(0).setDepth(DEPTH.foreground);

    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
    g.generateTexture("px", 4, 4);
    g.destroy();

    this.ambience = new Ambience(this, ART.width, ART.height);
    this.setupCamera();
    this.setupInput();

    const b = this.bridge;
    this.offs.push(
      b.toGame.on("snapshot", (s) => this.applySnapshot(s)),
      b.toGame.on("event", ({ event, state }) => this.applyEvent(event, state)),
      b.toGame.on("select", (id) => this.select(id, false)),
      b.toGame.on("focus", (id) => id && this.focus(id)),
      b.toGame.on("debugGrid", (on) => this.toggleGrid(on)),
      b.toGame.on("zoom", (z) => this.zoom(z)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.offs.forEach((off) => off()));
    if (b.lastSnapshot) this.applySnapshot(b.lastSnapshot);
    if (new URLSearchParams(location.search).has("grid")) this.toggleGrid(true);
    b.fromGame.emit("ready", undefined);
  }

  // ---------------------------------------------------------------------------
  // World state
  // ---------------------------------------------------------------------------

  private applySnapshot(s: WorldState) {
    for (const [id, c] of this.chars)
      if (!s.agents.some((a) => a.id === id)) {
        c.destroy();
        this.chars.delete(id);
      }
    for (const a of s.agents) {
      const c = this.ensureChar(a);
      if (!c) continue;
      this.place(c, a.position, false);
      c.setBaseState(stateForStatus(a.status));
    }
    this.ambience.setEnvironment(s.environment);
    this.ambience.setNetwork(s.network);
    this.syncMarkers(s);
  }

  private ensureChar(a: Agent) {
    let c = this.chars.get(a.id);
    const info = this.manifest[a.id];
    if (!c && info && this.textures.exists(a.id)) {
      c = new ApplianceCharacter(this, a.id, a.name, info, a.id);
      c.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        this.select(a.id, true);
      });
      c.input.on("pointerover", () => {
        c!.setHovered(true);
        const f = c!.feetWorld;
        const cam = this.cameras.main;
        this.bridge.fromGame.emit("hover", { agentId: a.id, x: (f.x - cam.worldView.x) * cam.zoom, y: (c!.topWorldY - cam.worldView.y) * cam.zoom });
      });
      c.input.on("pointerout", () => {
        c!.setHovered(false);
        this.bridge.fromGame.emit("hover", null);
      });
      this.chars.set(a.id, c);
    }
    return c;
  }

  /** Sprite top-left for a tile: native home placement plus the tile offset. */
  private spriteOrigin(c: ApplianceCharacter, pos: Position) {
    const home = ROSTER[c.id].homePosition;
    const ph = tileToPixel(home), pt = tileToPixel(pos);
    if (!ph || !pt) return null;
    return { x: c.home.x + (pt.x - ph.x), y: c.home.y + (pt.y - ph.y) };
  }

  /** Walks a character between two tiles of this room, around furniture. */
  private route(c: ApplianceCharacter, from: Position, to: Position, onDone?: () => void) {
    const tiles = findPath(ROOM, from, to);
    const points = tiles.map((t) => this.spriteOrigin(c, { room: ROOM, ...t })!);
    c.walk(points, tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), onDone);
  }

  private place(c: ApplianceCharacter, pos: Position, animate: boolean) {
    const prev = this.tiles.get(c.id);
    this.tiles.set(c.id, pos);
    if (pos.room !== ROOM) {
      // Leaves through the door that leads toward that room, then disappears.
      const door = HOUSE[ROOM].doors.find((d) => d.to.room === pos.room) ?? HOUSE[ROOM].doors[0]!;
      const doorPos = { room: ROOM, x: door.x, y: door.y };
      if (animate && c.root.visible && prev?.room === ROOM) {
        this.route(c, prev, doorPos, () => this.tweens.add({ targets: c.root, alpha: 0, duration: 300, onComplete: () => c.setVisible(false) }));
      } else c.setVisible(false);
      return;
    }
    const to = this.spriteOrigin(c, pos);
    if (!to) return;
    if (!c.root.visible) {
      // Enters through the door it came from.
      const door = HOUSE[ROOM].doors.find((d) => d.to.room === prev?.room) ?? HOUSE[ROOM].doors[0]!;
      const doorPos = { room: ROOM, x: door.x, y: door.y };
      const from = this.spriteOrigin(c, doorPos)!;
      c.root.setPosition(from.x, from.y).setAlpha(0);
      c.setVisible(true);
      this.tweens.add({ targets: c.root, alpha: 1, duration: 300 });
      if (animate) this.route(c, doorPos, pos);
      else c.root.setPosition(to.x, to.y);
      return;
    }
    if (animate && prev?.room === ROOM) this.route(c, prev, pos);
    else c.root.setPosition(to.x, to.y);
  }

  private applyEvent(event: SimulationEvent, state: WorldState) {
    switch (event.type) {
      case "simulation.reset":
        for (const c of this.chars.values()) c.destroy();
        this.chars.clear();
        this.applySnapshot(state);
        return;
      case "agent.joined":
        this.applySnapshot(state);
        return;
      case "agent.moved": {
        const c = this.chars.get(event.payload.agentId);
        if (c) this.place(c, event.payload.to, true);
        break;
      }
      case "agent.status_changed": {
        this.chars.get(event.payload.agentId)?.setBaseState(stateForStatus(event.payload.to));
        return;
      }
      case "world.updated":
        this.ambience.setEnvironment(event.payload.environment);
        return;
      case "network.updated":
        this.ambience.setNetwork(event.payload.network);
        return;
      case "world.event_triggered":
      case "world.event_ended":
        this.syncMarkers(state);
        break;
    }
    for (const cue of cuesForEvent(event, state)) this.applyCue(cue);
  }

  private applyCue(cue: CharacterCue) {
    const c = this.chars.get(cue.agentId);
    if (!c || !c.root.visible) return;
    if (cue.state) c.setState(cue.state, cue.holdMs);
    if (cue.mood) c.setMood(cue.mood, cue.holdMs ?? 1800);
    if (cue.bubble) {
      c.say(cue.bubble.kind, cue.bubble.text);
    }
    if (cue.lookAt) {
      const other = this.chars.get(cue.lookAt);
      if (other) c.look(Math.sign(other.feetWorld.x - c.feetWorld.x), cue.holdMs ?? 2000);
    }
  }

  private syncMarkers(s: WorldState) {
    const live = new Set(s.activeEvents.map((e) => e.id));
    for (const [id, m] of this.markers)
      if (!live.has(id)) {
        m.destroy(this);
        this.markers.delete(id);
      }
    for (const e of s.activeEvents) if (!this.markers.has(e.id)) this.markers.set(e.id, new WorldMarker(this, e));
  }

  /**
   * Isometric sorting against foreground furniture: a character is in front
   * when it stands on top of it, or past its footprint along x or y.
   */
  update() {
    for (const c of this.chars.values()) {
      c.sync();
      if (!c.root.visible) continue;
      const logical = this.tiles.get(c.id);
      const inRoom = logical?.room === ROOM;
      // while walking use the route tile; standing still, the logical tile
      const pt = c.tileNow ?? (inRoom ? { x: logical.x + 0.5, y: logical.y + 0.5 } : null);
      // only an appliance resting on a raised surface (TOAST on the island) is "on top"
      const resting = !c.moving && inRoom && isCounter(logical);
      let front = true;
      for (const f of this.foreground) {
        const fp = f.footprint;
        if (!pt) break;
        const inside = pt.x >= fp.x && pt.x < fp.x + fp.w && pt.y >= fp.y && pt.y < fp.y + fp.h;
        if (inside ? !resting : pt.x < fp.x + fp.w && pt.y < fp.y + fp.h) front = false;
      }
      c.root.setDepth((front ? DEPTH.front : DEPTH.behind) + c.feetWorld.y / 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Camera & input
  // ---------------------------------------------------------------------------

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBackgroundColor("#0b0a17");
    const margin = 1600;
    cam.setBounds(-margin, -margin, ART.width + margin * 2, ART.height + margin * 2);
    const fit = () => {
      const { zoom, x, y } = this.fitView();
      this.fitZoom = zoom;
      cam.setZoom(zoom);
      cam.centerOn(x, y);
    };
    fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, fit);
  }

  /** Zoom and camera center that frame the whole room in the gap between the UI panels. */
  private fitView() {
    const W = this.scale.width, H = this.scale.height;
    const wide = W >= 1100;
    const inset = wide ? { l: 190, r: 372, t: 70, b: 128 } : { l: 8, r: 8, t: 70, b: 8 };
    const room = { x: 140, y: 0, w: 1260, h: 965 }; // painted room inside kitchen.png
    const zoom = Math.min((W - inset.l - inset.r) / room.w, (H - inset.t - inset.b) / room.h);
    const sx = (inset.l + W - inset.r) / 2 - W / 2, sy = (inset.t + H - inset.b) / 2 - H / 2;
    return { zoom, x: room.x + room.w / 2 - sx / zoom, y: room.y + room.h / 2 - sy / zoom };
  }

  private setupInput() {
    const cam = this.cameras.main;
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), this.fitZoom * 0.8, this.fitZoom * 3.5));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, moved: false };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!drag || !p.isDown) return;
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      cam.scrollX = drag.sx - dx / cam.zoom;
      cam.scrollY = drag.sy - dy / cam.zoom;
    });
    this.input.on("pointerup", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (drag && !drag.moved && over.length === 0) this.select(null, true);
      drag = null;
    });
  }

  private select(id: AgentId | null, fromClick: boolean) {
    if (this.selected === id) return;
    if (this.selected) this.chars.get(this.selected)?.setSelected(false);
    this.selected = id;
    if (id) {
      this.chars.get(id)?.setSelected(true);
      if (fromClick) this.focus(id);
    }
    if (fromClick) this.bridge.fromGame.emit("select", id);
  }

  private focus(id: AgentId) {
    const c = this.chars.get(id);
    if (!c || !c.root.visible) return;
    const f = c.feetWorld;
    const cam = this.cameras.main;
    cam.pan(f.x, f.y - 90, 600, "Sine.easeInOut");
    cam.zoomTo(Math.max(cam.zoom, this.fitZoom * 1.6), 600, "Sine.easeInOut");
  }

  private zoom(z: "in" | "out" | "reset") {
    const cam = this.cameras.main;
    if (z === "reset") {
      const v = this.fitView();
      cam.zoomTo(v.zoom, 400, "Sine.easeInOut");
      cam.pan(v.x, v.y, 400, "Sine.easeInOut");
    } else cam.zoomTo(Phaser.Math.Clamp(cam.zoom * (z === "in" ? 1.25 : 0.8), this.fitZoom * 0.8, this.fitZoom * 3.5), 250);
  }

  private toggleGrid(on: boolean) {
    this.grid?.destroy();
    this.grid = undefined;
    if (!on) return;
    const g = this.add.graphics().setDepth(40_000);
    const room = HOUSE[ROOM];
    const label = (x: number, y: number) => {
      const p = tileToPixel({ room: ROOM, x, y })!;
      this.add.text(p.x, p.y, `${x},${y}`, { fontSize: "13px", color: "#ffe066" }).setOrigin(0.5).setDepth(40_001).setName("gridlabel");
    };
    for (let y = 0; y < room.height; y++)
      for (let x = 0; x < room.width; x++) {
        const pts = tileCorners(ROOM, x, y);
        const pos = { room: ROOM, x, y };
        const blocked = room.blocked.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        const counter = room.counters.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        g.lineStyle(2, blocked ? 0xff4d4d : counter ? 0xffb84d : 0x4dffa6, 0.9).strokePoints(pts as unknown as Phaser.Math.Vector2[], true);
        label(pos.x, pos.y);
      }
    this.grid = g;
    g.once(Phaser.GameObjects.Events.DESTROY, () => this.children.list.filter((o) => o.name === "gridlabel").forEach((o) => o.destroy()));
  }
}
