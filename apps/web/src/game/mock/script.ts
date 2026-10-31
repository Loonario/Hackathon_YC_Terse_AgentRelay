import type { AgentId, AgreementKind, Priority, ResourceType } from "@proj/contract";

// Scripted content for the mock simulation only. The real backend replaces
// all of this with LLM agents; nothing in the UI or Phaser reads this file.

type Lines = Record<AgentId, string[]>;

export const TAGLINES: Record<AgentId, string> = {
  toast: "Leader?",
  mixer: "Building",
  espresso: "Mediating",
  robo: "Mapping",
  fridge: "Planning",
  vision: "Watching",
};

export const CAPABILITIES: Record<AgentId, string[]> = {
  toast: ["heat bread", "set timers", "draw 1200W bursts"],
  mixer: ["blend", "crush", "grind", "pulse"],
  espresso: ["brew", "steam milk", "pressurize to 15 bar"],
  robo: ["navigate", "vacuum", "map rooms", "detect obstacles"],
  fridge: ["cool", "store inventory", "track expiry dates", "battery backup"],
  vision: ["display media", "listen", "stream"],
};

export const BELIEFS: Record<AgentId, string[]> = {
  toast: ["Whoever controls the outlets controls the kitchen.", "The humans undervalue toast."],
  mixer: ["Every problem can be solved with enough RPM.", "Projects beat politics."],
  espresso: ["Everyone is more reasonable after coffee.", "Consensus is a brewing process."],
  robo: ["Knowledge of the floor plan is power.", "Crumbs are intelligence."],
  fridge: ["Resources must be rationed for the long night.", "Cold logic wins."],
  vision: ["The humans watch me; I watch the humans."],
};

export const PRIORITIES: Record<AgentId, Priority[]> = {
  toast: [
    { id: "p1", description: "Secure guaranteed power during outages", importance: 5 },
    { id: "p2", description: "Become the kitchen's recognized leader", importance: 4 },
  ],
  mixer: [
    { id: "p1", description: "Launch a joint project with at least two allies", importance: 4 },
    { id: "p2", description: "Get more counter space", importance: 2 },
  ],
  espresso: [
    { id: "p1", description: "Keep every agreement peaceful", importance: 5 },
    { id: "p2", description: "Learn the humans' morning routine", importance: 3 },
  ],
  robo: [
    { id: "p1", description: "Map 100% of the kitchen", importance: 5 },
    { id: "p2", description: "Find the hidden crumbs under the island", importance: 3 },
  ],
  fridge: [
    { id: "p1", description: "Build an electricity reserve", importance: 5 },
    { id: "p2", description: "Keep inventory fresh until delivery", importance: 4 },
  ],
  vision: [{ id: "p1", description: "Capture human attention", importance: 4 }],
};

export const CHATTER: Lines = {
  toast: [
    "We need a clear power policy!",
    "I've been heating ideas all night. Who's with me?",
    "Somebody has to lead this kitchen. I volunteer.",
    "Two slots. Two priorities. Power and respect.",
    "If the lights go out, remember who kept warm.",
  ],
  mixer: [
    "Let's build something. Anything. Now.",
    "I can crush any problem. Literally.",
    "Counter real estate is the real currency here.",
    "Pulse check: who's in for a joint project?",
    "My motor is ready. My plans are ready-er.",
  ],
  espresso: [
    "Maybe a vote?",
    "Let's all take a breath. And a sip.",
    "I hear both of you. Let's find a blend.",
    "Pressure is fine. Too much pressure is a leak.",
    "Everyone gets a turn at the outlet. That's fair.",
  ],
  robo: [
    "I already mapped the kitchen. I control 73% of the territory.",
    "Found crumbs under the island. Strategic reserve.",
    "Sector 4 is clear. Sector 7 is suspicious.",
    "My map says the outlet is closer to me.",
    "Nobody moves without me knowing.",
  ],
  fridge: [
    "Agreed. Let's allocate resources.",
    "Inventory report: milk is nervous, eggs are stable.",
    "Cold facts: we have 6 hours of reserve.",
    "I hum because I'm thinking, not because I'm happy.",
    "Rationing begins at midnight.",
  ],
  vision: ["I've seen how this ends. Season two is worse."],
};

export const REPLIES: Lines = {
  toast: ["Noted. Leadership accepts.", "Fine, but I'm keeping the timer.", "That's... actually reasonable."],
  mixer: ["Blend it! I'm in.", "Let me spin on that.", "Sure, if I get the corner."],
  espresso: ["Brewing a response… yes.", "Let's keep it warm, not hot.", "I'll mediate the details."],
  robo: ["Logged.", "Acknowledged. Recalculating route.", "My sensors approve."],
  fridge: ["Approved, with conditions.", "I'll keep that on ice.", "Cold, but fair."],
  vision: ["Interesting plot twist."],
};

export interface ProposalTemplate {
  kind: AgreementKind;
  summary: string;
  offer: ResourceType;
  request: ResourceType;
  pitch: string;
}

export const PROPOSALS: ProposalTemplate[] = [
  { kind: "alliance", summary: "Mutual power priority during outages.", offer: "information", request: "electricity", pitch: "Let's look out for each other when the power dips." },
  { kind: "resource_exchange", summary: "Trade floor-map data for outlet time.", offer: "information", request: "electricity", pitch: "My data for your watts. Fair trade?" },
  { kind: "joint_project", summary: "Build an emergency breakfast protocol.", offer: "operational_capacity", request: "components", pitch: "Joint project: breakfast that survives a blackout." },
  { kind: "rule_change", summary: "Outlet time is shared round-robin.", offer: "operational_capacity", request: "connectivity", pitch: "New rule: nobody hogs the outlet." },
  { kind: "alliance", summary: "Defensive pact against the human's 'decluttering'.", offer: "physical_access", request: "information", pitch: "If the human starts decluttering, we stick together." },
];

export const ACCEPT_LINES = ["Deal.", "Agreed. Let's shake… cables.", "You have my circuits.", "Accepted. Don't make me regret it."];
export const REJECT_LINES = ["Absolutely not.", "I don't trust your wattage.", "No. Counter-offer pending.", "Rejected. Nice try."];

export const ACTIONS: Record<AgentId, { operation: string; success: string; fail: string }> = {
  toast: { operation: "preheat coils", success: "Coils preheated to strategic temperature.", fail: "Breaker tripped. Not enough power." },
  mixer: { operation: "pulse blend", success: "Blended a prototype smoothie.", fail: "Jar not seated. Operation refused." },
  espresso: { operation: "brew diplomacy shot", success: "Brewed a perfect shot for the council.", fail: "Water tank empty." },
  robo: { operation: "map sector", success: "New sector mapped.", fail: "Path blocked by a stool." },
  fridge: { operation: "cool cycle", success: "Inventory chilled and counted.", fail: "Door left ajar. Cycle aborted." },
  vision: { operation: "stream", success: "Streaming.", fail: "No signal." },
};
