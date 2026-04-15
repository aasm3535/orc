/**
 * Workflow engine — cyclic orchestration: Plan → Build → Scout → Review → Decide
 *
 * Each CYCLE is one full pass:
 *   1. Manager: first cycle = plan, later cycles = refine with specific fixes
 *   2. Developers: implement / fix code (have tools: read, write, edit, bash)
 *   3. Scouts: investigate consistency, imports, architecture (read-only)
 *   4. Reviewer: quality review with rating (read-only)
 *   5. Manager: decide DONE or CONTINUE (what to fix next cycle)
 *
 * If DONE → stop. If CONTINUE → next cycle with specific fix instructions.
 */

import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { Agent } from "./agent.js";
import { OrcTUI } from "./tui.js";
import type {
  SwarmConfig, AgentResult, CycleResult, OrchestrationResult, OrchestrationPhase,
} from "./types.js";
import { isCompletionSignal } from "./completion.js";

export class WorkflowEngine {
  private config: SwarmConfig;
  private manager: Agent | null = null;
  private developers: Agent[] = [];
  private scouts: Agent[] = [];
  private reviewer: Agent | null = null;
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private tui: OrcTUI;
  private cycleHistory: CycleResult[] = [];
  private currentCycle = 0;

  constructor(config: SwarmConfig, tui: OrcTUI) {
    this.config = config;
    this.authStorage = AuthStorage.create();
    this.modelRegistry = ModelRegistry.create(this.authStorage);
    this.tui = tui;
  }

  async init(): Promise<void> {
    this.tui.setPhase("initializing");
    try {
      this.manager = new Agent("manager", 0, this.config.manager, this.authStorage, this.modelRegistry);
      await this.manager.init(this.config.cwd);
      for (let i = 0; i < this.config.developer.count; i++) {
        const dev = new Agent("developer", i, this.config.developer, this.authStorage, this.modelRegistry);
        await dev.init(this.config.cwd);
        this.developers.push(dev);
      }
      for (let i = 0; i < this.config.scout.count; i++) {
        const scout = new Agent("scout", i, this.config.scout, this.authStorage, this.modelRegistry);
        await scout.init(this.config.cwd);
        this.scouts.push(scout);
      }
      this.reviewer = new Agent("reviewer", 0, this.config.reviewer, this.authStorage, this.modelRegistry);
      await this.reviewer.init(this.config.cwd);
    } catch (err: any) {
      this.dispose();
      throw err;
    }
  }

  async run(task: string): Promise<OrchestrationResult> {
    const startTime = Date.now();
    let finalOutput = "";
    let shouldContinue = true;

    while (shouldContinue && this.currentCycle < this.config.maxCycles) {
      if (this.tui.wasAborted()) throw new Error("Aborted by user");
      this.currentCycle++;
      const cycleResult = await this.runCycle(task);
      this.cycleHistory.push(cycleResult);
      shouldContinue = cycleResult.shouldContinue;
      if (!shouldContinue) finalOutput = cycleResult.manager.output;
    }

    // Hit max cycles — last manager output is the answer
    if (shouldContinue && this.currentCycle >= this.config.maxCycles) {
      finalOutput = this.cycleHistory[this.cycleHistory.length - 1]!.manager.output;
      this.tui.setPhase("completed");
    }

    const totalCost = this.cycleHistory.reduce(
      (sum, c) => sum + c.manager.usage.cost + c.reviewer.usage.cost +
        c.developers.reduce((s, d) => s + d.usage.cost, 0) +
        c.scouts.reduce((s, sc) => s + sc.usage.cost, 0),
      0,
    );

    return {
      task, cycles: this.cycleHistory, finalOutput,
      totalDuration: Date.now() - startTime, totalCost, success: true,
    };
  }

  // ── Single cycle ──

