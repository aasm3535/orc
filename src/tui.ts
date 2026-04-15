/**
 * Orc TUI — clean responsive terminal UI
 *
 *   ____  _____   _____
 *  / __ \|  __ \ / ____|
 * | |  | | |__) | |
 * | |  | |  _  /| |
 * | |__| | | \ \| |____
 *  \____/|_|  \_\\_____|
 *   Multi-Agent Swarm
 *
 *  Cycle 1/3 | 45s | $0.00 | Planning
 *  ─────────────────────────────────
 *
 *  ▸ Alex Atlas      GLM 5.1     ✓ 12s     $0.02
 *    Sam Byte        Kimi K2.5   ● working
 *    Kai Fox         GLM 4.7     idle
 *    Sage Knox       Minimax 2.7 idle
 *
 *  ── Alex Atlas ─ GLM 5.1 ─────────────
 *  │ 3 tools completed
 *  │
 *  │ ## Plan
 *  │ I'll start by exploring the project structure and reading the relevant files
 *  │ to understand the codebase. Then I'll create a detailed implementation plan
 *  │ that assigns subtasks to each developer...
 *  ─────────────────────────────────────
 */

import chalk, { type ChalkInstance } from "chalk";
import { type AgentLiveState } from "./live.js";
import { generateIdentity, type AgentIdentity, type AgentColor } from "./names.js";
import type { OrchestrationPhase, AgentResult, OrchestrationResult, SwarmConfig } from "./types.js";
import { Agent, type ModelInfo } from "./agent.js";

// ── ANSI ──
const hide = "\x1b[?25l";
const show = "\x1b[?25h";
const up = (n: number) => n > 0 ? `\x1b[${n}A` : "";
const clr = () => "\x1b[0J";
const cls = () => "\x1b[2J\x1b[H";

// ── Colors per agent ──
const CC: Record<AgentColor, ChalkInstance> = {
  magenta: chalk.magenta, cyan: chalk.cyan, green: chalk.green,
  yellow: chalk.yellow, red: chalk.red, blue: chalk.blue,
};

// ── ASCII from assci.txt ──
const ORC = [
  "   ____  _____   _____ ",
  "  / __ \\|  __ \\ / ____|",
  " | |  | | |__) | |     ",
  " | |  | |  _  /| |     ",
  " | |__| | | \\ \\| |____ ",
  "  \\____/|_|  \\_\\\\_____|",
];

// ── Spinner ──
const FR = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

// ── Agent display state ──
interface Disp {
  id: AgentIdentity;
  mi: ModelInfo;
  st: "idle" | "working" | "done" | "error";
  dur: number;
  cost: number;
  live: AgentLiveState;
  out: string;
}

// ── TUI ──
export class OrcTUI {
  private S = {
    phase: "initializing" as OrchestrationPhase,
    cycle: 0, max: 5, task: "",
    agents: new Map<string, Disp>(),
    sel: "", cost: 0, t0: Date.now(),
  };
  private n = 0;
  private cols = 80;
  private fi = 0; // spinner frame
  private si: ReturnType<typeof setInterval> | null = null;
  private readonly isTTY: boolean;
  private aborted_ = false;

  constructor(cfg: SwarmConfig, task: string) {
    this.isTTY = !!process.stdout.isTTY;
    this.S.task = task; this.S.max = cfg.maxCycles;
    const add = (role: string, idx: number, m: string) => {
      const id = generateIdentity(role, idx);
      this.S.agents.set(id.handle, {
        id, mi: { ref: m, shortName: shortM(m) },
        st: "idle", dur: 0, cost: 0,
        live: { text: "", tools: [], activeToolIndex: -1 }, out: "",
      });
    };
    add("manager", 0, cfg.manager.model);
    for (let i = 0; i < cfg.developer.count; i++) add("developer", i, cfg.developer.model);
    for (let i = 0; i < cfg.scout.count; i++) add("scout", i, cfg.scout.model);
    add("reviewer", 0, cfg.reviewer.model);
    this.S.sel = [...this.S.agents.keys()][0] || "";

    if (this.isTTY) {
      process.stdin.setRawMode(true); process.stdin.resume();
      process.stdin.on("data", (b: Buffer) => this.key(b.toString()));
      this.si = setInterval(() => { this.fi++; this.draw(); }, 100);
      process.stdout.write(hide + cls());
      process.on("SIGINT", () => this.abort());
    }
  }

  setPhase(p: OrchestrationPhase) {
    this.S.phase = p;
    if (p === "manager-planning") this.S.cycle++;
    if (this.isTTY) this.draw();
    else console.log(chalk.dim(`── ${phaseStr(p)} ──`));
  }

  setAgentWorking(h: string, a: Agent) {
    const d = this.S.agents.get(h);
    if (d) { d.st = "working"; d.live = a.live; d.mi = a.modelInfo; d.out = ""; this.S.sel = h; }
    if (this.isTTY) this.draw();
    else if (d) console.log(chalk.dim(`▸ ${d.id.name} (${d.mi.shortName}) working...`));
  }

