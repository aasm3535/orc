/**
 * Agent wrapper — creates and manages a single Pi AgentSession
 * Emits live events (text deltas, tool calls) for TUI consumption
 */

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
  createReadOnlyTools,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentRole, AgentResult, RoleConfig, ModelRef } from "./types.js";
import { AgentInitError } from "./types.js";
import { getSystemPromptForRole } from "./prompts.js";
import { generateIdentity, type AgentIdentity } from "./names.js";
import { createLiveState, type AgentLiveState, type ToolCall } from "./live.js";

function parseModelRef(ref: ModelRef): { provider: string; id: string } {
  const i = ref.indexOf("/");
  return i === -1 ? { provider: "", id: ref } : { provider: ref.slice(0, i), id: ref.slice(i + 1) };
}



export interface ModelInfo {
  ref: string;
  shortName: string;
}

export class Agent {
  readonly role: AgentRole;
  readonly index: number;
  readonly config: RoleConfig;
  readonly identity: AgentIdentity;
  readonly live: AgentLiveState;
  readonly modelInfo: ModelInfo;

  private session: AgentSession | null = null;
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private output: string = "";
  private totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };

  constructor(role: AgentRole, index: number, config: RoleConfig, authStorage: AuthStorage, modelRegistry: ModelRegistry) {
    this.role = role;
    this.index = index;
    this.config = config;
    this.authStorage = authStorage;
    this.modelRegistry = modelRegistry;
    this.identity = generateIdentity(role, index);
    this.live = createLiveState();
    this.modelInfo = { ref: config.model, shortName: shortModelName(config.model) };
  }

  /** Initialize the Pi session */
  async init(cwd: string): Promise<void> {
    const ref = parseModelRef(this.config.model);
    let model;

    try {
      if (ref.provider) model = this.modelRegistry.find(ref.provider, ref.id);
      if (!model) {
        const available = await this.modelRegistry.getAvailable();
        model = available.find(m => m.id === this.config.model || `${m.provider}/${m.id}` === this.config.model || (ref.provider && m.provider === ref.provider && m.id === ref.id));
      }
      if (!model) throw new AgentInitError(this.role, this.index, `Model not found: "${this.config.model}". Run "orc models" to see available models.`);

      // Update modelInfo with resolved name
      this.modelInfo.shortName = model.name || model.id;

      const systemPrompt = this.config.systemPrompt ?? (this.config.systemPromptFile ? await this.loadFile(this.config.systemPromptFile) : getSystemPromptForRole(this.role, this.index));
      const tools = this.resolveTools(cwd);

      const loader = new DefaultResourceLoader({ cwd, systemPromptOverride: () => systemPrompt });
      await loader.reload();

      const result = await createAgentSession({
        cwd, model,
        thinkingLevel: this.config.thinkingLevel ?? "off",
        authStorage: this.authStorage, modelRegistry: this.modelRegistry,
        tools, resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      });

      this.session = result.session;
    } catch (err: any) {
      // Wrap non-AgentInitError exceptions
      if (err instanceof AgentInitError) throw err;
      throw new AgentInitError(this.role, this.index, err.message ?? String(err), err);
    }
  }

  /** Send a prompt — returns result, streams into this.live */
  async prompt(text: string): Promise<AgentResult> {
    if (!this.session) throw new Error(`Agent ${this.identity.name} not initialized`);

    const startTime = Date.now();
    this.output = "";
    this.live.text = "";
    this.live.tools = [];
    this.live.activeToolIndex = -1;

    const unsub = this.session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            const d = event.assistantMessageEvent.delta;
            this.output += d;
            this.live.text += d;
          }
          break;

        case "tool_execution_start":
          this.live.tools.push({
            name: event.toolName,
            args: event.args as Record<string, any>,
            status: "running",
            startTime: Date.now(),
          });
          this.live.activeToolIndex = this.live.tools.length - 1;
          break;

        case "tool_execution_end":
          for (let i = this.live.tools.length - 1; i >= 0; i--) {
            if (this.live.tools[i].name === event.toolName && this.live.tools[i].status === "running") {
              this.live.tools[i].status = event.isError ? "error" : "done";
              this.live.tools[i].endTime = Date.now();
              break;
            }
          }
          break;

        case "message_end":
          if (event.message.role === "assistant") {
            const u = event.message.usage;
            if (u) {
              this.totalUsage.input += u.input;
              this.totalUsage.output += u.output;
              this.totalUsage.cacheRead += u.cacheRead;
              this.totalUsage.cacheWrite += u.cacheWrite;
              this.totalUsage.totalTokens += u.totalTokens;
              this.totalUsage.cost += u.cost?.total ?? 0;
            }
          }
          break;
      }
    });

    try {
      await this.session.prompt(text);
    } catch (err: any) {
      unsub();
      return { role: this.role, agentIndex: this.index, output: this.output || err.message, usage: { ...this.totalUsage }, duration: Date.now() - startTime, success: false, error: err.message };
    }

    unsub();
    return { role: this.role, agentIndex: this.index, output: this.output, usage: { ...this.totalUsage }, duration: Date.now() - startTime, success: true };
  }

  get handle(): string { return this.identity.handle; }

  dispose(): void { this.session?.dispose(); this.session = null; }

  private resolveTools(cwd: string) {
    if (!this.config.tools) {
      return this.role === "developer" ? createCodingTools(cwd) : createReadOnlyTools(cwd);
    }
    return this.config.tools.some(t => ["edit", "write", "bash"].includes(t)) ? createCodingTools(cwd) : createReadOnlyTools(cwd);
  }

  private async loadFile(p: string): Promise<string> {
    const fs = await import("node:fs/promises"), path = await import("node:path");
    return fs.readFile(path.resolve(p), "utf-8");
  }
}

function shortModelName(ref: string): string {
  const id = ref.split("/").pop() || ref;
  return id.split(/[-_.]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

