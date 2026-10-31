import { AgentDecision } from "@proj/contract";
import type { AgentBrain, AgentContext } from "@proj/sim";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { instructions, situation } from "./prompt.ts";

export interface LlmBrainOptions {
  apiKey?: string;
  model?: string;
  /** For reasoning models. Low keeps latency demo-friendly. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  client?: OpenAI;
}

const decisionFormat = zodTextFormat(AgentDecision, "agent_decision");

/** One OpenAI structured-output call per decision. Keeps no state of its own. */
export class LlmBrain implements AgentBrain {
  readonly kind = "llm" as const;
  private client: OpenAI;
  readonly model: string;

  constructor(private options: LlmBrainOptions = {}) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY, maxRetries: 1 });
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
  }

  async decide(ctx: AgentContext, signal: AbortSignal): Promise<AgentDecision> {
    const reasoning = /^(gpt-5|o\d)/.test(this.model) ? { effort: this.options.reasoningEffort ?? "low" } : undefined;
    const response = await this.client.responses.parse(
      {
        model: this.model,
        instructions: instructions(ctx),
        input: situation(ctx),
        text: { format: decisionFormat },
        ...(reasoning ? { reasoning } : {}),
        max_output_tokens: this.options.maxOutputTokens ?? 4000,
        store: false,
      },
      { signal },
    );
    const parsed = response.output_parsed;
    if (!parsed) throw new Error(`no structured output (status ${response.status}${response.incomplete_details ? `, ${response.incomplete_details.reason}` : ""})`);
    return { ...parsed, agentId: ctx.self.id };
  }
}
