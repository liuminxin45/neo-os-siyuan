import type { McpToolCall } from "./mcp";

export type AgentMode = "react" | "reflection" | "plan-and-execute";
export type ReActStepStatus = "running" | "complete" | "error";

export interface ReActAction {
  toolName: string;
  argumentsSummary: string;
}

export interface ReActObservation {
  summary: string;
  status: McpToolCall["status"];
}

export interface ReActStep {
  id: string;
  round: number;
  thought: string;
  actions: ReActAction[];
  observations: ReActObservation[];
  status: ReActStepStatus;
}

export interface ReActTrace {
  steps: ReActStep[];
  collapsed: boolean;
  waitingContinuation: boolean;
  pauseReason?: string;
}

export interface ReActContinuationState {
  assistantMessageId: string;
  toolResults: McpToolCall[];
  completedRounds: number;
  reactHistory?: string[];
}

export const DEFAULT_AGENT_MODE: AgentMode = "react";
export const REACT_SEGMENT_ROUNDS = 10;
export const REACT_PAUSE_MESSAGE = "已超过默认思考最大轮次，是否继续";

export const normalizeAgentMode = (mode?: string): AgentMode =>
  mode === "reflection" || mode === "plan-and-execute" || mode === "react" ? mode : DEFAULT_AGENT_MODE;
