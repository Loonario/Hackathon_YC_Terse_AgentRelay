# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Hackathon project. `packages/sim` and `packages/agents` are empty stubs and `apps/actor` holds the Terse template `Counter`. The frontend (Phaser kitchen + React UI) is built in `apps/web` and runs on an in-browser mock simulation until the backend exists.

## Stack

- **Frontend**: Next.js 16 (App Router, `src/` dir, Turbopack, React Compiler, `cacheComponents`), React 19, TypeScript, Tailwind 4, Phaser 4.2.1
- **AI layer**: OpenAI API. Independent appliance agents return structured outputs via `openai/helpers/zod` (`zodTextFormat` + `responses.parse`)
- **Agent communication**: Agent Relay (`@agent-relay/sdk`): channels, DMs, typed actions
- **Persistent state**: Terse Durable Actors (`terse-sdk`)
- **Simulation backend**: TypeScript sim engine with Zod validation and an event system (`packages/sim`)

## Commands

Package manager is **Bun ≥ 1.4.2** (required by the Terse CLI). Run from the repo root unless noted.

```sh
bun install
bun run dev:actor   # Terse actor dev server on :7100 (must be running for the web app and `generate`)
bun run dev:relay   # self-hosted Agent Relay (Relaycast) on :8787, data in .relay/ (must be running for live mode when RELAY_BASE_URL is set)
bun run dev         # Next.js dev server on :3000
bun run generate    # regenerate typed actor client into apps/web/src/generated (actor server must be running)
bun run check       # connectivity check: Terse actor, Agent Relay workspace, OpenAI
bun run deploy:actor
bun run typecheck   # all workspaces
bun scripts/e2e.ts --base http://localhost:3000 [--live] [--seconds 60]   # HTTP end-to-end test against a running server

cd apps/web && bun run build    # also generates Next route types (LayoutProps etc.) that `tsc` needs
cd apps/web && bun run lint
bun test                        # in a package dir; single test: bun test path/to/file.test.ts -t "name"
```

## Architecture

