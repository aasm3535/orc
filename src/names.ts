/**
 * Agent name generator — simple English first + last names, unique color per agent
 */

const FIRST = [
  "Alex", "Jordan", "Sam", "Casey", "Riley", "Morgan", "Taylor", "Quinn",
  "Avery", "Blake", "Cameron", "Drew", "Harper", "Kai", "Logan", "Nico",
  "Parker", "Reese", "Sage", "Wren", "Ash", "Ellis", "Rowan", "Mika",
  "Eli", "Jade", "Robin", "Pat", "Dana", "Lee", "Max", "Noa",
];

const LAST: Record<string, string[]> = {
  manager:   ["Atlas", "Oracle", "Helm", "Rex", "North", "Prime", "Chief", "Lead"],
  developer: ["Builder", "Craft", "Forge", "Spark", "Byte", "Logic", "Hacker", "Code"],
  scout:     ["Hawk", "Trail", "Echo", "Flare", "Scout", "Flash", "Dart", "Fox"],
  reviewer:  ["Judge", "Watch", "Eye", "Guard", "Audit", "Knox", "Sharp", "Vett"],
};

export type AgentColor = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

export interface AgentIdentity {
  name: string;
  handle: string;
  role: string;
  color: AgentColor;
}

const PALETTE: AgentColor[] = ["magenta", "cyan", "green", "yellow", "red", "blue"];

export function generateIdentity(role: string, index: number): AgentIdentity {
  const h = hash(`${role}:${index}:orc`);
  const lasts = LAST[role] ?? LAST.developer;
  const name = `${FIRST[h % FIRST.length]} ${lasts[(h >> 8) % lasts.length]}`;
  const handle = name.toLowerCase().replace(" ", "-");
  const color = PALETTE[h % PALETTE.length];
  return { name, handle, role, color };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
