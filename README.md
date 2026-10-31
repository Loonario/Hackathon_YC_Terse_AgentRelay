# Hackathon_YC_Terse_AgentRelay

## Stack
- **Frontend**: Next.js 16 · React 19 · TypeScript · Tailwind 4 · Phaser 4.2.1 (`apps/web`)
- **AI layer**: OpenAI API, structured outputs (`openai` + `zod`)
- **Agent communication**: Agent Relay (`@agent-relay/sdk`)
- **Persistent state**: Terse Durable Actors (`apps/actor`)
- **Simulation backend**: TypeScript + Zod (`packages/sim`, empty)
- **Agents**: `packages/agents` (empty)

## Layout
```
apps/web        Next.js app. Typed Terse client in src/generated
apps/actor      Terse actor project (src/actor.ts). Standalone, not a Bun workspace
packages/sim    @proj/sim, importable from web
packages/agents @proj/agents, importable from web
scripts         check-setup.ts
```

## Run
```sh
bun install
bun run dev:actor   # terminal 1: Terse actor server on :7100
bun run dev         # terminal 2: Next.js on :3000
bun run check       # checks Terse, Agent Relay and OpenAI connectivity
```

After changing actor methods, run `bun run generate` to regenerate the client.

## Env
- `apps/web/.env.local` (gitignored): `OPENAI_API_KEY`, `RELAY_WORKSPACE_KEY`, `TERSE_ACTOR_URL`, `TERSE_API_KEY`. See `.env.example`.
- `apps/actor/.env`: secrets the actor uses. Push them to hosted Terse with `terse secrets import .env`.

## Deploy the actor
`bun run deploy:actor`, then set `TERSE_ACTOR_URL` and `TERSE_API_KEY` (Terse app › API keys) in `apps/web/.env.local` and run `bun run generate`.
