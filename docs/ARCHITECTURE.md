# Orc Architecture Documentation

## Overview

Orc is a **multi-agent orchestration system** that coordinates specialized AI agents to collaboratively complete software development tasks. The architecture follows a **swarm intelligence pattern** where agents with different roles iterate through a cyclic workflow until the task is complete.

---

## Core Components

### 1. Type System (`types.ts`)

The type system defines the structural contracts for all entities in the swarm.

#### Agent Roles

```typescript
type AgentRole = "manager" | "developer" | "scout" | "reviewer";
```

Each role has specific responsibilities in the workflow:
- **Manager**: Plans, delegates, and decides when work is complete
- **Developer**: Implements code changes
- **Scout**: Investigates codebase and verifies changes
- **Reviewer**: Assesses code quality and correctness

#### Configuration Hierarchy

```
SwarmConfig (root)
├── cwd: string                    // Working directory
├── maxCycles: number              // Maximum iterations
├── contextLimits: {               // Token budget per role
│   ├── managerOutput: 2000
│   ├── developerOutput: 2000
│   ├── scoutOutput: 1500
│   ├── reviewerOutput: 2000
│   └── planLength: 3000
│   }
├── retry: RetryConfig            // Failure recovery
├── manager: RoleConfig
├── developer: RoleConfig
├── scout: RoleConfig
└── reviewer: RoleConfig
```

#### Role Configuration (`RoleConfig`)

Each role is configured with:

| Field | Type | Description |
|-------|------|-------------|
| `model` | `ModelRef` | Provider/model-id (e.g., `google/gemma-4-31b-it`) |
| `count` | `number` | Number of parallel agents (default: 1) |
| `systemPrompt` | `string?` | Override prompt inline |
| `systemPromptFile` | `string?` | Path to `.md` prompt file |
| `tools` | `string[]?` | Tool whitelist (coding vs read-only) |
| `thinkingLevel` | `enum?` | Reasoning depth: `off` → `xhigh` |

#### Result Types

Execution produces a typed trace:

```
OrchestrationResult
├── task: string
├── cycles: CycleResult[]
├── finalOutput: string
├── totalDuration: number
├── totalCost: number
└── success: boolean

CycleResult
├── cycleNumber: number
├── manager: AgentResult
├── developers: AgentResult[]
├── scouts: AgentResult[]
├── reviewer: AgentResult
├── shouldContinue: boolean
└── duration: number

AgentResult
├── role: AgentRole
├── agentIndex: number
├── output: string
├── usage: { input, output, cacheRead, cacheWrite, totalTokens, cost }
├── duration: number
├── success: boolean
└── error?: string
```

#### Orchestration Phases

```typescript
type OrchestrationPhase = 
  | "initializing"           // Agent sessions created
  | "manager-planning"       // Manager creates/updates plan
  | "developers-working"     // Developers write code
  | "scouts-investigating"   // Scouts verify changes
  | "reviewer-checking"      // QA assessment
  | "manager-deciding"       // Continue or DONE
  | "completed"              // Task finished
  | "error";                 // Failure state
```

---

### 2. Agent Lifecycle (`agent.ts`)

The `Agent` class is a **wrapper around Pi SDK's `AgentSession`**, managing the lifecycle of a single agent instance.

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Agent                                │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Identity   │  │ Model Info  │  │   Live State    │ │
│  │  (names)    │  │  (config)   │  │    (tui.ts)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐│
│  │           AgentSession (Pi SDK)                     ││
│  │  • sendMessage()                                   ││
│  │  • subscribe() (streaming events)                  ││
│  │  • tool execution                                  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

#### Initialization Flow

```typescript
async init(cwd: string): Promise<void>
```

1. **Model Resolution**:
   - Parse `provider/model-id` format
   - Query `ModelRegistry` for exact match
   - Fallback to fuzzy matching if needed

2. **Prompt Loading**:
   - Priority: `systemPrompt` > `systemPromptFile` > `getSystemPromptForRole()`
   - Async file loading with `node:fs/promises`

