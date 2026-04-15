/**
 * Orchestrator - high-level API that ties config, workflow, and TUI display together
 */
import chalk from "chalk";
import { WorkflowEngine } from "./workflow.js";
import { loadConfig, quickStartConfig, initConfig, getAvailableModels, generateConfigYaml, generateSampleConfig } from "./config.js";
import type { SwarmConfig, OrchestrationResult, CycleResult } from "./types.js";
import { AgentInitError } from "./types.js";
import { OrcTUI } from "./tui.js";
import { generateIdentity } from "./names.js";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";




/** Role emoji map */
const ROLE_EMOJI: Record<string, string> = {
  manager: "👑",
  developer: "💻",
  scout: "🔍",
  reviewer: "🔎",
};

/** Role color map */
const ROLE_COLOR: Record<string, (s: string) => string> = {
  manager: chalk.magenta,
  developer: chalk.cyan,
  scout: chalk.green,
  reviewer: chalk.yellow,
};

export class Orchestrator {
  private config: SwarmConfig;
  private engine: WorkflowEngine | null = null;
  private tui: OrcTUI | null = null;

  constructor(config: SwarmConfig) {
    this.config = config;
  }

  /** Run the full swarm orchestration with TUI */
  async run(task: string): Promise<OrchestrationResult> {
    // Create TUI instance
    this.tui = new OrcTUI(this.config, task);

    this.engine = new WorkflowEngine(this.config, this.tui);

    try {
      // Initialize
      await this.engine.init();

      // Run orchestration
      const result = await this.engine.run(task);

      // Print final TUI report
      this.tui.printReport(result);

      return result;
    } catch (err: any) {
      this.tui.setPhase("error");
      if (err instanceof AgentInitError) {
        console.error(chalk.red(`\n✗ Agent initialization failed: ${err.message}`));
        console.error(chalk.dim(`  Role: ${err.role} #${err.index}`));
        if (err.cause) console.error(chalk.dim(`  Cause: ${err.cause.message}`));
      }
      throw err;
    } finally {
      this.engine.dispose();
      this.tui.dispose();
    }
  }

  /** Print the swarm configuration */
  private printConfig(): void {
    const roles = [
      { name: "manager", config: this.config.manager },
      { name: "developer", config: this.config.developer },
      { name: "scout", config: this.config.scout },
      { name: "reviewer", config: this.config.reviewer },
    ];

    console.log(chalk.dim(" Agents:"));
    for (const { name, config } of roles) {
      const emoji = ROLE_EMOJI[name];
      const color = ROLE_COLOR[name];
      const count = config.count > 1 ? ` ×${config.count}` : "";
      const thinking = config.thinkingLevel && config.thinkingLevel !== "off"
        ? chalk.dim(` [${config.thinkingLevel}]`)
        : "";
      console.log(` ${emoji} ${color(name.padEnd(10))} ${chalk.dim(config.model)}${count}${thinking}`);
    }
    console.log(chalk.dim(` Max cycles: ${this.config.maxCycles}`));
    console.log();
  }

  /** List available models from Pi setup */
  static async listModels(): Promise<void> {
    const models = await getAvailableModels();
    console.log();
    console.log(chalk.bold(" Your available models:"));
    console.log();

    if (models.length === 0) {
      console.log(chalk.yellow(" No models found. Add API keys via:"));
      console.log(chalk.dim(" pi --login"));
      console.log(chalk.dim(" Or edit ~/.pi/agent/auth.json"));
      console.log();
      return;
    }

    // Group by provider
    const byProvider = new Map<string, typeof models>();
    for (const m of models) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }

    for (const [provider, pModels] of byProvider) {
      console.log(chalk.magenta(` ${provider}:`));
      for (const m of pModels) {
        const thinkBadge = m.reasoning ? chalk.dim(" [thinking]") : "";
        console.log(`   ${chalk.cyan(m.ref)} ${chalk.dim(`(${m.name})`)}${thinkBadge}`);
      }
      console.log();
    }

    console.log(chalk.dim(' Use provider/model-id format in orc.yml (e.g. "google/gemma-4-31b-it")'));
    console.log();

    // Show sample agent names for this swarm
    console.log(chalk.dim("  ── Sample swarm team ─────────────────────────────────"));
    const sample = [
      generateIdentity("manager", 0),
      generateIdentity("developer", 0),
      generateIdentity("developer", 1),
      generateIdentity("scout", 0),
      generateIdentity("reviewer", 0),
    ];
    for (const id of sample) {
      const colorFn = id.color === "magenta" ? chalk.magenta : id.color === "cyan" ? chalk.cyan : id.color === "green" ? chalk.green : id.color === "red" ? chalk.red : id.color === "blue" ? chalk.blue : chalk.yellow;
      console.log(`  ${colorFn(id.name)} ${chalk.dim(`[${id.role}]`)}`);
    }
    console.log();
  }

  /** Interactive config init */
  static async init(targetPath: string): Promise<void> {
    await initConfig(targetPath);
  }

  /** Generate a sample orc.yml using the user's first available model */
  static async generateConfig(targetPath?: string, force?: boolean): Promise<void> {
    const outputPath = targetPath ?? "orc.yml";
    if (fs.existsSync(outputPath) && !force) {
      console.log(chalk.yellow(` ${outputPath} already exists. Use --force to overwrite, or "orc init" for interactive setup.`));
      return;
    }

    const content = await generateSampleConfig();
    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(chalk.green(` ✅ Generated ${outputPath}`));
    console.log();

    // Show sample agent names
    console.log(chalk.dim("  Your swarm team:"));
    const names = [
      generateIdentity("manager", 0),
      generateIdentity("developer", 0),
      generateIdentity("developer", 1),
      generateIdentity("scout", 0),
      generateIdentity("reviewer", 0),
    ];
    for (const id of names) {
      const colorFn = id.color === "magenta" ? chalk.magenta : id.color === "cyan" ? chalk.cyan : id.color === "green" ? chalk.green : id.color === "red" ? chalk.red : id.color === "blue" ? chalk.blue : chalk.yellow;
      console.log(`  ${colorFn(id.name)} ${chalk.dim(`[${id.role}]`)}`);
    }
    console.log();
    console.log(chalk.dim('  Edit the file to customize models per role, then: orc run "your task"'));
    console.log();
  }
}