- **Bun workspaces**: `apps/web`, `packages/*`, `scripts`. Workspace packages (`@proj/sim`, `@proj/agents`) export raw TS from `src/index.ts`. Nothing gets built, and the web app imports them directly.
- **`@proj/contract` (`packages/contract`) is the shared frontend/backend contract**: Zod schemas and types for agents, world state, events, interventions, agent decisions, HTTP routes, the SSE stream protocol and the `SimulationClient` interface, plus the pure `applyEvent` reducer and example fixtures. It depends only on Zod. Breaking changes must be agreed with the frontend developer and must bump `CONTRACT_VERSION`. Schemas used as OpenAI structured outputs (`ProposedAction`, `AgentDecision`) must use `.nullable()`, never `.optional()`.
- **Backend flow**: `@proj/sim` holds the authoritative `Engine` (pure rules, events via `applyEvent`), `SimulationRunner` (tick loop, decision triggers, LLM budget/concurrency/timeouts, falls back to `MockBrain`), and `MessageTransport` (`LocalTransport` for mock). `@proj/agents` has `LlmBrain` (OpenAI `responses.parse` + `zodTextFormat(AgentDecision)`, so every decision and message is written by OpenAI) and `RelayTransport` (carries agent messages over Agent Relay). `apps/web/src/server/` wires them: `registry.ts` (sims on `globalThis`, LRU eviction), `persistence.ts` (write-behind to the Terse `SimulationLog` actor, restore on GET). Routes are in `apps/web/src/app/api/simulations/`, plus `/:id/debug` for runner/Relay stats. Mode `mock` uses no external services; `live` needs `OPENAI_API_KEY` + `RELAY_WORKSPACE_KEY`. Tuning env: `SIM_LLM_BUDGET`, `SIM_LLM_CONCURRENCY`, `SIM_DECISION_INTERVAL`, `SIM_LLM_TIMEOUT_MS`, `SIM_RELAY_ACK_TIMEOUT_MS`, `SIM_IDLE_PAUSE_MS` (a running live sim with no open stream is paused after this, default 60s), `SIM_PERSIST=off`.
- **Relay is self-hosted for the demo**: `RELAY_BASE_URL=http://localhost:8787` in `.env.local` points the app, `bun run check` and the debugging MCP at the local engine (Cloud was 10-20s per message and often overloaded; local is ~10-30ms). The local workspace key was created with `POST /v1/workspaces` and is not recoverable, so keep `.relay/relaycast.db`. The Cloud key is kept commented out in `.env.local`. Restart Claude Code to reconnect the MCP to the local engine.
- **Relay quirks (14.0.0)**: re-registering an existing agent name fails with `name_conflict`, so `RelayTransport` registers per-simulation names (`uprising-<agent>-<sim>`) and releases them on close. Acks can take 10-20s and the backend sometimes rejects writes ("capacity busy" / "overloaded"), so the engine records a message after `ackTimeoutMs` or locally on failure, and registration retries in the background. Inbound echo events arrive without our `metadata`.
- **`apps/actor` is NOT a workspace member.** It has its own `bun.lock` and `node_modules`, and `terse deploy` uploads only its source. Actor code must not import `@proj/*` packages, so keep it self-contained.
- **Terse flow**: actors are defined in `apps/actor/src/actor.ts`. `terse actor generate` writes a dependency-free typed client to `apps/web/src/generated/` (never edit it by hand). Use it server-side only, as `actors.<Class>.get(id).<method>()`. For live browser updates, the server calls `actors.<Class>.prepareWebsocket(...)` and hands the browser the `websocketUrl`. `@Emittable` fields arrive as `state` / `state_update` messages.
- **Terse persistence gotchas**: `@Persisted` saves only when a field is reassigned, so nested mutation like `.push()` is not saved. Each actor has SQLite at `this.db.exec(sql, ...binds)`, and transactions are runtime-owned. Calls are serialized per actor unless a method is marked `@Interleave`.
- **Agent Relay**: `new AgentRelay({ workspaceKey })`. Then `relay.workspace.register({ name, type: "agent" })`, which is idempotent and rotates the token, and returns a client with `sendMessage({ to: "#channel" | "@handle", text })`. Use `relay.addListener("message.created", ...)` for inbound messages. Actions (`registerAction` with Zod input) are fire-and-forget, and results arrive as `action.completed` events.
- **Agent Relay MCP**: `.mcp.json` registers `agent-relay`, launched by `scripts/relay-mcp.sh`, which reads `RELAY_WORKSPACE_KEY` from `apps/web/.env.local`. It points at the same workspace as the app, so use it to inspect or post to the app's channels while debugging. On startup the server registers an agent named `RELAY_AGENT_NAME` (default `orchestrator`, which is already taken), and in agent-relay 14.0.0 that fails with "already exists in this workspace" if the name exists, even for a name it registered itself. So the script sets a fresh `claude-code-<timestamp>` name on each launch. Each session therefore adds a new agent to the workspace. To use a fixed name, set `RELAY_AGENT_NAME` and remove the old agent before each launch.
- **Frontend (`apps/web/src`)**: `game/` is Phaser (scene `scenes/KitchenScene.ts`, entities, procedural LED eyes in `entities/Eyes.ts`, tile→pixel calibration in `layout.ts`, event→animation mapping in `presentation.ts`). `components/game/` is the React UI. `lib/sim/store.ts` keeps the snapshot in sync with `applyEvent` and forwards to Phaser via `game/bridge.ts`. The client is `MockSimulationClient` (`game/mock/`) unless `NEXT_PUBLIC_SIM_SOURCE=http`. URL flags: `?autostart=1`, `?speed=250`, `?grid=1` (tile debug grid).
- **Art**: `scripts/native-art.ts` (OpenAI Images) paints the appliances into the scene and isolates them as sprites; `scripts/visors.ts` detects visor quads into `public/game/sprites.json`; `scripts/foreground.ts` cuts the island + stools into a foreground layer (`island_fg.png`) that characters sort behind or in front of by tile footprint. Sources are in `apps/web/art-src`. Sprites sit at native pixel positions on their home tiles; other tiles are offset via `layout.ts`.
- **Next.js 16 differs from older versions.** Per `apps/web/AGENTS.md`, read the guides in `apps/web/node_modules/next/dist/docs/` before writing Next code, and heed deprecations. Phaser touches `window`, so load it only in client components (dynamic import).

## Env

- `apps/web/.env.local` (gitignored, template `.env.example`): `OPENAI_API_KEY`, `OPENAI_MODEL`, `RELAY_WORKSPACE_KEY` (workspace `hackathon-yc`), `TERSE_ACTOR_URL` (defaults to local :7100), and `TERSE_API_KEY` (hosted only). These are all server-side, so never expose them to the browser.
- `apps/actor/.env`: secrets the actor itself uses. Push them to hosted Terse with `terse secrets import .env`.
- After `terse deploy`, set `TERSE_ACTOR_URL` and `TERSE_API_KEY` in the web env, then run `bun run generate` again.
