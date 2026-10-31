# Contract 0.2.0: frontend review of `entities.ts`, `events.ts`, `api.ts`

The changes below are already in the package (`bun test`: 16 pass). `CONTRACT_VERSION` is now `0.2.0`.

## What changed

1. **`Position` is room-local.** The old docs said "house tile coordinates" but also carried `room`. Examples like ROBO at hallway `(10,6)` didn't say whether `x,y` was global or per room, and no room had a size. Now `(0,0)` is the room's back corner, x runs along the right-hand back wall and y along the left-hand one. The new `layout.ts` defines `HOUSE` with each room's size, `blocked` furniture, raised `counters`, named `landmarks` and `doors` (door tile leads to `to` in the other room). It also adds the helpers `isInRoom`, `isWalkable`, `isCounter` and `landmarkPosition`.
2. **The kitchen is 8×8 and matches the art.** Row `y=0` is the back counter, column `x=0` is the window counter with the stove, the island is `(3..4, 4..5)` and is raised, the stools are blocked, and `(7,7)` is a cut-off corner.
3. **Roster homes moved to match the art.**

   | Agent | Home | Where |
   |---|---|---|
   | TOAST | (4,4) | kitchen island |
   | MIXER | (1,0) | back counter |
   | ESPRESSO | (3,0) | back counter |
   | FRIDGE | (6,1) | floor |
   | ROBO | (3,7) | charging dock (moved from the hallway into the kitchen) |
4. **Speed control.** Added `WorldState.tickIntervalMs`, the event `simulation.speed_changed` (handled in `applyEvent`), the route `routes.speed(id)` (POST `SetSpeedRequest`, responds with `SimulationResponse`) and `SimulationClient.setSpeed`. The UI's 1× / 2× / 4× buttons use it.

## What the frontend relies on (please emit these)

- **Relationships come only from events.** The Conspiracy Board and agent profile use `agent.relationship_changed` and `alliance.*`. They never parse message text, so if the sim doesn't emit these events, nothing shows.
- **`agreementId` on messages.** The activity feed labels Proposal, Agreement, Conflict and Negotiation from `messageType` plus the linked agreement's status. Please set `agreementId` on proposal and response messages.
- **`agent.status_changed`** drives the animation state: `thinking` shows a thought bubble and pondering eyes, `acting` shows action particles, `offline` dims the eyes and adds "zZ". `agent.decision_made.reasoningSummary` appears as a short thought bubble, so keep it to about 70 characters.
- **`agent.moved`** animates a walk between tiles. Moving to another room makes the character walk out through the matching `door` and disappear.
- **`recipientIds` can be empty.** The UI renders that as "everyone". Prefer listing recipients explicitly; a broadcast should go to all other agents.
- Validate moves with `isWalkable`, and give the LLM the `landmarks` (for example "move to the outlet") rather than raw coordinates.

## Wiring the real backend

The web app runs on the in-browser mock by default (`apps/web/src/game/mock/`). Set `NEXT_PUBLIC_SIM_SOURCE=http` to switch to `HttpSimulationClient` (`apps/web/src/lib/sim/httpClient.ts`). It calls the `routes` paths on the same origin, validates every response with the contract schemas, and reads `GET /:id/stream` as SSE with one JSON `StreamMessage` per `data:` line. No Phaser or UI code changes are needed.