  setAgentDone(h: string, r: AgentResult) {
    const d = this.S.agents.get(h);
    if (d) {
      d.st = r.success ? "done" : "error";
      d.dur = r.duration; d.cost = r.usage.cost; d.out = r.output;
      this.S.cost += r.usage.cost;
    }
    const w = [...this.S.agents.entries()].find(([_, a]) => a.st === "working");
    if (w) this.S.sel = w[0];
    if (this.isTTY) this.draw();
    else if (d) {
      const ok = r.success ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${ok} ${d.id.name} (${d.mi.shortName}) ${fmtDur(r.duration)} ${fmtCost(r.usage.cost)}`);
    }
  }

  wasAborted() { return this.aborted_; }

  // ── Keyboard ──
  private key(k: string) {
    if (k === "\x03" || k === "\u0003") { this.abort(); return; }
    const h = [...this.S.agents.keys()];
    if (k === "\t") { this.S.sel = h[(h.indexOf(this.S.sel) + 1) % h.length]; this.draw(); return; }
    const n = parseInt(k);
    if (n >= 1 && n <= h.length) { this.S.sel = h[n - 1]; this.draw(); }
  }

  // ── Abort ──
  private abort() {
    if (this.aborted_) return;
    this.aborted_ = true;
    this.stop();
    process.stdout.write(cls());
    console.log(chalk.yellow("\n  Aborted by user."));
    console.log(chalk.dim(`  Cycle ${this.S.cycle}/${this.S.max} | Cost: $${this.S.cost.toFixed(4)}`));
    console.log();
    process.exit(0);
  }

  // ── Draw ──
  private draw() {
    if (!this.isTTY) return;
    this.cols = Math.max(60, process.stdout.columns || 80);
    const rows = process.stdout.rows || 30;
    const L: string[] = [];

    // ASCII header
    L.push("");
    for (const ln of ORC) L.push(chalk.bold.red(ln));
    L.push(chalk.bold("   Multi-Agent Swarm"));
    L.push("");

    // Status bar
    const el = Date.now() - this.S.t0;
    L.push("  " + [
      chalk.bold(`Cycle ${this.S.cycle}/${this.S.max}`),
      chalk.dim("|"), fmtDur(el),
      chalk.dim("|"), chalk.yellow(`$${this.S.cost.toFixed(4)}`),
      chalk.dim("|"), phaseStr(this.S.phase),
    ].join(" "));

    // Agent list
    const handles = [...this.S.agents.keys()];
    const agentCount = handles.length;
    // Lines reserved: header(9) + status(1) + agents(N) + detail_title(2) + footer(2) = ~14+N
    const reservedLines = 14 + agentCount;

    for (let i = 0; i < handles.length; i++) {
      const d = this.S.agents.get(handles[i])!;
      const c = CC[d.id.color];
      const isSel = handles[i] === this.S.sel;

      const marker = isSel ? chalk.bold(c("▸")) : " ";
      const num = chalk.dim(`${i + 1}.`);
      const nm = isSel ? chalk.bold(c(d.id.name.padEnd(18))) : c(d.id.name.padEnd(18));
      const ml = chalk.blue(d.mi.shortName.padEnd(16));

      let st: string;
      if (d.st === "idle") st = chalk.dim("idle");
      else if (d.st === "working") st = chalk.yellow(`${FR[this.fi % FR.length]} working`);
      else if (d.st === "done") st = chalk.green(`✓ ${fmtDur(d.dur)}`);
      else st = chalk.red("✗ error");

      const cost = d.cost > 0 ? " " + chalk.dim(fmtCost(d.cost)) : "";
      L.push(`  ${marker}${num} ${nm} ${ml} ${st}${cost}`);
    }
    L.push("");

    // Detail panel
    const s = this.S.agents.get(this.S.sel);
    if (s) {
      const c = CC[s.id.color];
      const spinOk = s.st === "working" ? chalk.yellow(`${FR[this.fi % FR.length]} `) : s.st === "done" ? chalk.green("✓ ") : "  ";
      const w = Math.min(this.cols - 4, 80);

      L.push(chalk.dim("  " + "─".repeat(w)));
      L.push(`  ${chalk.bold(c(s.id.name))}  ${chalk.blue(s.mi.shortName)}  ${spinOk}`);

      // Tools — collapsed when writing
      const tools = s.live.tools;
      const doneT = tools.filter(t => t.status === "done").length;
      const runT = tools.filter(t => t.status === "running").length;
      const hasText = (s.live.text.length > 80) || (s.out.length > 80);

      if (hasText && doneT > 0 && runT === 0) {
        L.push(chalk.dim(`  ${doneT} tools completed`));
        L.push("");
      } else if (tools.length > 0) {
        for (const t of tools.slice(-3)) {
          const ic = t.status === "running" ? chalk.yellow(`${FR[this.fi % FR.length]} `) :
                     t.status === "done" ? chalk.green("✓ ") : chalk.red("✗ ");
          const dur = t.endTime ? chalk.dim(` ${fmtDur(t.endTime - t.startTime)}`) : "";
          L.push(`    ${ic}${chalk.cyan(t.name.padEnd(8))} ${chalk.dim(fmtTA(t.name, t.args))}${dur}`);
        }
        L.push("");
      }

      // Output text — wrap, no truncation
      const text = s.live.text || s.out || "";
      if (text) {
        const maxOutLines = Math.max(6, rows - reservedLines - 4);
        const rawLines = text.split("\n");
        const showLines = rawLines.slice(-maxOutLines);
        for (const ln of showLines) {
          for (const wl of wrap(ln, this.cols - 4)) {
            L.push("  " + md(wl));
          }
        }
      } else {
        L.push(chalk.dim("  (waiting...)"));
      }

      L.push(chalk.dim("  " + "─".repeat(w)));
    }

    // Footer
    L.push("");
    L.push(chalk.dim(`  [1-${handles.length}] switch  [Tab] next  [Ctrl+C] abort`));

    process.stdout.write(up(this.n) + clr() + L.join("\n"));
    this.n = L.length;
  }

  // ── Final report ──
  printReport(result: OrchestrationResult) {
    this.stop(); process.stdout.write(cls());
    console.log();
    for (const ln of ORC) console.log(chalk.bold.red(ln));
    console.log(chalk.bold("   Multi-Agent Swarm"));
    console.log();
    console.log(chalk.dim("  " + "─".repeat(60)));

    for (const cy of result.cycles) {
      console.log(chalk.bold(`  Cycle ${cy.cycleNumber}`));
      console.log(chalk.dim("  " + "─".repeat(40)));
      const entries: Array<[string, AgentResult]> = [
        ["Manager", cy.manager],
        ...cy.developers.map((d, i) => [`Dev-${i + 1}`, d] as [string, AgentResult]),
        ...cy.scouts.map((s, i) => [`Scout-${i + 1}`, s] as [string, AgentResult]),
        ["Reviewer", cy.reviewer],
      ];
      for (const [l, r] of entries) {
        const ok = r.success ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${l.padEnd(10)} ${ok} ${chalk.dim(fmtDur(r.duration))} ${chalk.dim(fmtCost(r.usage.cost))}`);
      }
      console.log();
    }

    console.log(chalk.dim("  " + "─".repeat(60)));
    console.log(`  Total: ${chalk.bold(fmtDur(result.totalDuration))} | ${chalk.yellow(fmtCost(result.totalCost))} | Cycles: ${result.cycles.length}`);
    console.log();
    console.log(chalk.bold("  Result:"));
    console.log();
    const lines = result.finalOutput.split("\n");
    for (const l of lines.slice(0, 80)) console.log("  " + md(l));
    if (lines.length > 80) console.log(chalk.dim(`  ... +${lines.length - 80} lines`));
    console.log();
  }

  private stop() {
    if (this.si) { clearInterval(this.si); this.si = null; }
    if (this.isTTY) {
      process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write(show);
    }
  }
  dispose() { this.stop(); }
}