3. **Tool Selection**:
   ```typescript
   private resolveTools(cwd: string): Tool[] {
     if (!this.config.tools) {
       return this.role === "developer" 
         ? createCodingTools(cwd)      // edit, write, bash
         : createReadOnlyTools(cwd);   // read, grep, search
     }
     // Infer from explicit tool list
     const hasEditTools = this.config.tools.some(t => 
       ["edit", "write", "bash"].includes(t)
     );
     return hasEditTools 
       ? createCodingTools(cwd) 
       : createReadOnlyTools(cwd);
   }
   ```

4. **Session Creation**:
   - `AuthStorage` for credentials
   - `ResourceLoader` with system prompt override
   - `SessionManager.inMemory()` for state
   - `SettingsManager.inMemory()` for compaction/retry

#### Streaming Architecture

```typescript
async prompt(text: string): Promise<AgentResult>
```

The agent subscribes to Pi SDK events:

```typescript
session.subscribe((event: AgentSessionEvent) => {
  switch (event.type) {
    case "message_update":      // Text delta streaming
      this.output += delta;
      this.live.text += delta;    // Real-time TUI update
      break;
      
    case "tool_execution_start":
      this.live.tools.push({     // Track active tools
        name: event.toolName,
        args: event.args,
        status: "running",
        startTime: Date.now()
      });
      break;
      
    case "tool_execution_end":
      // Mark tool as done/error
      this.live.tools[idx].status = event.isError ? "error" : "done";
      this.live.tools[idx].endTime = Date.now();
      break;
      
    case "message_end":         // Token usage accounting
      this.totalUsage.input += event.message.usage.input;
      // ... other counters
      break;
  }
});
```

#### Identity Generation

Each agent receives a unique, memorable identity from `generateIdentity(role, index)`:
- **Manager**: Semantic names ("Руководитель", "_ORCHESTRATOR")
- **Developer**: Distinguishable handles ("Кодер-0", "dev-0")
- **Scout**: Recon-themed names ("Разведчик", "scout-0")
- **Reviewer**: Validation-themed names ("Проверяющий", "reviewer-0")

---

### 3. Workflow Engine (`workflow.ts`)

The `WorkflowEngine` orchestrates the cyclic execution of agents through a **5-phase pipeline**.

#### Cycle Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                         CYCLE N                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │
│  │  Manager    │───▶│ Developers  │───▶│     Scouts      │   │
│  │  Planning   │    │  Working    │    │ Investigating   │   │
│                   │   Deciding  │◀── (shouldContinue?)         │
│                   └─────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

#### Phase Details

| Phase | Method | Agents | Parallel | Description |
|-------|--------|--------|----------|-------------|
| **1. Manager Planning** | `runCycle()` | 1 | No | Creates initial plan or evaluates previous cycle |
| **2. Developers Working** | `runDevelopers()` | N | Yes | Implements code changes per subtask |
| **3. Scouts Investigating** | `runScouts()` | N | Yes | Verifies consistency, finds issues |
| **4. Reviewer Checking** | `runAgent()` | 1 | No | Quality assessment with rating |
| **5. Manager Deciding** | `runAgent()` | 1 | No | Outputs **DONE** or continues |

#### Parallel Execution

Developers and Scouts run in parallel using `Promise.all()`:

```typescript
// Multiple developers - run in parallel
const results = await Promise.all(
  this.developers.map((dev, i) => {
    return dev.prompt(prompts[i]).then((result) => {
      this.tui.setAgentDone(dev.handle, result);
      return result;
    });
  })
);
```

Each parallel agent receives a role-specific prompt that includes:
- Original task context
- Manager's plan (truncated to `contextLimits`)
- Identity assignment (`You are ${devName}`)
- Focus area for scouts (by index: consistency, tests, architecture)

#### DONE Signal Detection

The manager's output is analyzed to determine completion:

```typescript
private containsDoneSignal(output: string): boolean
```

**Pattern Matching Strategy** (case-insensitive):

1. **Explicit Markers**:
   - `**DONE**`, `## DONE`, `# DONE`
   - `[DONE]`, `(DONE)`, `DONE:`
   - `TASK COMPLETE`, `IMPLEMENTATION COMPLETE`
   - `FINAL SUMMARY`, `COMPLETED SUCCESSFULLY`

2. **Decision Patterns**:
   - `DECISION: DONE`, `STATUS: DONE`
   - `VERDICT: COMPLETE`, `CONCLUSION: COMPLETE`

3. **Quality-Based Detection** (`qualityIndicatesCompletion()`):
   - **Must have**: `QUALITY RATING: PASS`, `APPROVED`, or `NO MAJOR ISSUES`
   - **Must NOT have**: `NEEDS WORK`, `MAJOR ISSUES`, `REJECTED`
   - **Must NOT have**: `MORE WORK NEEDED`, `CONTINUE NEXT CYCLE`

The cycle terminates when `shouldContinue = false` (i.e., `containsDoneSignal()` returns `true`).

---

### 4. Prompt System (`prompts.ts`)

The prompt system provides **structured system prompts** for each agent role, defining their responsibilities, constraints, and output formats.

#### Prompt Selection

```typescript
export function getSystemPromptForRole(role: AgentRole, index: number): string {
  switch (role) {
    case "manager":    return MANAGER_PROMPT;
    case "developer":  return developerPrompt(index);  // Dynamic
    case "scout":      return SCOUT_PROMPT;
    case "reviewer":   return REVIEWER_PROMPT;
    default: return "You are a helpful assistant.";
  }
}
```

#### Role Prompts Overview

| Role | Purpose | Tool Access | Output Format |
|------|---------|-------------|---------------|
| **Manager** | Planning & decision | Read-only | Plan/Assessment with explicit DONE |
| **Developer** | Implementation | Coding (edit, write, bash) | Completed/Files Changed/Issues |
| **Scout** | Investigation | Read-only | Findings/Key Code/Architecture/Issues |
| **Reviewer** | Quality assurance | Read-only | Critical/Warnings/Suggestions/Quality Rating |

#### Input/Output Contracts

**Manager (Two Modes)**:

*First Cycle (Planning)*:
```
## Plan
1. [Dev-1] Subtask description
2. [Dev-2] Subtask description (if multiple)

## Subtask Details
- Files to create/modify
- Key changes needed
- Dependencies on other subtasks
```

*Subsequent Cycles (Evaluation)*:
```
## Progress Assessment
- What was accomplished
- What still needs work
- Issues found by reviewer

## Decision
- **CONTINUE**: Explain what needs to be done
- **DONE**: Summarize the final result

## Next Steps (if CONTINUE)
Specific instructions for each role
```

**Developer (by Index)**:
```
## Completed
What was implemented

## Files Changed
- `path/to/file` - what changed and why

## Issues Encountered (if any)
- Description of any blockers

## Notes for Reviewer
Specific areas that need careful review
```

**Scout**:
```
## Findings
1. `path/to/file` (lines X-Y) - Description

## Key Code
Critical code snippets that are relevant

## Architecture Notes
How the changed code fits into broader architecture

## Issues Found
- Any inconsistencies, missing imports, broken references

## Start Here
Which file to look at first and why
```

**Reviewer**:
```
## Files Reviewed
- `path/to/file` (lines X-Y)

## Critical (must fix)
- `file.ts:42` - Issue description

## Warnings (should fix)
- `file.ts:100` - Issue description

## Suggestions (consider)
- `file.ts:150` - Improvement idea

## Quality Rating
- **Pass**: Ready to ship
- **Needs Work**: Has issues that must be fixed
- **Major Issues**: Fundamental problems

## Summary
2-3 sentence overall assessment
```

#### Prompt Design Principles

