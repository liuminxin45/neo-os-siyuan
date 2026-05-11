import type { ChatArchiveSummary, ChatMessage, ChatReference } from "../models/chat";

interface SiyuanApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

interface SiyuanNotebook {
  id: string;
  name: string;
  closed?: boolean;
}

interface SiyuanFileItem {
  isDir: boolean;
  name: string;
  updated?: number;
}

interface SiyuanBlockRow {
  id?: string;
  content?: string;
  hpath?: string;
  updated?: string;
}

interface SiyuanDocPath {
  notebook: string;
  path: string;
}

interface SiyuanExportMd {
  hPath: string;
  content: string;
}

interface ArchivedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  conversationId: string;
  references?: ChatReference[];
}

export interface ChatArchiveDocument {
  conversationId: string;
  fileName: string;
  path: string;
  messages: ChatMessage[];
}

const NOTEBOOK_NAME = "LLM-Wiki";
const RUNS_HPATH = "/runs";
const CHATS_HPATH = "/runs/chats";
const CHAT_DOC_HPATH_PREFIX = `${CHATS_HPATH}/`;
const ARCHIVE_NAME_PATTERN = /^conv_\d+_[a-z0-9]+\.json$/i;

const createConversationId = (): string => `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const archivePath = (archiveDir: string, fileName: string): string => `${archiveDir}/${fileName}`;
const archiveHPath = (fileName: string): string => `${CHAT_DOC_HPATH_PREFIX}${fileName}`;
const displayHPath = (hpath: string): string => `/${NOTEBOOK_NAME}${hpath}`;

const conversationCreatedAt = (conversationId: string): number => {
  const timestamp = conversationId.match(/^conv_(\d+)_/)?.[1];
  return timestamp ? Number(timestamp) : 0;
};

export const compareChatArchives = (a: ChatArchiveSummary, b: ChatArchiveSummary): number =>
  conversationCreatedAt(b.conversationId) - conversationCreatedAt(a.conversationId) || b.conversationId.localeCompare(a.conversationId);

const escapeSql = (value: string): string => value.replace(/'/g, "''");

const safeFileName = (conversationId: string): string => {
  const base = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${base || createConversationId()}.json`;
};

