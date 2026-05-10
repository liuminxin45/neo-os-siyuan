const SECRET_KEYS = ["key", "token", "secret", "password", "authorization"];

export const maskSecret = (value: string | undefined): string => {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
};

export const looksSecretKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return SECRET_KEYS.some((token) => normalized.includes(token));
};

export const safeErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || "未知错误";
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
};

export const summarizeJson = (value: unknown, limit = 600): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
};
