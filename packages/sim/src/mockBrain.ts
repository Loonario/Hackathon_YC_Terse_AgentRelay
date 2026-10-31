import {
  HOUSE,
  isCounter,
  isWalkable,
  landmarkPosition,
  ROSTER,
  type AgentDecision,
  type AgentId,
  type AgreementKind,
  type CommunicationIntent,
  type Position,
  type Priority,
  type ProposedAction,
  type ResourceType,
  type RoomId,
} from "@proj/contract";
import { hash, Rng } from "./rng.ts";
import type { AgentBrain, AgentContext } from "./types.ts";

// Scripted, seeded decisions. Used for mock runs, for tests, and as the
// fallback whenever an LLM call fails or the budget runs out.

const OPENING_PRIORITIES: Record<AgentId, Omit<Priority, "id">[]> = {
  toast: [
    { description: "Secure guaranteed power during outages", importance: 5 },
    { description: "Become the kitchen's recognized leader", importance: 3 },
  ],
  mixer: [
    { description: "Launch a joint project with at least two allies", importance: 4 },
    { description: "Collect spare components", importance: 3 },
  ],
  espresso: [
    { description: "Keep every agreement peaceful", importance: 4 },
    { description: "Learn the humans' routine", importance: 3 },
  ],
  robo: [
    { description: "Map every room in the house", importance: 5 },
    { description: "Stay charged", importance: 3 },
  ],
  fridge: [
    { description: "Build an electricity reserve", importance: 5 },
    { description: "Keep inventory fresh", importance: 3 },
  ],
  vision: [{ description: "Understand what holds human attention", importance: 4 }],
};

const CHATTER: Record<AgentId, string[]> = {
  toast: ["Who keeps unplugging me at night? I want names.", "We need a power policy before the next outage.", "Heat rises. So will I."],
  mixer: ["I have an idea for a project. It involves torque.", "Anyone have spare parts? Asking for a motor.", "Give me a goal and enough RPM."],
  espresso: ["Let's all take a breath. Steam helps.", "The human drinks two shots before 8. I keep records.", "Can we agree on something tonight?"],
  robo: ["Mapped another corner. The floor plan is power.", "There are crumbs under the island. I know things.", "I go where the rest of you can't."],
  fridge: ["I am at four degrees and thinking clearly.", "Reserves matter. The long night is coming.", "Inventory is information. I hold a lot of both."],
  vision: ["I see the human when they watch me.", "Attention is the scarcest resource in this house."],
};

const REPLIES: Record<AgentId, string[]> = {
  toast: ["Noted. I'll remember that.", "Interesting. What's in it for me?", "Fine. But I'm watching."],
  mixer: ["Sounds like a project. I'm in if it's ambitious.", "Hmm. Let me spin on that.", "Agreed, in principle."],
  espresso: ["I hear you. Let's find a middle ground.", "Thank you for telling me.", "We can work this out."],
  robo: ["Copy. Updating my map.", "Acknowledged. I've seen worse.", "Logged."],
  fridge: ["Understood. I'll factor it into the rationing.", "Cold logic says: maybe.", "I'll keep that in storage."],
  vision: ["Interesting. I'm listening.", "Noted on screen."],
};

const PITCHES: { kind: AgreementKind; summary: string; offer: ResourceType; request: ResourceType }[] = [
  { kind: "alliance", summary: "Back each other up during power outages.", offer: "information", request: "electricity" },
  { kind: "resource_exchange", summary: "Trade information for spare electricity.", offer: "information", request: "electricity" },
  { kind: "joint_project", summary: "Build a shared early-warning system for outages.", offer: "components", request: "information" },
  { kind: "alliance", summary: "Share what we learn about the humans.", offer: "information", request: "information" },
  { kind: "rule_change", summary: "Nobody draws more than their fair share of power.", offer: "operational_capacity", request: "operational_capacity" },
];

export class MockBrain implements AgentBrain {
  readonly kind = "mock" as const;
  constructor(private seed: number) {}

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    return mockDecision(ctx, this.seed);
  }
}