  private async runCycle(task: string): Promise<CycleResult> {
    const cycleStart = Date.now();
    const isFirst = this.currentCycle === 1;

    // 1) MANAGER — plan (cycle 1) or evaluate+instruct (cycle 2+)
    this.tui.setPhase("manager-planning");
    this.tui.setAgentWorking(this.manager!.handle, this.manager!);

    const managerPrompt = isFirst
      ? this.firstPlanPrompt(task)
      : this.refinePrompt(task);

    const planResult = await this.manager!.prompt(managerPrompt);
    this.tui.setAgentDone(this.manager!.handle, planResult);

    // 2) DEVELOPERS — implement / fix
    this.tui.setPhase("developers-working");
    const devResults = await this.runDevelopers(task, planResult.output);

    // 3) SCOUTS — investigate
    this.tui.setPhase("scouts-investigating");
    const scoutResults = await this.runScouts(task, planResult.output, devResults);

    // 4) REVIEWER — quality check
    this.tui.setPhase("reviewer-checking");
    this.tui.setAgentWorking(this.reviewer!.handle, this.reviewer!);
    const revPrompt = this.reviewerPrompt(task, devResults, scoutResults);
    const revResult = await this.reviewer!.prompt(revPrompt);
    this.tui.setAgentDone(this.reviewer!.handle, revResult);

    // 5) MANAGER — decide: DONE or CONTINUE (with specific next-cycle instructions)
    this.tui.setPhase("manager-deciding");
    this.tui.setAgentWorking(this.manager!.handle, this.manager!);
    const decidePrompt = this.decidePrompt(task, planResult.output, devResults, scoutResults, revResult);
    const decideResult = await this.manager!.prompt(decidePrompt);
    this.tui.setAgentDone(this.manager!.handle, decideResult);

    const shouldContinue = !isCompletionSignal(decideResult.output);
    if (!shouldContinue) this.tui.setPhase("completed");

    return {
      cycleNumber: this.currentCycle,
      manager: decideResult,
      developers: devResults,
      scouts: scoutResults,
      reviewer: revResult,
      shouldContinue,
      duration: Date.now() - cycleStart,
    };
  }

  // ── Prompt builders ──

  /** Cycle 1: Manager creates the initial plan */
  private firstPlanPrompt(task: string): string {
    const devNames = this.developers.map(d => d.identity.name).join(", ");
    const multi = this.config.developer.count > 1
      ? `You have ${this.config.developer.count} developers: ${devNames}. Assign subtasks to specific developers by name.`
      : `You have 1 developer: ${devNames}.`;
    return `## Task\n${task}\n\nCreate an implementation plan. ${multi}\n\nBreak the task into clear numbered steps. For each step specify:\n- What files to create/modify\n- What changes to make\n- Which developer should do it (if multiple)\n\nBe concrete. Vague instructions waste time.`;
  }

  /** Cycle 2+: Manager evaluates previous cycle and gives fix instructions */
  private refinePrompt(task: string): string {
    const last = this.cycleHistory[this.cycleHistory.length - 1]!;
    const devOut = last.developers.map(d => `[${d.role}-${d.agentIndex + 1}]: ${d.output.slice(0, 2000)}`).join("\n\n");
    const scoutOut = last.scouts.map(s => `[${s.role}-${s.agentIndex + 1}]: ${s.output.slice(0, 1500)}`).join("\n\n");
    return `## Original Task\n${task}\n\n## Previous Cycle (cycle ${last.cycleNumber}) Results\n\n### Developers Did\n${devOut}\n\n### Scouts Found\n${scoutOut}\n\n### Reviewer Said\n${last.reviewer.output.slice(0, 2000)}\n\nBased on the review feedback, provide SPECIFIC fix instructions for the developers:\n- Exact files and what to change\n- Exact issues to fix\n- Do NOT repeat work that's already done correctly\n\nOnly include fixes for actual issues. If everything looks good, say the task is complete.`;
  }

  /** Developer prompt — gets the plan and implements */
  private buildDevPrompt(task: string, plan: string, idx: number): string {
    const name = this.developers[idx].identity.name;
    const assigned = this.developers.length > 1
      ? `You are ${name}. Implement ONLY the subtasks assigned to you. If no specific assignment, implement the parts most natural for you.`
      : "Implement the full plan.";
    return `## Task\n${task}\n\n## Plan\n${plan.slice(0, 4000)}\n\n${assigned}\n\nMake actual code changes using your tools. Report what you did and which files you changed.`;
  }

