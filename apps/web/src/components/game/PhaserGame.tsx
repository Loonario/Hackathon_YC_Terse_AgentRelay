"use client";

import { useEffect, useRef } from "react";
import type { GameBridge } from "@/game/bridge";

/** Mounts the Phaser world. Phaser is imported on the client only. */
export default function PhaserGame({ bridge }: { bridge: GameBridge }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: { destroy(removeCanvas: boolean): void } | null = null;
    let cancelled = false;
    (async () => {
      await document.fonts.ready; // canvas text needs the web fonts loaded
      const { createGame } = await import("@/game/createGame");
      if (!cancelled && host.current) game = createGame(host.current, bridge);
    })();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [bridge]);

  return <div ref={host} className="absolute inset-0" aria-label="Kitchen world" />;
}
