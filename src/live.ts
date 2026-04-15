/**
 * Agent tool tracking — lightweight events forwarded to TUI
 */

export type ToolStatus = "running" | "done" | "error";

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  status: ToolStatus;
  startTime: number;
  endTime?: number;
  output?: string;
}

/** Per-agent live state that TUI reads */
export interface AgentLiveState {
  /** Current streaming text */
  text: string;
  /** Active tool calls */
  tools: ToolCall[];
  /** Which tool is currently streaming output */
  activeToolIndex: number;
}

/** Create empty live state */
export function createLiveState(): AgentLiveState {
  return { text: "", tools: [], activeToolIndex: -1 };
}
