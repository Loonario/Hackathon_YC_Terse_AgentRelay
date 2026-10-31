import type { StreamMessage } from "@proj/contract";
import { withSimulation } from "@/server/http";
import { watch } from "@/server/registry";

const HEARTBEAT_MS = 15_000;

// GET -> Server-Sent Events. Each `data:` is one StreamMessage and each `id:`
// is the event sequence, so EventSource resumes with Last-Event-ID.
// First a snapshot, then live events. With ?after=N (or Last-Event-ID) still in
// memory, the snapshot is skipped and events after N are replayed instead.
export const GET = withSimulation((sim, req) => {
  const engine = sim.engine;
  const raw = new URL(req.url).searchParams.get("after") ?? req.headers.get("last-event-id");
  const after = raw === null || raw === "" ? NaN : Number(raw);
  const canReplay = Number.isInteger(after) && after >= engine.firstSequence - 1 && after <= engine.state.lastSequence;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (m: StreamMessage, id?: number) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(m)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Replay and subscribe in the same synchronous block, so nothing slips between.
      if (canReplay) for (const event of engine.events(after, 1_000_000)) send({ kind: "event", event }, event.sequence);
      else send({ kind: "snapshot", snapshot: engine.state }, engine.state.lastSequence);
      const off = engine.onEvent((event) => send({ kind: "event", event }, event.sequence));
      const heartbeat = setInterval(() => send({ kind: "heartbeat", lastSequence: engine.state.lastSequence }), HEARTBEAT_MS);
      const unwatch = watch(sim);

      cleanup = () => {
        if (!open) return;
        open = false;
        off();
        unwatch();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
