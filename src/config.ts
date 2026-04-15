/**
 * Configuration loading for Orc swarm
 * No hardcoded models - everything comes from the user's Pi setup
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parse as parseYaml } from "yaml";
import chalk from "chalk";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { SwarmConfig, RoleConfig, ModelRef } from "./types.js";
import { SwarmConfigSchema, ConfigValidationError } from "./types.js";
import { Value, type ValueError } from "@sinclair/typebox/value";

// Helpers for Promise-based readline
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

const DEFAULT_MAX_CYCLES = 5;
const DEFAULT_DEV_COUNT = 1;
const DEFAULT_SCOUT_COUNT = 1;

/** Resolved available model entry */
export interface AvailableModel {
  ref: string;         // "provider/model-id"
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
}

/** Get all available models from Pi's ModelRegistry */
export async function getAvailableModels(): Promise<AvailableModel[]> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();

  return available.map((m) => ({
    ref: `${m.provider}/${m.id}`,
    provider: m.provider,
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    contextWindow: m.contextWindow,
  }));
}

/** Pick a model interactively from available models */
async function pickModel(
  rl: readline.Interface,
  role: string,
  models: AvailableModel[],
  defaultIndex: number,
): Promise<AvailableModel> {
  console.log();
  console.log(chalk.bold(`  Select model for ${chalk.cyan(role)}:`));
  console.log();

  // Group by provider
  const byProvider = new Map<string, AvailableModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  let idx = 0;
  const flat: AvailableModel[] = [];
  for (const [provider, pModels] of byProvider) {
    for (const m of pModels) {
      const isDefault = idx === defaultIndex;
      const marker = isDefault ? chalk.green(" ← default") : "";
      const thinkBadge = m.reasoning ? chalk.dim(" [thinking]") : "";
      console.log(`    ${chalk.dim(`${idx + 1}.`)} ${chalk.cyan(m.ref)} ${chalk.dim(`(${m.name})`)}${thinkBadge}${marker}`);
      flat.push(m);
      idx++;
    }
  }

  console.log();
  const answer = await question(rl, `  Number [${defaultIndex + 1}]: `);
  const picked = answer.trim() === "" ? defaultIndex : parseInt(answer, 10) - 1;

  if (picked < 0 || picked >= flat.length || isNaN(picked)) {
    console.log(chalk.yellow(`  Invalid choice, using default: ${flat[defaultIndex].ref}`));
    return flat[defaultIndex];
  }

  return flat[picked];
}

/** Ask a simple question */
async function ask(rl: readline.Interface, prompt: string, defaultVal: string): Promise<string> {
  const answer = await question(rl, `  ${prompt} [${defaultVal}]: `);
  return answer.trim() || defaultVal;
}

function resolveRoleConfig(
  partial: Partial<RoleConfig> | undefined,
  fallbackModel: string,
  defaultCount: number,
): RoleConfig {
  return {
    model: partial?.model ?? fallbackModel,
    count: partial?.count ?? defaultCount,
    systemPrompt: partial?.systemPrompt,
    systemPromptFile: partial?.systemPromptFile,
    tools: partial?.tools,
    thinkingLevel: partial?.thinkingLevel,
  };
}

/** Validate a SwarmConfig object against the TypeBox schema */
export function validateConfig(config: unknown): SwarmConfig {
  // Use TypeBox Value.Check for structural validation
  if (!Value.Check(SwarmConfigSchema, config)) {
    // Collect detailed errors
    const errors: Array<{ path: string; message: string }> = [];
    for (const error of Value.Errors(SwarmConfigSchema, config)) {
      // Skip entries that are just "missing optional" — focus on real problems
      if (error.type === 45) continue; // KeyError for missing optional
      errors.push({
        path: error.path.replace(/^\//, "").replace(/\//g, ".") || "(root)",
        message: error.message,
      });
    }
    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }
  }
  // Cast and return — Value.Check passed
  return Value.Cast(SwarmConfigSchema, config) as SwarmConfig;
}

/** Load and validate swarm config from orc.yml */
export function loadConfig(configPath: string): SwarmConfig {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, any> | undefined;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid config: empty or not an object");
  }

  const cwd = parsed.cwd ?? process.cwd();

  // When loading from file, model is REQUIRED for each role
  // No hardcoded fallbacks - if missing, we error
  const requireModel = (role: string, cfg: any): string => {
    if (cfg?.model) return cfg.model;
    throw new Error(`Missing "model" for role "${role}" in ${configPath}. Run "orc init" to generate config interactively.`);
  };

  return {
    cwd: path.resolve(cwd),
    maxCycles: parsed.max_cycles ?? DEFAULT_MAX_CYCLES,
    manager: resolveRoleConfig(parsed.manager, requireModel("manager", parsed.manager), 1),
    developer: resolveRoleConfig(parsed.developer, requireModel("developer", parsed.developer), DEFAULT_DEV_COUNT),
    scout: resolveRoleConfig(parsed.scout, requireModel("scout", parsed.scout), DEFAULT_SCOUT_COUNT),
    reviewer: resolveRoleConfig(parsed.reviewer, requireModel("reviewer", parsed.reviewer), 1),
  };
}

// ── Config with schema validation ──

/** Load, parse, and validate swarm config from orc.yml using TypeBox */
export function loadAndValidateConfig(configPath: string): SwarmConfig {
  const rawConfig = loadConfig(configPath);
  return validateConfig(rawConfig);
}