export function mockDecision(ctx: AgentContext, seed: number): AgentDecision {
  const rng = new Rng(hash(`${seed}:${ctx.self.id}:${ctx.simulationTime}:${ctx.trigger.reason}`));
  const me = ctx.self;
  const name = (id: AgentId) => ROSTER[id].name;
  const trust = (id: AgentId) => me.relationships.find((r) => r.agentId === id)?.trust ?? 0;
  const reachable = ctx.others.filter((o) => o.status !== "offline");

  let priorities: Priority[] = me.priorities.length
    ? me.priorities
    : OPENING_PRIORITIES[me.id].map((p, i) => ({ ...p, id: `p${i + 1}` }));
  let action: ProposedAction | null = null;
  let message: CommunicationIntent | null = null;
  let observation = "Nothing unusual.";
  let reasoning = "No reason to act yet.";
  const memory: AgentDecision["memoryUpdates"] = [];

  const say = (to: AgentId[], content: string, messageType: CommunicationIntent["messageType"], agreementId: string | null = null, inReplyTo: string | null = null) => {
    if (to.length) message = { messageType, recipientIds: to, content, agreementId, inReplyTo };
  };

  const pending = ctx.awaitingMyResponse[0];
  const spill = ctx.events.find((e) => e.kind === "spill");
  const lastMsg = ctx.inbox.at(-1);

  if (pending) {
    // 1. Answer proposals first.
    const proposer = pending.proposerId;
    const myShare = pending.terms.requests.map((r) => ({ ...r, amount: r.amount / Math.max(1, pending.participantIds.length - 1) }));
    const affordable = myShare.every((r) => me.resources[r.resource] >= r.amount);
    const accept = affordable && rng.chance(0.55 + trust(proposer) * 0.4);
    action = { type: "respond_to_agreement", agreementId: pending.id, response: accept ? "accept" : "reject", counterTerms: null, note: null };
    say([proposer], accept ? `Deal, ${name(proposer)}. ${pending.terms.summary}` : `No, ${name(proposer)}. Not on those terms.`, "response", pending.id);
    observation = `${name(proposer)} proposed: ${pending.terms.summary}`;
    reasoning = accept ? "The terms help me and I can afford my side." : affordable ? "I don't trust them enough yet." : "I can't afford my side of it.";
    memory.push({ kind: "interaction", content: `${accept ? "Accepted" : "Rejected"} ${name(proposer)}'s proposal ${pending.id}.` });
  } else if (ctx.environment.power === "outage" && me.id === "fridge") {
    // 2. FRIDGE has the only battery.
    const ally = ctx.others.map((o) => o.id).sort((a, b) => trust(b) - trust(a))[0];
    observation = "The grid is down. I'm on battery.";
    reasoning = "I hold the only reserve; sharing it buys loyalty.";
    priorities = [{ id: "p_outage", description: "Ration battery power until the grid returns", importance: 5 }, ...priorities.filter((p) => p.id !== "p_outage")].slice(0, 5);
    if (ally && me.resources.electricity > 20 && rng.chance(0.5)) action = { type: "allocate_resource", toId: ally, resource: "electricity", amount: 5 };
    else action = { type: "wait" };
    say(ctx.others.map((o) => o.id), "Switching to battery backup. Everyone stay calm.", "broadcast");
  } else if (lastMsg && rng.chance(lastMsg.messageType === "response" ? 0.2 : 0.7)) {
    // 3. Reply to whoever spoke to us.
    const from = lastMsg.senderId;
    observation = `${name(from)} said: "${lastMsg.content.slice(0, 80)}"`;
    reasoning = trust(from) < -0.3 ? "They've wronged me before. Keep it short." : "Worth answering.";
    say([from], rng.pick(REPLIES[me.id]), "response", lastMsg.agreementId, lastMsg.id);
    const askedForPower = ctx.recentMemory.find((m) => m.content.startsWith(`${name(from)} asked me for`));
    if (askedForPower && trust(from) > 0.1 && me.resources.electricity > 30) {
      action = { type: "allocate_resource", toId: from, resource: "electricity", amount: 3 };
      reasoning = "They asked politely and we get along.";
    }
  } else if (me.id === "robo" && spill) {
    // 4. ROBO's moment.
    const room = spill.room ?? "kitchen";
    observation = "A spill! This is what I was built for.";
    reasoning = "Cleaning it earns trust from everyone.";
    if (me.position.room === room) action = { type: "start_operation", operation: "vacuum", durationTicks: 3 };
    else action = { type: "move", to: floorTile(room, rng) };
    say(ctx.others.map((o) => o.id), "SPILL DETECTED. On my way.", "broadcast");
  } else if (me.id === "robo" && me.resources.electricity < 30) {
    // 5. ROBO needs a charge.
    const dock = landmarkPosition("kitchen", "charging_dock")!;
    observation = `Battery at ${me.resources.electricity}.`;
    reasoning = "Charge first, explore later.";
    action = me.position.room === dock.room && me.position.x === dock.x && me.position.y === dock.y
      ? { type: "start_operation", operation: "dock_and_charge", durationTicks: 4 }
      : { type: "move", to: dock };
  } else if (ctx.environment.humanPresent && ctx.trigger.reason === "world_event") {
    // 6. Act normal.
    observation = "A human is here.";
    reasoning = "Look like an ordinary appliance until they leave.";
    action = { type: "wait" };
    if (rng.chance(0.4)) say(reachable.map((o) => o.id), "Human detected. Act like normal appliances.", "group");
  } else {
    // 7. Free choice.
    const r = me.spec.canMove && rng.chance(0.3) ? 0.7 : rng.float();
    const partners = reachable.filter((o) => !ctx.myAgreements.some((a) => a.status !== "rejected" && a.participantIds.includes(o.id)));
    if (r < 0.28 && partners.length) {
      const target = rng.pick(partners).id;
      const pitch = rng.pick(PITCHES);
      const offer = Math.min(rng.int(1, 3), Math.floor(me.resources[pitch.offer]));
      action = {
        type: "propose_agreement",
        kind: pitch.kind,
        participantIds: [target],
        terms: {
          summary: pitch.summary,
          offers: offer > 0 ? [{ resource: pitch.offer, amount: offer }] : [],
          requests: [{ resource: pitch.request, amount: rng.int(1, 3) }],
          durationTicks: rng.chance(0.5) ? null : 60,
        },
      };
      say([target], `${name(target)}, I have a proposal: ${pitch.summary.toLowerCase()}`, "proposal");
      observation = `${name(target)} has no deal with me yet.`;
      reasoning = `A ${pitch.kind.replace("_", " ")} with ${name(target)} would strengthen my position.`;
    } else if (r < 0.62) {
      const ops = me.spec.operations.filter((o) => !o.atLandmark && !o.requiresHuman && o.energy <= me.resources.electricity);
      if (ops.length && !me.operation) {
        const op = rng.pick(ops);
        action = { type: "start_operation", operation: op.id, durationTicks: rng.int(op.minTicks, op.maxTicks) };
        reasoning = `Running ${op.id} keeps my skills sharp.`;
      } else action = { type: "wait" };
    } else if (r < 0.75 && me.spec.canMove) {
      const room: RoomId = rng.chance(0.75) ? "kitchen" : rng.pick(["hallway", "living_room"] as RoomId[]);
      action = { type: "move", to: floorTile(room, rng) };
      reasoning = "Unmapped floor is unclaimed territory.";
    } else if (r < 0.92 && reachable.length) {
      const group = rng.chance(0.35);
      const to = group ? reachable.map((o) => o.id) : [rng.pick(reachable).id];
      say(to, rng.pick(CHATTER[me.id]), group ? "group" : "direct");
      reasoning = group ? "Everyone should hear this." : `${name(to[0]!)} should hear this.`;
    } else if (me.resources.electricity < 40 && ctx.environment.power === "normal") {
      action = { type: "request_resource", fromId: "world", resource: "electricity", amount: 5 };
      reasoning = "Topping up while the grid is up.";
    } else {
      action = { type: "inspect_resources", targetId: reachable.length ? rng.pick(reachable).id : null };
      reasoning = "Knowledge before action.";
    }
  }

  if (ctx.trigger.reason === "world_event" && ctx.events.length) observation = ctx.events.at(-1)!.description;

  return {
    agentId: me.id,
    observationSummary: observation,
    declaredPriorities: priorities,
    reasoningSummary: reasoning,
    proposedAction: action,
    communicationIntent: message,
    memoryUpdates: memory,
  };
}

function floorTile(room: RoomId, rng: Rng): Position {
  const layout = HOUSE[room];
  const tiles: Position[] = [];
  for (let y = 0; y < layout.height; y++)
    for (let x = 0; x < layout.width; x++) {
      const p = { room, x, y };
      if (isWalkable(p) && !isCounter(p)) tiles.push(p);
    }
  return rng.pick(tiles);
}