// ── Inline helpers ──

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtCost(c: number): string {
  if (c < 0.001) return "";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function phaseStr(p: OrchestrationPhase): string {
  const m: Record<string, string> = {
    initializing: "Initializing...", "manager-planning": "Planning",
    "developers-working": "Developing", "scouts-investigating": "Scouting",
    "reviewer-checking": "Reviewing", "manager-deciding": "Deciding",
    completed: "Complete!", error: "Error",
  };
  return m[p] ?? p;
}

function shortM(ref: string): string {
  const id = ref.split("/").pop() || ref;
  return id.split(/[-_.]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function fmtTA(name: string, a: Record<string, any>): string {
  switch (name) {
    case "bash": return (a.command || "").slice(0, 50);
    case "read": return a.path || a.file_path || "";
    case "write": return a.path || a.file_path || "";
    case "edit": return a.path || a.file_path || "";
    case "grep": return `/${a.pattern || ""}/ ${a.path || ""}`.slice(0, 50);
    default: return JSON.stringify(a).slice(0, 40);
  }
}

function wrap(s: string, maxW: number): string[] {
  if (!s) return [""];
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length <= maxW) return [s];
  const result: string[] = [];
  let remaining = s;
  while (remaining.length > 0) {
    const vRemain = remaining.replace(/\x1b\[[0-9;]*m/g, "");
    if (vRemain.length <= maxW) { result.push(remaining); break; }
    let breakAt = maxW;
    const lastSpace = remaining.lastIndexOf(" ", maxW);
    if (lastSpace > maxW * 0.4) breakAt = lastSpace;
    result.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\s+/, "");
  }
  return result;
}

function md(line: string): string {
  let o = line;
  if (o.startsWith("### ")) o = chalk.bold.cyan(o.slice(4));
  else if (o.startsWith("## ")) o = chalk.bold.yellow(o.slice(3));
  else if (o.startsWith("# ")) o = chalk.bold.red(o.slice(2));
  o = o.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  o = o.replace(/`(.+?)`/g, (_, t) => chalk.cyan(t));
  if (o.match(/^[-*]\s/)) o = chalk.dim("• ") + o.slice(2);
  return o;
}
