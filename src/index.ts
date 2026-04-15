#!/usr/bin/env node

/**
 * Orc - Multi-agent swarm CLI
 * Usage:
 *   orc init [path]          — interactive setup, pick models from your Pi config
 *   orc models                — list your available models
 *   orc generate [path]       — generate orc.yml with your first available model
 *   orc run [options] "task"  — run the swarm with orc.yml
 *   orc run -q "task"         — quick start, auto-pick first available model
 */

import { Command } from "commander";
import chalk from "chalk";
import { Orchestrator } from "./orchestrator.js";
import { loadConfig, loadAndValidateConfig, quickStartConfig } from "./config.js";
import { ConfigValidationError, AgentInitError } from "./types.js";

const program = new Command();

program
  .name("orc")
  .description("🐙 Orc - Multi-Agent Swarm Orchestrator")
  .version(require("../package.json").version || "0.1.0");

program
  .command("init")
  .description("Interactive setup: pick models from your Pi config")
  .argument("[path]", "config file path", "orc.yml")
  .action(async (targetPath: string) => {
    await Orchestrator.init(targetPath);
  });

program
  .command("models")
  .description("List your available models from Pi config")
  .action(async () => {
    await Orchestrator.listModels();
  });

program
  .command("generate")
  .description("Generate orc.yml with your first available model")
  .argument("[path]", "config file path", "orc.yml")
  .option("-f, --force", "overwrite existing config file")
  .action(async (targetPath: string, options: { force?: boolean }) => {
    await Orchestrator.generateConfig(targetPath, options.force ?? false);
  });

program
  .command("run")
  .description("Run the swarm with a task description")
  .argument("<task...>", "task description to execute")
  .option("-c, --config <path>", "config file path", "orc.yml")
  .option("-q, --quick", "quick start, auto-pick first available model")
  .option("--cwd <path>", "working directory override")
  .action(async (taskArgs: string[], options: { config?: string; quick?: boolean; cwd?: string }) => {
    const task = taskArgs.join(" ").trim();
    
    if (!task) {
      console.log(chalk.red("✗ Error: No task specified."));
      console.log();
      console.log(chalk.dim('Usage: orc run "your task here"'));
      console.log(chalk.dim('       orc run -q "your task"'));
      process.exit(1);
    }

    let config;
    if (options.quick) {
      config = await quickStartConfig(options.cwd);
    } else {
      const configPath = options.config ?? "orc.yml";
      try {
      config = loadAndValidateConfig(configPath);
        if (options.cwd) config.cwd = options.cwd;
      } catch (err: any) {
        if (err instanceof ConfigValidationError) {
          console.log(chalk.red(`✗ Config validation failed:`));
          for (const e of err.errors) {
            console.log(chalk.red(`  ${e.path}: ${e.message}`));
          }
          console.log();
          console.log(chalk.dim('Fix the errors in your orc.yml, or run "orc init" to recreate.'));
        } else {
          console.log(chalk.red(`✗ ${err.message}`));
          console.log();
          console.log(chalk.dim('Run "orc init" to create a config, or use "orc run -q" for quick start.'));
        }
        console.log();
        process.exit(1);
      }
    }

    const orchestrator = new Orchestrator(config);
    const result = await orchestrator.run(task);
    process.exit(result.success ? 0 : 1);
  });

// Handle unknown commands
program.on("command:unknown", (unknownCommand: string) => {
  console.error(chalk.red(`✗ Unknown command: ${unknownCommand}`));
  console.log();
  program.help();
});

// Show help when no command provided
if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((err: Error) => {
  if (err instanceof AgentInitError) {
    console.error(chalk.red(`✗ Agent init failed: [${err.role}-${err.index}] ${err.message}`));
    if (err.cause) console.error(chalk.dim(`  Cause: ${err.cause.message}`));
  } else {
    console.error(chalk.red(`✗ Fatal: ${err.message}`));
  }
  process.exit(1);
});