/** Interactive config generation - picks from user's available models */
export async function initConfig(targetPath: string): Promise<void> {
  console.log();
  console.log(chalk.bold("  🐙 Orc init - configure your swarm"));
  console.log();

  // Get available models
  const models = await getAvailableModels();

  if (models.length === 0) {
    console.log(chalk.red("  No models available! Configure API keys in Pi first:"));
    console.log(chalk.dim("    https://github.com/badlogic/pi-mono#api-keys"));
    console.log();
    process.exit(1);
  }

  console.log(chalk.dim(`  Found ${models.length} available model(s) from your Pi setup.`));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Basic settings
    const cwd = await ask(rl, "Working directory", ".");
    const maxCycles = parseInt(await ask(rl, "Max cycles", "5"), 10);
    const devCount = parseInt(await ask(rl, "Number of developers", "1"), 10);
    const scoutCount = parseInt(await ask(rl, "Number of scouts", "1"), 10);

    // Pick models - default to first available, but suggest different ones per role
    const defaultManager = 0;
    const defaultDeveloper = Math.min(models.length - 1, 0);
    const defaultScout = Math.min(models.length - 1, 0);
    const defaultReviewer = Math.min(models.length - 1, 0);

    const managerModel = await pickModel(rl, "Manager (Руководитель)", models, defaultManager);
    const developerModel = await pickModel(rl, "Developer (Разработчик)", models, defaultDeveloper);
    const scoutModel = await pickModel(rl, "Scout (Разведчик)", models, defaultScout);
    const reviewerModel = await pickModel(rl, "Reviewer (Проверяющий)", models, defaultReviewer);

    // Generate config
    const config: SwarmConfig = {
      cwd,
      maxCycles,
      manager: { model: managerModel.ref, count: 1, thinkingLevel: "medium" },
      developer: { model: developerModel.ref, count: devCount, thinkingLevel: "off" },
      scout: { model: scoutModel.ref, count: scoutCount, thinkingLevel: "off" },
      reviewer: { model: reviewerModel.ref, count: 1, thinkingLevel: "low" },
    };

    const yaml = generateConfigYaml(config);
    fs.writeFileSync(targetPath, yaml, "utf-8");

    console.log();
    console.log(chalk.green(`  ✅ Config saved to ${targetPath}`));
    console.log();
    console.log(chalk.dim("  Run: orc run \"your task here\""));
    console.log();
  } finally {
    rl.close();
  }
}

/** Generate orc.yml content from a SwarmConfig */
export function generateConfigYaml(config: SwarmConfig): string {
  const role = (name: string, cfg: RoleConfig) => {
    let block = `${name}:\n`;
    block += `  model: ${cfg.model}\n`;
    if (cfg.count > 1) block += `  count: ${cfg.count}\n`;
    if (cfg.thinkingLevel && cfg.thinkingLevel !== "off") block += `  thinking_level: ${cfg.thinkingLevel}\n`;
    if (cfg.systemPromptFile) block += `  system_prompt_file: ${cfg.systemPromptFile}\n`;
    if (cfg.tools) block += `  tools: ${cfg.tools.join(", ")}\n`;
    return block;
  };

  return `# Orc - Multi-agent swarm configuration
# Models from your Pi setup (provider/model-id format)
# Run "orc models" to see available, "orc init" to reconfigure

cwd: ${config.cwd}
max_cycles: ${config.maxCycles}

${role("manager", config.manager)}
${role("developer", config.developer)}
${role("scout", config.scout)}
${role("reviewer", config.reviewer)}`;
}

/** Quick-start config: auto-pick first available model for all roles */
export async function quickStartConfig(cwd?: string): Promise<SwarmConfig> {
  const models = await getAvailableModels();

  if (models.length === 0) {
    throw new Error(
      "No models available. Configure API keys in Pi first.\n" +
      "  See: https://github.com/badlogic/pi-mono#api-keys",
    );
  }

  // Use the first available model as default for all roles
  // User can customize via orc.yml afterwards
  const defaultRef = models[0].ref;

  return {
    cwd: cwd ?? process.cwd(),
    maxCycles: DEFAULT_MAX_CYCLES,
    manager: { model: defaultRef, count: 1, thinkingLevel: "medium" },
    developer: { model: defaultRef, count: DEFAULT_DEV_COUNT, thinkingLevel: "off" },
    scout: { model: defaultRef, count: DEFAULT_SCOUT_COUNT, thinkingLevel: "off" },
    reviewer: { model: defaultRef, count: 1, thinkingLevel: "low" },
  };
}

/** Generate a sample orc.yml using user's first available model */
export async function generateSampleConfig(): Promise<string> {
  const models = await getAvailableModels();
  const defaultRef = models.length > 0 ? models[0].ref : "your-provider/your-model";

  return `# Orc - Multi-agent swarm configuration
# Models use provider/model-id format from your Pi setup
# Run "orc models" to list your available models
# Run "orc init" for interactive setup

cwd: .
max_cycles: 5

manager:
  model: ${defaultRef}
  thinking_level: medium
  # system_prompt_file: ./prompts/manager.md
  # tools: read, grep, find, ls, bash

developer:
  model: ${defaultRef}
  count: 1  # Number of parallel developers
  thinking_level: off
  # tools: read, bash, edit, write

scout:
  model: ${defaultRef}
  count: 1
  thinking_level: off
  # tools: read, grep, find, ls, bash

reviewer:
  model: ${defaultRef}
  thinking_level: low
  # tools: read, grep, find, ls, bash
`;
}