1. **Structured Output**: Clear headings make parsing easier for downstream agents
2. **Actionable Instructions**: Vague feedback wastes agent turns
3. **Context Limits**: All prompts include truncation reminders (e.g., `slice(0, 2000)`)
4. **Role Clarity**: Each prompt explicitly states "You are a **Role**"
5. **Constraint Enforcement**: Reviewer explicitly reminded — "Do NOT modify files"

---

### 5. Name Generator (`names.ts`)

The name generator provides **deterministic, memorable identities** for each agent in the swarm, making logs and the TUI more human-readable.

#### Pool Structure

```typescript
const FIRST_NAMES = [
  "Alex", "Jordan", "Sam", "Casey", "Riley", "Morgan", ... // 40 names
];

const LAST_NAMES: Record<string, string[]> = {
  manager: ["Chief", "Atlas", "Oracle", "Lead", "Helm", "Rex", "Boss", "North"],
  developer: ["Builder", "Craft", "Forge", "Spark", "Byte", "Logic", "Hacker", "Code"],
  scout: ["Hawk", "Trail", "Echo", "Flare", "Scout", "Flash", "Dart", "Fox"],
  reviewer: ["Judge", "Watch", "Eye", "Guard", "Audit", "Knox", "Sharp", "Vett"],
};
```

**Theming by Role**: Last names are themed for each role:
- **Manager**: Authority-themed (`Chief`, `Atlas`, `Oracle`)
- **Developer**: Building-themed (`Builder`, `Forge`, `Byte`)
- **Scout**: Reconnaissance-themed (`Hawk`, `Trail`, `Fox`)
- **Reviewer**: Validation-themed (`Judge`, `Watch`, `Audit`)

#### Hash Function (`hashStr`)

Uses a **DJB-like 32-bit hash** for deterministic selection:

```typescript
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
```

This ensures the same `(role, index)` pair always generates the same identity across runs.

#### Identity Generation (`generateIdentity`)

```typescript
export interface AgentIdentity {
  name: string;      // "Alex Atlas" (display name)
  handle: string;    // "alex-atlas" (TUI selector key)
  role: string;      // "manager", "developer", etc.
  emoji: string;     // "M", "D", "S", "R"
  color: "magenta" | "cyan" | "green" | "yellow";
}
```

**Selection Algorithm**:
1. Hash the seed string `"${role}:${index}:orc"`
2. First name = `FIRST_NAMES[hash % 40]`
3. Last name = `LAST_NAMES[role][(hash >> 8) % 8]`
4. Derive `handle` from lowercase first-last combination

**Color Assignment**:
| Role | Color | Emoji |
|------|-------|-------|
| Manager | `magenta` | M |
| Developer | `cyan` | D |
| Scout | `green` | S |
| Reviewer | `yellow` | R |

---

### 6. Live State (`live.ts`)

Live state provides **per-agent tool tracking and streaming text capture** for real-time TUI visualization.

#### Tool Call Interface

```typescript
export type ToolStatus = "running" | "done" | "error";

export interface ToolCall {
  name: string;              // "bash", "read", "edit"
  args: Record<string, any>; // Tool arguments
  status: ToolStatus;
  startTime: number;         // Unix timestamp (ms)
  endTime?: number;          // Set on completion
  output?: string;           // Tool output (captured for display)
}
```

**Tool Lifecycle**:
1. Agent calls tool → `status: "running"`, `startTime` set
2. Tool completes → `status: "done"`, `endTime` set
3. Error occurs → `status: "error"`, `endTime` set

#### Agent Live State

```typescript
export interface AgentLiveState {
  text: string;              // Current streaming output
  tools: ToolCall[];         // Active/completed tool calls
  activeToolIndex: number;   // Which tool is currently selected (-1 if none)
}
```

**Usage Pattern**:

```typescript
// Create fresh state for each agent
const live = createLiveState(); // { text: "", tools: [], activeToolIndex: -1 }

// Agent streams text → update live.text
// Agent calls tool → push to live.tools
// Tool completes → update status in place
```