const toTimestamp = (createdAt: string): number => {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const toIso = (timestamp: number): string => new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();

const titleFromMessages = (messages: ChatMessage[], fallback: string): string => {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  const text = firstUser?.content.trim().replace(/\s+/g, " ") || fallback;
  return text.length > 32 ? `${text.slice(0, 31)}...` : text;
};

const updatedAtFromBlock = (updated?: string): number => {
  if (!updated || !/^\d{14}$/.test(updated)) return 0;
  const iso = `${updated.slice(0, 4)}-${updated.slice(4, 6)}-${updated.slice(6, 8)}T${updated.slice(8, 10)}:${updated.slice(10, 12)}:${updated.slice(12, 14)}+08:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isMissingArchiveError = (error: unknown): boolean =>
  error instanceof Error && /file does not exist|not found|404|文件不存在|不存在/i.test(error.message);

const isReference = (value: unknown): value is ChatReference => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === "string" && typeof item.path === "string";
};

const normalizeArchivedMessage = (value: unknown, fallbackConversationId: string): ChatMessage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const role = item.role === "user" || item.role === "assistant" ? item.role : undefined;
  const content = typeof item.content === "string" ? item.content : "";
  if (!role || !content) return undefined;
  const timestamp = typeof item.timestamp === "number" ? item.timestamp : Date.now();
  const references = Array.isArray(item.references) ? item.references.filter(isReference) : undefined;
  return {
    id: typeof item.id === "string" && item.id ? item.id : `${role}_${timestamp}`,
    role,
    content,
    createdAt: toIso(timestamp),
    status: "complete",
    references: references?.length ? references : undefined,
  };
};

const parseArchivedRows = (raw: string): unknown[] => {
  const withoutFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const fenced = withoutFrontmatter.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const direct = fenced || withoutFrontmatter;
  const candidates = [direct, direct.match(/\[[\s\S]*\]/)?.[0]].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return [];
};

export class SiyuanChatArchiveStore {
  async createConversationId(): Promise<string> {
    return createConversationId();
  }

  async listArchives(): Promise<ChatArchiveSummary[]> {
    const notebook = await this.findNotebook();
    await this.ensureDocPath(notebook.id, CHATS_HPATH);
    const docSummaries = await this.listDocArchives(notebook.id);
    const fileSummaries = await this.listFileArchives();
    const merged = new Map<string, ChatArchiveSummary>();
    for (const item of [...fileSummaries, ...docSummaries]) {
      merged.set(item.conversationId, item);
    }
    return [...merged.values()].sort(compareChatArchives);
  }

  async loadArchive(conversationId: string): Promise<ChatArchiveDocument> {
    const notebook = await this.findNotebook();
    const fileName = safeFileName(conversationId);
    const hpath = archiveHPath(fileName);
    const docId = await this.findArchiveDocId(notebook.id, hpath);
    if (!docId) return this.loadFileArchive(conversationId);
    const raw = await this.exportMarkdown(docId);
    const messages = parseArchivedRows(raw)
      .map((item) => normalizeArchivedMessage(item, conversationId))
      .filter((message): message is ChatMessage => Boolean(message));
    return { conversationId, fileName, path: displayHPath(hpath), messages };
  }

  async saveArchive(conversationId: string, messages: ChatMessage[]): Promise<ChatArchiveSummary | undefined> {
    const archivedMessages = messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
      .map<ArchivedChatMessage>((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        timestamp: toTimestamp(message.createdAt),
        conversationId,
        ...(message.references?.length ? { references: message.references } : {}),
      }));
    if (archivedMessages.length === 0) return undefined;

    const fileName = safeFileName(conversationId);
    const notebook = await this.findNotebook();
    await this.ensureDocPath(notebook.id, CHATS_HPATH);
    const hpath = archiveHPath(fileName);
    await this.writeDocArchive(notebook.id, hpath, JSON.stringify(archivedMessages, null, 2));
    return {
      conversationId,
      fileName,
      path: displayHPath(hpath),
      title: titleFromMessages(messages, fileName),
      updatedAt: Date.now(),
      messageCount: archivedMessages.length,
    };
  }

  async deleteArchive(conversationId: string): Promise<void> {
    const notebook = await this.findNotebook();
    const fileName = safeFileName(conversationId);
    const docId = (await this.getIdsByHPath(notebook.id, archiveHPath(fileName)))[0];
    if (docId) {
      await this.postJson<null>("/api/filetree/removeDocByID", { id: docId });
      return;
    }
    const archiveDir = await this.resolveArchiveDir();
    await this.removeFile(archivePath(archiveDir, fileName));
  }

  private async listDocArchives(notebookId: string): Promise<ChatArchiveSummary[]> {
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, content, hpath, updated",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebookId)}'`,
        "AND type = 'd'",
        `AND hpath LIKE '${escapeSql(CHAT_DOC_HPATH_PREFIX)}%'`,
        "ORDER BY updated DESC",
      ].join(" "),
    );
    const docs = rows.filter((row) => row.id && row.hpath && ARCHIVE_NAME_PATTERN.test(row.hpath.split("/").pop() || ""));
    const summaries = await Promise.all(docs.map((row) => this.summaryFromDoc(row)));
    return summaries.filter((item): item is ChatArchiveSummary => Boolean(item));
  }

  private async summaryFromDoc(row: SiyuanBlockRow): Promise<ChatArchiveSummary | undefined> {
    const hpath = row.hpath || "";
    const fileName = hpath.split("/").pop() || "";
    const conversationId = fileName.replace(/\.json$/i, "");
    try {
      const raw = await this.exportMarkdown(row.id || "");
      const messages = parseArchivedRows(raw)
        .map((item) => normalizeArchivedMessage(item, conversationId))
        .filter((message): message is ChatMessage => Boolean(message));
      return {
        conversationId,
        fileName,
        path: displayHPath(hpath),
        title: titleFromMessages(messages, fileName),
        updatedAt: updatedAtFromBlock(row.updated) || Date.now(),
        messageCount: messages.length,
      };
    } catch {
      return {
        conversationId,
        fileName,
        path: displayHPath(hpath),
        title: row.content || fileName,
        updatedAt: updatedAtFromBlock(row.updated),
        messageCount: 0,
      };
    }
  }

  private async listFileArchives(): Promise<ChatArchiveSummary[]> {
    const archiveDir = await this.resolveArchiveDir();
    const items = await this.readDir(archiveDir);
    const files = items
      .filter((item) => !item.isDir && ARCHIVE_NAME_PATTERN.test(item.name))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const summaries = await Promise.all(files.map((file) => this.summaryFromFile(archiveDir, file)));
    return summaries.filter((item): item is ChatArchiveSummary => Boolean(item));
  }

  private async loadFileArchive(conversationId: string): Promise<ChatArchiveDocument> {
    const archiveDir = await this.resolveArchiveDir();
    const fileName = safeFileName(conversationId);
    const path = archivePath(archiveDir, fileName);
    let raw = "";
    try {
      raw = await this.getFile(path);
    } catch (error) {
      if (isMissingArchiveError(error)) throw new Error(`聊天存档文件不存在：${fileName}`);
      throw error;
    }
    const messages = parseArchivedRows(raw)
      .map((item) => normalizeArchivedMessage(item, conversationId))
      .filter((message): message is ChatMessage => Boolean(message));
    return { conversationId, fileName, path, messages };
  }

  private async summaryFromFile(archiveDir: string, file: SiyuanFileItem): Promise<ChatArchiveSummary | undefined> {
    const conversationId = file.name.replace(/\.json$/i, "");
    const path = archivePath(archiveDir, file.name);
    try {
      const raw = await this.getFile(path);
      const messages = parseArchivedRows(raw)
        .map((item) => normalizeArchivedMessage(item, conversationId))
        .filter((message): message is ChatMessage => Boolean(message));
      return {
        conversationId,
        fileName: file.name,
        path,
        title: titleFromMessages(messages, file.name),
        updatedAt: (file.updated || 0) * 1000,
        messageCount: messages.length,
      };
    } catch (error) {
      if (isMissingArchiveError(error)) return undefined;
      return {
        conversationId,
        fileName: file.name,
        path,
        title: file.name,
        updatedAt: (file.updated || 0) * 1000,
        messageCount: 0,
      };
    }
  }

  private async resolveArchiveDir(): Promise<string> {
    const notebook = await this.findNotebook();
    const chatsId = await this.ensureDocPath(notebook.id, CHATS_HPATH);
    const storage = await this.postJson<SiyuanDocPath>("/api/filetree/getPathByID", { id: chatsId });
    const storagePath = storage.path.replace(/\.sy$/i, "");
    const archiveDir = `/data/${storage.notebook || notebook.id}${storagePath}`;
    await this.putDirectory(archiveDir);
    return archiveDir;
  }

  private async ensureDocPath(notebookId: string, hpath: string): Promise<string> {
    const existing = await this.getIdsByHPath(notebookId, hpath);
    if (existing[0]) return existing[0];
    if (hpath === CHATS_HPATH) {
      await this.ensureDocPath(notebookId, RUNS_HPATH);
    }
    const id = await this.postJson<string>("/api/filetree/createDocWithMd", {
      notebook: notebookId,
      path: hpath,
      markdown: `# ${hpath.split("/").filter(Boolean).pop() || "chats"}\n`,
    });
    const created = id || (await this.getIdsByHPath(notebookId, hpath))[0];
    if (!created) throw new Error(`无法创建聊天存档目录：${NOTEBOOK_NAME}${hpath}`);
    return created;
  }

  private async writeDocArchive(notebookId: string, hpath: string, content: string): Promise<string> {
    const existing = await this.getIdsByHPath(notebookId, hpath);
    for (const id of existing) {
      await this.postJson<null>("/api/filetree/removeDocByID", { id });
    }
    return this.postJson<string>("/api/filetree/createDocWithMd", {
      notebook: notebookId,
      path: hpath,
      markdown: content,
    });
  }

  private async getIdsByHPath(notebookId: string, hpath: string): Promise<string[]> {
    try {
      return await this.postJson<string[]>("/api/filetree/getIDsByHPath", { notebook: notebookId, path: hpath });
    } catch {
      return [];
    }
  }

  private async findArchiveDocId(notebookId: string, hpath: string): Promise<string | undefined> {
    const byHpath = await this.getIdsByHPath(notebookId, hpath);
    if (byHpath[0]) return byHpath[0];
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, hpath",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebookId)}'`,
        "AND type = 'd'",
        `AND hpath = '${escapeSql(hpath)}'`,
        "LIMIT 1",
      ].join(" "),
    );
    return rows.find((row) => row.id)?.id;
  }

  private async findNotebook(): Promise<SiyuanNotebook> {
    const data = await this.postJson<{ notebooks: SiyuanNotebook[] }>("/api/notebook/lsNotebooks", {});
    const notebook = data.notebooks.find((item) => item.name === NOTEBOOK_NAME);
    if (!notebook) throw new Error(`未找到 ${NOTEBOOK_NAME} 笔记本`);
    if (notebook.closed) throw new Error(`${NOTEBOOK_NAME} 笔记本当前处于关闭状态`);
    return notebook;
  }

  private async exportMarkdown(id: string): Promise<string> {
    const data = await this.postJson<SiyuanExportMd>("/api/export/exportMdContent", { id });
    return data.content || "";
  }

  private async query<T>(stmt: string): Promise<T[]> {
    return this.postJson<T[]>("/api/query/sql", { stmt });
  }

  private async readDir(path: string): Promise<SiyuanFileItem[]> {
    try {
      return await this.postJson<SiyuanFileItem[]>("/api/file/readDir", { path });
    } catch (error) {
      if (error instanceof Error && /404|not found/i.test(error.message)) return [];
      throw error;
    }
  }

  private async getFile(path: string): Promise<string> {
    const response = await fetch("/api/file/getFile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const text = await response.text();
    if (response.status === 200) return text;
    let message = text;
    try {
      const result = JSON.parse(text) as SiyuanApiResponse<unknown>;
      message = result.msg || String(result.code);
    } catch {
      // Keep raw response text.
    }
    throw new Error(message || `读取聊天存档失败：${path}`);
  }

  private async putFile(path: string, content: string): Promise<void> {
    const form = new FormData();
    const file = new Blob([content], { type: "application/json" });
    form.append("path", path);
    form.append("isDir", "false");
    form.append("modTime", String(Math.floor(Date.now() / 1000)));
    form.append("file", file, path.split("/").pop() || "conversation.json");
    await this.postForm("/api/file/putFile", form);
  }

  private async putDirectory(path: string): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", "true");
    form.append("modTime", String(Math.floor(Date.now() / 1000)));
    await this.postForm("/api/file/putFile", form);
  }

  private async removeFile(path: string): Promise<void> {
    await this.postJson<null>("/api/file/removeFile", { path });
  }

  private async postJson<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as SiyuanApiResponse<T>;
    if (!response.ok || result.code !== 0) {
      throw new Error(result.msg || `SiYuan API 请求失败：${endpoint}`);
    }
    return result.data;
  }

  private async postForm(endpoint: string, form: FormData): Promise<void> {
    const response = await fetch(endpoint, { method: "POST", body: form });
    const result = (await response.json()) as SiyuanApiResponse<null>;
    if (!response.ok || result.code !== 0) {
      throw new Error(result.msg || `SiYuan API 请求失败：${endpoint}`);
    }
  }
}
