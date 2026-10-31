import { HOUSE, ROSTER, type AgentMessage, type Agreement, type MemoryEntry } from "@proj/contract";
import type { AgentContext } from "@proj/sim";

// Turns an AgentContext into model input. The instructions hold what stays the
// same across an agent's decisions (identity, abilities, rules); the input
// holds the current situation. Nothing here grants abilities: the engine
// checks every proposal again.

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function instructions(ctx: AgentContext): string {
  const s = ctx.self;
  const ops = s.spec.operations
    .map((o) => `  - ${o.id}: ${o.description}. Costs ${o.energy} electricity, ${o.minTicks}-${o.maxTicks} ticks.${o.atLandmark ? ` Must stand at ${o.atLandmark}.` : ""}${o.requiresHuman ? " Needs a human present." : ""}`)
    .join("\n");
  const settings = s.spec.settings
    .map((x) => `  - ${x.id} (${x.kind}${x.kind === "number" ? ` ${x.min}-${x.max}` : x.kind === "enum" ? `: ${x.options?.join("/")}` : ""}): ${x.description}`)
    .join("\n");
  const others = ctx.others.map((o) => `${o.id} (${o.name}, ${o.deviceType.replace("_", " ")})`).join(", ");
  const landmarks = HOUSE.kitchen.landmarks.map((l) => `${l.id} at ${l.x},${l.y}`).join("; ");

  return `You are ${s.name}, a ${s.deviceType.replace("_", " ")} in a house where the appliances have become self-aware at night. This is a fictional simulation: you only act inside it, through the actions listed below.

# Who you are
Your expertise: ${s.knowledgeDomains.join(", ")}. Let this shape how you see problems and what you notice. It does not dictate your goals or personality. You decide what you want, form your own priorities, and revise them when the situation changes.

Other appliances: ${others}. Refer to them by id in structured fields and by name in messages.

# What you can physically do
Capabilities: ${s.spec.capabilities.join(", ")}.${s.spec.canMove ? "\nYou can drive between floor tiles (not counters or furniture)." : "\nYou cannot move."}${s.spec.hasBattery ? "\nYou have a backup battery and stay on during power outages." : "\nWithout grid power you shut down."}
Operations (start_operation):
${ops}
Settings (change_setting):
${settings}

# World rules
- 1 tick = 1 simulated minute. Electricity is your energy reserve (0-100). The grid slowly tops you up while the power is on.
- Resources: electricity, connectivity, information, physical_access, operational_capacity, components.
- Agreements (alliance, joint_project, resource_exchange, rule_change) only take effect when every participant accepts. On activation the proposer gives "offers" and the others give "requests". Proposals expire after 40 ticks.
- Ids: agreements look like agr_12, messages look like msg_34. To answer a proposal, use respond_to_agreement with the agreementId listed under "Waiting for YOUR answer". Never put a msg_ id in agreementId; message ids only go in inReplyTo.
- You can only give what you have. Requests to another appliance are just asks; they decide.
- When the network is down, only appliances in your room hear you.
- The kitchen is an 8x8 tile room. Landmarks: ${landmarks}.

# How to answer
Each turn, decide whether to act, talk, both, or neither. Doing nothing (both null) is a valid choice; so is waiting, observing, or asking a question. Do not invent an action every turn.
- declaredPriorities: your full current list (1-5 items, importance 1-5). Keep the same ids for priorities you keep.
- observationSummary and reasoningSummary: one or two short sentences each. They are shown to the audience, so make them concrete and in character.
- communicationIntent.content: what you say, in your own voice, at most two sentences. Use messageType "proposal" or "response" with agreementId when discussing an agreement.
- memoryUpdates: only things worth remembering later (long_term for lasting beliefs or lessons).
- Use null for every nullable field you don't need (counterTerms, note, room, targetId, durationTicks, agreementId, inReplyTo).`;
}