The `AgentLiveState` is polled by `OrcTUI` at 100ms intervals during `draw()` to reflect:
- Streaming text deltas from LLM responses
- Active tool execution status with elapsed time
- Tool argument previews (truncated for display)

---

### 7. TUI Renderer (`tui.ts`)

The `OrcTUI` class implements a **clean, responsive terminal UI** with ASCII art header, agent roster, detail panels, and keyboard navigation.

#### Architecture Overview

```
┌─────────────────────────────────────────┐
│  ASCII Header (Orc logo)                │
├─────────────────────────────────────────┤
│  Status Bar                             │
│  Cycle 1/5 | 45s | $0.0034 | Planning   │
├─────────────────────────────────────────┤
│  Agent Roster                           │
│  >1 M Alex Atlas [manager]   GPT-4o ✓   │
│   2 D Sam Byte   [dev]      Kimi ● wrk..│
│   3 S Casey Hawk [scout]    GLM idle    │
├─────────────────────────────────────────┤
│  Detail Panel (selected agent)          │
│  ─ Alex Atlas ─ GPT-4o ─────────────────│
│  Tools:                                 │
│  ✓ read src/types.ts                    │
│  ● bash npm test                        │
│                                         │
│  ## Plan                                │
│  I'll analyze the codebase...           │
└─────────────────────────────────────────┘
│  Footer: [1-5] agent | [Tab] next       │
└─────────────────────────────────────────┘
```

#### ANSI Escape Sequences

Core escape codes for terminal manipulation:

```typescript
const CSI = "\x1b[";        // Control Sequence Introducer
const hide = "\x1b[?25l";  // Hide cursor (prevents flicker)
const show = "\x1b[?25h";  // Show cursor (on exit)
const clearDown = "\x1b[0J";  // Clear from cursor to end
const clearScreen = "\x1b[2J\x1b[H";  // Full clear + home
```

The TUI uses **delta rendering** with cursor positioning rather than clearing the entire screen each frame, which prevents flicker.

#### Adaptive Layout

The layout adapts to terminal width (`process.stdout.columns`):

```typescript
private draw() {
  this.cols = Math.max(60, process.stdout.columns || 80);
  // Panels scale to fit: detailW = min(cols - 4, 72)
}
```

**Responsive Behaviors**:
- Below 60 columns: Clamped to minimum (ellipses on overflow)
- Above 72 columns: Capped at 72 for readability (optimal line length)
- Text truncation: "..." appended, preserving context

#### Agent Roster Panel

```
 M Alex Atlas  [manager]   GPT-4o      ✓ 12s
 D Sam Byte    [developer] Kimi K2.5   ● working  ⏵
 D Drew Forge  [developer] Kimi K2.5   idle
 S Kai Fox     [scout]     GLM 4.7     idle
 R Sage Knox   [reviewer]  Minimax 2.7 idle
```

Each row displays:
| Field | Description |
|-------|-------------|
| `M/D/S/R` | Role emoji (color-coded) |
| Name | Full name from `generateIdentity()` |
| `[role]` | Role label |
| Model | Short model name (e.g., "GPT-4o") |
| Status | `idle`, `⠋ working` (spinner), `✓ 12s`, or `✗ error` |
| Cost | `$0.0012` (if > 0) |

**Selection**: `>` (inverse video) indicates selected agent; detail panel shows their output.

#### Detail Panel

Shows streaming state of selected agent:

```
── Alex Atlas ── GPT-4o ──────────────
│ Tools:
│ ✓ read src/agent.ts
│ ● bash ls src/
│
│ ## Plan
│ I'll analyze the codebase...
─────────────────────────────────────
```

**Components**:
- **Title Line**: Emoji + colored name + model + status indicator (`✓` or `●`)
- **Tools Section**: Last 5 tool calls with status icons
- **Output Section**: Last N lines of text (adapts to terminal height)

#### Spinner Animation

