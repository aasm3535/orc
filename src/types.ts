/**
 * Orc - Multi-agent orchestrator swarm types
 */

import { Type, Static } from "@sinclair/typebox";

// ── Domain types (must come before error classes that reference them) ──

/** Supported agent roles in the swarm */
export type AgentRole = "manager" | "developer" | "scout" | "reviewer";

/** Model reference: provider/id format (e.g. "google/gemma-4-31b-it") */
export type ModelRef = string;

// ── Structured error classes ──

/** Error thrown when an agent fails to initialize */
export class AgentInitError extends Error {
  readonly role: AgentRole;
  readonly index: number;
  readonly cause?: Error;

  constructor(role: AgentRole, index: number, message: string, cause?: Error) {
    super(`Agent [${role}-${index}] init failed: ${message}`);
    this.name = "AgentInitError";
    this.role = role;
    this.index = index;
    this.cause = cause;
  }
}

/** Error thrown when config validation fails */
export class ConfigValidationError extends Error {
  readonly errors: ReadonlyArray<{ path: string; message: string }>;

  constructor(errors: Array<{ path: string; message: string }>) {
    const summary = errors.map(e => `  ${e.path}: ${e.message}`).join("\n");
    super(`Config validation failed:\n${summary}`);
    this.name = "ConfigValidationError";
    this.errors = Object.freeze([...errors]);
  }
}

// ── TypeBox validation schemas ──

const ThinkingLevel = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
]);

const RoleConfigSchema = Type.Object({
  model: Type.String({ minLength: 1, description: "Model reference in provider/model-id format" }),
  count: Type.Integer({ minimum: 1, maximum: 10, default: 1, description: "Number of agent instances" }),
  systemPrompt: Type.Optional(Type.String({ description: "System prompt override" })),
  systemPromptFile: Type.Optional(Type.String({ description: "Path to system prompt file" })),
  tools: Type.Optional(Type.Array(Type.String(), { description: "Tool names this role can use" })),
  thinkingLevel: Type.Optional(ThinkingLevel),
});

const ContextLimitsSchema = Type.Object({
  managerOutput: Type.Integer({ minimum: 500, default: 2000 }),
  developerOutput: Type.Integer({ minimum: 500, default: 2000 }),
  scoutOutput: Type.Integer({ minimum: 500, default: 1500 }),
  reviewerOutput: Type.Integer({ minimum: 500, default: 2000 }),
  planLength: Type.Integer({ minimum: 500, default: 3000 }),
});

const RetryConfigSchema = Type.Object({
  maxRetries: Type.Integer({ minimum: 0, maximum: 10, default: 3 }),
  initialDelayMs: Type.Integer({ minimum: 100, default: 1000 }),
  maxDelayMs: Type.Integer({ minimum: 1000, default: 30000 }),
  backoffMultiplier: Type.Number({ minimum: 1, default: 2 }),
  retryableErrors: Type.Optional(Type.Array(Type.String())),
});

/** TypeBox schema for SwarmConfig — used for runtime validation */
export const SwarmConfigSchema = Type.Object({
  cwd: Type.String({ minLength: 1, description: "Project working directory" }),
  maxCycles: Type.Integer({ minimum: 1, maximum: 100, default: 5, description: "Maximum orchestration cycles" }),
  contextLimits: Type.Optional(ContextLimitsSchema),
  retry: Type.Optional(Type.Partial(RetryConfigSchema)),
  manager: RoleConfigSchema,
  developer: RoleConfigSchema,
  scout: RoleConfigSchema,
  reviewer: RoleConfigSchema,
});

/** Inferred type from the TypeBox schema (matches SwarmConfig interface) */
export type ValidatedSwarmConfig = Static<typeof SwarmConfigSchema>;

// ── Interface definitions ──

/** Configuration for a single role in the swarm */
export interface RoleConfig {
  /** Which model to use for this role (provider/model-id format) */
  model: ModelRef;
  /** Number of agent instances for this role (default: 1) */
  count: number;
  /** System prompt override (if not set, uses built-in prompt for the role) */
  systemPrompt?: string;
  /** Path to system prompt file (.md) */
  systemPromptFile?: string;
  /** Which tools this role has access to */
  tools?: string[];
  /** Thinking level for this role */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

/** Retry configuration for failed agents */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Whether to retry on specific error types (default: all) */
  retryableErrors?: string[];
}

/** Full swarm configuration */
export interface SwarmConfig {
  /** Project working directory */
  cwd: string;
  /** Maximum number of orchestration cycles (default: 5) */
  maxCycles: number;
  /** Context length settings for prompts */
  contextLimits?: {
    /** Max characters for manager output in prompts (default: 2000) */
    managerOutput: number;
    /** Max characters for developer output in prompts (default: 2000) */
    developerOutput: number;
    /** Max characters for scout output in prompts (default: 1500) */
    scoutOutput: number;
    /** Max characters for reviewer output in prompts (default: 2000) */
    reviewerOutput: number;
    /** Max characters for plan in developer prompts (default: 3000) */
    planLength: number;
  };
  /** Retry configuration (applies to all roles) */
  retry?: Partial<RetryConfig>;
  /** Manager role config */
  manager: RoleConfig;
  /** Developer role config */
  developer: RoleConfig;
  /** Scout role config */
  scout: RoleConfig;
  /** Reviewer role config */
  reviewer: RoleConfig;
}

/** Message exchanged between agents */
export interface AgentMessage {
  role: AgentRole;
  agentIndex: number;
  content: string;
  timestamp: number;
}

/** Result of a single agent's turn */
export interface AgentResult {
  role: AgentRole;
  agentIndex: number;
  output: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: number;
  };
  duration: number;
  success: boolean;
  error?: string;
}

/** Result of a full orchestration cycle */
export interface CycleResult {
  cycleNumber: number;
  manager: AgentResult;
  developers: AgentResult[];
  scouts: AgentResult[];
  reviewer: AgentResult;
  shouldContinue: boolean;
  duration: number;
}

/** Full orchestration run result */
export interface OrchestrationResult {
  task: string;
  cycles: CycleResult[];
  finalOutput: string;
  totalDuration: number;
  totalCost: number;
  success: boolean;
}

/** Status of the orchestrator at any point */
export type OrchestrationPhase =
  | "initializing"
  | "manager-planning"
  | "developers-working"
  | "scouts-investigating"
  | "reviewer-checking"
  | "manager-deciding"
  | "completed"
  | "error";