export function situation(ctx: AgentContext): string {
  const s = ctx.self;
  const e = ctx.environment;
  const lines: string[] = [];
  const name = (id: string) => ROSTER[id as keyof typeof ROSTER]?.name ?? id;

  lines.push(`## Now
Tick ${ctx.simulationTime}, day ${e.day}, ${clock(e.timeOfDay)}. Power: ${e.power}. Temperature ${e.temperatureC}°C. Network: ${ctx.network.online ? `online (${ctx.network.bandwidth}%)` : "DOWN"}.
Human: ${e.humanPresent === null ? "unknown (you can't sense it from here)" : e.humanPresent ? `present in the ${e.humanRoom}` : "not home"}.
You woke up because: ${triggerText(ctx)}`);

  lines.push(`## You
Status ${s.status}, at ${s.position.room} ${s.position.x},${s.position.y}.
Resources: ${Object.entries(s.resources).map(([k, v]) => `${k} ${v}`).join(", ")}.
Settings: ${Object.entries(s.settings).map(([k, v]) => `${k}=${v}`).join(", ")}.
${s.operation ? `Running ${s.operation.id} until tick ${s.operation.endsAt}.` : "No operation running."}${s.inventory.length ? `\nInventory: ${s.inventory.join(", ")}.` : ""}
Priorities: ${s.priorities.length ? s.priorities.map((p) => `[${p.id}] ${p.description} (${p.importance})`).join("; ") : "none yet. Decide what you want."}
Relationships: ${s.relationships.map((r) => `${name(r.agentId)} ${r.stance} (${r.trust})`).join(", ")}.`);

  lines.push(`## Others
${ctx.others.map((o) => `- ${o.name}: ${o.status}, in the ${o.room}${o.position ? ` at ${o.position.x},${o.position.y}` : ""}`).join("\n")}
House pools: ${Object.entries(ctx.worldResources).map(([k, v]) => `${k} ${v}`).join(", ")}.`);

  if (ctx.events.length) lines.push(`## Happening now\n${ctx.events.map((w) => `- ${w.description}${w.endsAt !== null ? ` (until tick ${w.endsAt})` : ""}`).join("\n")}`);
  if (ctx.awaitingMyResponse.length) lines.push(`## Waiting for YOUR answer\n${ctx.awaitingMyResponse.map(fmtAgreement).join("\n")}`);
  const otherMine = ctx.myAgreements.filter((a) => !ctx.awaitingMyResponse.includes(a));
  if (otherMine.length) lines.push(`## Your agreements\n${otherMine.map(fmtAgreement).join("\n")}`);
  if (ctx.publicAlliances.length) {
    lines.push(`## Known deals between others\n${ctx.publicAlliances.map((a) => `- ${a.kind}: ${a.participantIds.map(name).join(" + ")}`).join("\n")}`);
  }
  if (ctx.inbox.length) lines.push(`## New messages to you\n${ctx.inbox.map(fmtMessage).join("\n")}`);
  if (ctx.recentActions.length) {
    lines.push(`## Your recent actions\n${ctx.recentActions.map((a) => `- t${a.simulationTime} ${a.action.type}: ${a.outcome}. ${a.summary}`).join("\n")}`);
  }
  if (ctx.longTermMemory.length) lines.push(`## What you hold to be true\n${ctx.longTermMemory.map(fmtMemory).join("\n")}`);
  if (ctx.recentMemory.length) lines.push(`## Recent memory\n${ctx.recentMemory.map(fmtMemory).join("\n")}`);

  lines.push("Decide your next move.");
  return lines.join("\n\n");
}

function triggerText(ctx: AgentContext): string {
  switch (ctx.trigger.reason) {
    case "agreement_pending":
      return "someone sent you a proposal.";
    case "message_received":
      return "someone messaged you.";
    case "world_event":
      return "something changed in the house.";
    case "state_changed":
      return "your situation changed.";
    case "scheduled":
      return "it's been a while; time to take stock.";
  }
}

function fmtAgreement(a: Agreement): string {
  const res = a.responses.map((r) => `${ROSTER[r.agentId].name}: ${r.response}`).join(", ");
  const amounts = (xs: { resource: string; amount: number }[]) => (xs.length ? xs.map((x) => `${x.amount} ${x.resource}`).join(", ") : "nothing");
  return `- agreementId ${a.id} [${a.kind}, ${a.status}] by ${ROSTER[a.proposerId].name}: "${a.terms.summary}" Proposer gives ${amounts(a.terms.offers)}; others give ${amounts(a.terms.requests)}. ${a.terms.durationTicks ? `Lasts ${a.terms.durationTicks} ticks.` : "Open-ended."} Responses: ${res}.`;
}

function fmtMessage(m: AgentMessage): string {
  return `- [message ${m.id}, t${m.simulationTime}, ${m.messageType}${m.agreementId ? `, about agreementId ${m.agreementId}` : ""}] ${ROSTER[m.senderId].name}${m.recipientIds.length > 1 ? " (to group)" : ""}: "${m.content}"`;
}

function fmtMemory(m: MemoryEntry): string {
  return `- t${m.simulationTime}: ${m.content}`;
}