```typescript
const FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

setInterval(() => {
  fi++; // Advance spinner frame
  this.draw();
}, 100);
```

The spinner uses **Braille pattern characters** for a smooth, high-resolution animation that indicates "working" status.

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| `1-5` | Jump to agent by roster position |
| `Tab` (or `9`) | Cycle to next agent |
| `Ctrl+C` | Abort (handled by orchestrator) |

**Implementation**:

```typescript
private key(k: string) {
  if (k === "\t" || k === "9") {
    // Tab key: cycle selection
    const h = [...this.S.agents.keys()];
    this.S.sel = h[(h.indexOf(this.S.sel) + 1) % h.length];
    this.draw();
  }
  const n = parseInt(k);
  if (n >= 1 && n <= [...this.S.agents.keys()].length) {
    // Number key: direct select
    this.S.sel = [...this.S.agents.keys()][n - 1];
    this.draw();
  }
}
```

#### Final Report (`printReport`)

When the task completes, a **static final report** replaces the live UI:

```
 ___ ____ ___ 
 / _ \| _ \_ _|
| (_) | |_) | |
 \___/|____/___|
 Multi-Agent Swarm

────────────────────────────────────────
 Cycle 1
 ────────────────────────────────────
 M Manager ✓ 45s $0.0012
 D Dev-1   ✓ 38s $0.0008
 S Scout-1 ✓ 12s $0.0002
 R Reviewer ✓ 8s $0.0001

────────────────────────────────────────
 Total: 2m 15s | $0.0123 | Cycles: 3

 Result:

 ### Summary
 Successfully implemented the user feature...
```

**Report includes**:
- Cycle-by-cycle agent results with success/failure icons
- Duration and cost per agent
- Final output (truncated to 50 lines with "... +N lines" indicator)
- Total wall time and aggregated cost

#### Markdown Line Rendering

Minimal inline formatting for LLM output:

```typescript
function mdLine(line: string): string {
  if (line.startsWith("### ")) return chalk.bold.cyan(line.slice(4));
  if (line.startsWith("## ")) return chalk.bold.yellow(line.slice(3));
  if (line.startsWith("# ")) return chalk.bold.red(line.slice(2));
  line = line.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  line = line.replace(/`(.+?)`/g, (_, t) => chalk.cyan(t));
  if (line.match(/^[-*]\s/)) line = chalk.dim("• ") + line.slice(2);
  return line;
}
```

**Supported**: Headers (`#`, `##`, `###`), bold (`**text**`), code (`` `text` ``), bullet lists.

---

## Data Flow Summary

```
User Task
    │
    ▼
┌─────────────────┐
│ WorkflowEngine  │──► create Agents with config
│     .init()     │    (manager, devs, scouts, reviewer)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   run(task)     │◄── cycle loop (maxCycles)
└────────┬────────┘
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
 Manager   Devs     Scouts  Reviewer  Manager
 Plan     Implement Verify   Review   Decide
    │         │        │        │        │
    │         └────┬───┘        │        │
    │              │            │        │
    └──────────────┴──┬────────┘        │
                       ▼                 │
              ┌──────────────┐            │
              │ containsDoneSignal()      │
              └───────┬──────┘           │
                      │ shouldContinue    │
                      ▼                   │
              ┌──────────────┐            │
              │ CycleResult  │────────────┘
              └──────────────┘
                      │
                      ▼
              ┌──────────────┐
              │Cycles[]      │
              └──────┬───────┘
                     ▼
              ┌──────────────┐
              │Orchestration │──► finalOutput
              │   Result     │
              └──────────────┘
```

## File Structure

```
src/
├── types.ts      # Data contracts (AgentRole, SwarmConfig, *Result)
├── agent.ts      # Agent wrapper (Pi SDK lifecycle + streaming)
├── workflow.ts   # 5-phase orchestration engine
├── prompts.ts    # System prompts for 4 roles
├── names.ts      # Identity generator
├── config.ts     # YAML configuration loading
├── tui
