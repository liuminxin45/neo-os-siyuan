import { createId, nowIso } from "../utils/ids";
import { isHttpUrl, normalizeBaseUrl } from "../utils/text";
import {
  DEEPSEEK_BASE_URL,
  KIMI_CODING_BASE_URL,
  type LlmProfile,
  type LlmProfileDraft,
  type ValidationResult,
} from "../models/llm";

export const validateLlmProfile = (draft: LlmProfileDraft): ValidationResult => {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "请输入配置名称";
  if (!draft.model.trim()) errors.model = "请输入模型名称";
  if (!draft.apiKey?.trim()) {
    errors.apiKey = "请输入 API Key";
  }
  if (draft.provider === "openai-compatible") {
    if (!draft.baseUrl?.trim()) {
      errors.baseUrl = "请输入 Base URL";
    } else if (!isHttpUrl(draft.baseUrl)) {
      errors.baseUrl = "Base URL 必须是 http 或 https 地址";
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
};

export const materializeLlmProfile = (draft: LlmProfileDraft, existing?: LlmProfile): LlmProfile => {
  const timestamp = nowIso();
  return {
    id: existing?.id || draft.id || createId("llm"),
    name: draft.name.trim(),
    provider: draft.provider,
    baseUrl:
      draft.provider === "deepseek"
        ? DEEPSEEK_BASE_URL
        : draft.provider === "kimi-coding-plan"
          ? KIMI_CODING_BASE_URL
          : normalizeBaseUrl(draft.baseUrl || ""),
    apiKey: draft.apiKey?.trim(),
    model: draft.model.trim(),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

export const createEmptyLlmDraft = (provider: LlmProfile["provider"] = "deepseek"): LlmProfileDraft => ({
  name:
    provider === "deepseek"
      ? "DeepSeek"
      : provider === "kimi-coding-plan"
        ? "Kimi CodingPlan"
        : "OpenAI Compatible",
  provider,
  baseUrl: provider === "deepseek" ? DEEPSEEK_BASE_URL : provider === "kimi-coding-plan" ? KIMI_CODING_BASE_URL : "",
  apiKey: "",
  model: provider === "deepseek" ? "deepseek-chat" : provider === "kimi-coding-plan" ? "k2p5" : "",
});

export const cloneProfileToDraft = (profile: LlmProfile): LlmProfileDraft => ({
  id: profile.id,
  name: profile.name,
  provider: profile.provider,
  baseUrl: profile.baseUrl,
  apiKey: profile.apiKey,
  model: profile.model,
});

export const getActiveProfile = (profiles: LlmProfile[], activeProfileId?: string): LlmProfile | undefined =>
  profiles.find((profile) => profile.id === activeProfileId) || profiles[0];
