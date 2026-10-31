// Server-only settings, read from apps/web/.env.local. Never import from client code.

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  relayKey: process.env.RELAY_WORKSPACE_KEY ?? "",
  /** Self-hosted Relaycast origin (npx @relaycast/engine). Empty uses Agent Relay Cloud. */
  relayBaseUrl: process.env.RELAY_BASE_URL ?? "",
  /** "off" disables Terse persistence (simulations then live in memory only). */
  persist: process.env.SIM_PERSIST !== "off",
  live: {
    /** LLM decisions per run before agents fall back to the scripted brain. */
    budget: num(process.env.SIM_LLM_BUDGET, 300),
    maxConcurrent: num(process.env.SIM_LLM_CONCURRENCY, 3),
    decisionIntervalTicks: num(process.env.SIM_DECISION_INTERVAL, 15),
    timeoutMs: num(process.env.SIM_LLM_TIMEOUT_MS, 25_000),
    relayAckTimeoutMs: num(process.env.SIM_RELAY_ACK_TIMEOUT_MS, 4000),
    /** A running live simulation with no open stream for this long is paused. */
    idlePauseMs: num(process.env.SIM_IDLE_PAUSE_MS, 60_000),
  },
  /** Simulations kept in memory; the oldest is closed when exceeded. */
  maxSimulations: num(process.env.SIM_MAX_SIMULATIONS, 4),
};

export function log(scope: string, message: string, data?: Record<string, unknown>) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [${scope}] ${message}`, data ? JSON.stringify(data) : "");
}
