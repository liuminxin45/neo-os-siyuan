export type LlmProvider = "openai-compatible" | "deepseek";

export interface LlmProfile {
  id: string;
  name: string;
  provider: LlmProvider;
  baseUrl?: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmProfileDraft {
  id?: string;
  name: string;
  provider: LlmProvider;
  baseUrl?: string;
  apiKey: string;
  model: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
