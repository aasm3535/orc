<div align="center">

```
   ____  _____   _____
  / __ \|  __ \ / ____|
 | |  | | |__) | |
 | |  | |  _  /| |
 | |__| | | \ \| |____
  \____/|_|  \_\\_____|
```

# Orc

**Multi-Agent Swarm Orchestrator**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.5+-3178c6.svg)](https://www.typescriptlang.org/)

Coordinate a swarm of AI agents — a Manager, Developers, Scouts, and a Reviewer —
that plan, build, verify, and iterate on tasks autonomously.

Built on the [Pi SDK](https://github.com/badlogic/pi-mono).

</div>

---

## How It Works

```
┌──────────────────────────────────────────────────┐
│                  CYCLE N                          │
│                                                   │
│  1. Manager  ──►  Plan / Refine instructions      │
│                                                   │
│  2. Developers ──►  Implement code changes         │
│        (read, write, edit, bash)                  │
│                                                   │
│  3. Scouts  ──►  Investigate consistency          │
│        (read-only exploration)                    │
│                                                   │
│  4. Reviewer ──►  Quality review + rating         │
│        (read-only analysis)                       │
│                                                   │
│  5. Manager  ──►  DONE or CONTINUE               │
│                                                   │
└──────────────────────────────────────────────────┘

If CONTINUE → next cycle with specific fix instructions.
If DONE     → final summary delivered.
```

Each cycle is a full loop. On the first cycle the Manager plans. On subsequent
cycles the Manager gets the review feedback and gives **specific fix instructions** —
developers don't redo work from scratch, they only fix what's broken.

## Install

### One-liner (Linux / macOS)

```bash
curl -fsSL https://github.com/aasm3535/orc/raw/master/install.sh | sh
```

### PowerShell (Windows)

```powershell
irm https://github.com/aasm3535/orc/raw/master/install.ps1 | iex
```

### npm

```bash
npm install -g orc
```

### From source

```bash
git clone https://github.com/aasm3535/orc.git
cd orc
npm install && npm run build
node dist/index.js run "your task"
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# See your available models (from Pi config)
node dist/index.js models

# One-shot run with auto-config (first available model for all roles)
node dist/index.js run "Create a REST API in Express"

# Interactive setup — pick models per role, saves orc.yml
node dist/index.js init

# Run with orc.yml config (different models per role)
node dist/index.js run "Refactor the auth module"
```

## Configuration

`orc.yml` — one file, all the power:

```yaml
cwd: .
max_cycles: 3

manager:
  model: fireworks/accounts/fireworks/models/glm-5p1
  thinking_level: medium

developer:
  model: nvidia-nim/moonshotai/kimi-k2.5
  count: 2
  thinking_level: off

scout:
  model: nvidia-nim/z-ai/glm4.7
  count: 1
  thinking_level: off

reviewer:
  model: nvidia-nim/minimaxai/minimax-m2.7
  thinking_level: low
```

Run `orc models` to see what's available in your Pi setup. Use `orc init` for an
interactive wizard that generates this file for you.

## Architecture

```
src/
├── agent.ts          # Pi AgentSession wrapper — identity, live state, tools
├── config.ts         # YAML loader + interactive init + model picker
├── names.ts          # Deterministic English name + color generator
├── prompts.ts        # System prompts per role (Manager/Dev/Scout/Reviewer)
├── live.ts           # Real-time agent state for TUI streaming
├── workflow.ts       # Cyclic orchestration engine (the loop)
├── tui.ts            # Terminal UI — ASCII header, agent roster, streaming
├── orchestrator.ts   # High-level API connecting config → workflow → TUI
├── types.ts          # SwarmConfig, AgentResult, CycleResult types
├── completion.ts     # DONE/CONTINUE signal detection
└── index.ts          # CLI entry point (commander)
```

### Agent Roles

| Role        | Tools              | Job                                    |
|-------------|--------------------|----------------------------------------|
| **Manager**   | read-only          | Plan, delegate, evaluate, decide       |
| **Developer** | read + write + edit + bash | Implement code, fix bugs        |
| **Scout**     | read-only          | Investigate consistency, imports, arch |
| **Reviewer**  | read-only + test run | Quality review, rating, specific fixes |

### Multi-Developer

Set `count: 2` (or more) on developers. The Manager assigns subtasks to each
developer by name — they run in parallel and report independently.

## TUI

Interactive terminal UI with live streaming:

- **Agent roster** — color-coded names, model, status (idle / working / done)
- **Detail panel** — streaming output, tool calls, markdown rendering
- **Tool collapsing** — when an agent starts writing its answer, tools collapse
  to a compact summary (`3 tools completed`)
- **Keyboard** — `[1-4]` switch agent, `[Tab]` next, `[Ctrl+C]` abort

```
   ____  _____   _____
  / __ \|  __ \ / ____|
 | |  | | |__) | |
 | |  | |  _  /| |
 | |__| | | \ \| |____
  \____/|_|  \_\\_____|
   Multi-Agent Swarm

  Cycle 1/3 | 45s | $0.0032 | Planning

  ▸1. Mika Prime     GLM 5.1       ⠸ working
   2. Robin Code     Kimi K2.5     idle
   3. Robin Trail    GLM 4.7       idle
   4. Noa Watch      Minimax 2.7   idle

  ────────────────────────────────────────────
  Mika Prime  GLM 5.1  ⠸
  3 tools completed

  ## Plan
  I'll start by exploring the project structure and reading the relevant
  files to understand the codebase. Then I'll create a detailed
  implementation plan that assigns subtasks to each developer...
  ────────────────────────────────────────────

  [1-4] switch  [Tab] next  [Ctrl+C] abort
```

## CLI Reference

```
orc run <task>           Run a task with the swarm
  -q, --quick            Auto-config (first available model)
  --cwd <dir>            Project directory (default: .)

orc init                 Interactive setup — pick models per role

orc models               List available models from Pi config

orc generate             Generate sample orc.yml with default model

orc help                 Show help
```

## Requirements

- **Node.js** 18+
- **Pi** configured with API keys — [setup guide](https://github.com/badlogic/pi-mono#api-keys)
- Models registered in `~/.pi/agent/auth.json`

## Development

```bash
npm install          # install deps
npm run build        # compile TypeScript
npm run dev          # run with tsx (no build needed)
```

## License

[MIT](LICENSE)