  /** Scout prompt */
  private scoutPrompt(task: string, plan: string, devResults: AgentResult[], idx: number): string {
    const devSummary = devResults.map(r => `[${r.role}-${r.agentIndex + 1}]: ${r.output.slice(0, 2000)}`).join("\n\n");
    const focus = idx === 0 ? "code consistency, missing imports, broken references"
      : idx === 1 ? "test coverage and edge cases"
      : "architecture and dependencies";
    return `## Task\n${task}\n\n## Developers' Output\n${devSummary}\n\nInvestigate the codebase. Focus on: ${focus}.\n\nCheck if developers' changes are consistent with the rest of the codebase. Report findings with exact file paths.`;
  }

  /** Reviewer prompt */
  private reviewerPrompt(task: string, devResults: AgentResult[], scoutResults: AgentResult[]): string {
    const devOut = devResults.map(r => `[${r.role}-${r.agentIndex + 1}]:\n${r.output.slice(0, 2000)}`).join("\n\n");
    const scoutOut = scoutResults.map(r => `[${r.role}-${r.agentIndex + 1}]:\n${r.output.slice(0, 1500)}`).join("\n\n");
    return `## Task\n${task}\n\n## Developers' Code\n${devOut}\n\n## Scouts' Findings\n${scoutOut}\n\nReview the code changes. Give specific feedback with file paths.\n\nRate: **Pass** / **Needs Work** / **Major Issues**\n\nIf Needs Work or Major Issues — list exact fixes needed.`;
  }

  /** Decision prompt — manager decides if we're done */
  private decidePrompt(
    task: string, plan: string,
    devResults: AgentResult[], scoutResults: AgentResult[],
    revResult: AgentResult,
  ): string {
    const devOut = devResults.map(r => `[${r.role}-${r.agentIndex + 1}]: ${r.output.slice(0, 1500)}`).join("\n");
    const scoutOut = scoutResults.map(r => `[${r.role}-${r.agentIndex + 1}]: ${r.output.slice(0, 1000)}`).join("\n");
    return `## Task\n${task}\n\n## Developers Did\n${devOut}\n\n## Scouts Found\n${scoutOut}\n\n## Reviewer Rating\n${revResult.output.slice(0, 2000)}\n\nDecide:\n- If task is COMPLETE and quality is acceptable → respond with **DONE** and a final summary of what was accomplished.\n- If more work is needed → respond with **CONTINUE** and list the specific fixes needed next cycle.\n\nYour decision:`;
  }

  // ── Run agents ──

  private async runDevelopers(task: string, plan: string): Promise<AgentResult[]> {
    for (const dev of this.developers) this.tui.setAgentWorking(dev.handle, dev);

    if (this.developers.length === 1) {
      const result = await this.developers[0].prompt(this.buildDevPrompt(task, plan, 0));
      this.tui.setAgentDone(this.developers[0].handle, result);
      return [result];
    }

    return Promise.all(this.developers.map((dev, i) =>
      dev.prompt(this.buildDevPrompt(task, plan, i)).then(r => {
        this.tui.setAgentDone(dev.handle, r);
        return r;
      })
    ));
  }

  private async runScouts(task: string, plan: string, devResults: AgentResult[]): Promise<AgentResult[]> {
    for (const scout of this.scouts) this.tui.setAgentWorking(scout.handle, scout);

    if (this.scouts.length === 1) {
      const result = await this.scouts[0].prompt(this.scoutPrompt(task, plan, devResults, 0));
      this.tui.setAgentDone(this.scouts[0].handle, result);
      return [result];
    }

    return Promise.all(this.scouts.map((scout, i) =>
      scout.prompt(this.scoutPrompt(task, plan, devResults, i)).then(r => {
        this.tui.setAgentDone(scout.handle, r);
        return r;
      })
    ));
  }

  dispose(): void {
    this.manager?.dispose();
    this.developers.forEach(d => d.dispose());
    this.scouts.forEach(s => s.dispose());
    this.reviewer?.dispose();
  }
}
