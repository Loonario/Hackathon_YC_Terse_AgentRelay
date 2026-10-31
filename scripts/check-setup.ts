// Setup check: confirms each service is reachable with the current env.
// Run: bun run check   (loads apps/web/.env.local)
import OpenAI from "openai"
import { AgentRelay } from "@agent-relay/sdk"
import { actors } from "../apps/web/src/generated/index.js"

async function check(name: string, fn: () => Promise<string>) {
    try {
        console.log(`✓ ${name}: ${await fn()}`)
    } catch (e) {
        console.log(`✗ ${name}: ${e instanceof Error ? e.message : e}`)
    }
}

await check("Terse actor", async () => `counter = ${await actors.Counter.get("setup-check").increment()}`)
await check("Agent Relay", async () => {
    if (!process.env.RELAY_WORKSPACE_KEY) throw new Error("RELAY_WORKSPACE_KEY missing")
    const relay = new AgentRelay({ workspaceKey: process.env.RELAY_WORKSPACE_KEY, ...(process.env.RELAY_BASE_URL ? { baseUrl: process.env.RELAY_BASE_URL } : {}) })
    const info = await relay.workspace.info()
    return `workspace ${JSON.stringify(info).slice(0, 80)}`
})
await check("OpenAI", async () => {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing")
    const models = await new OpenAI().models.list()
    return `${models.data.length} models visible`
})
