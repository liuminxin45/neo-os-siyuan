import { openTab, showMessage, type App } from "siyuan";

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

interface SiyuanBlockRow {
  id?: string;
  content?: string;
  hpath?: string;
}

export interface DocumentOpenTarget {
  id?: string;
  title?: string;
  path?: string;
}

const NOTEBOOK_NAME = "LLM-Wiki";

const escapeSql = (value: string): string => value.replace(/'/g, "''");

const escapeLike = (value: string): string => escapeSql(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

const stripMarkdownExt = (value: string): string => value.replace(/\.md$/i, "");

const compactDocTitle = (value: string): string => {
  const target = value.trim();
  const pipeIndex = target.indexOf("|");
  return (pipeIndex >= 0 ? target.slice(0, pipeIndex) : target).trim();
};

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const pathCandidates = (path: string): string[] => {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized || /^https?:\/\//i.test(normalized) || normalized.startsWith("#")) return [];
  const withoutNotebook = normalized
    .replace(new RegExp(`^/?${NOTEBOOK_NAME}/`, "i"), "")
    .replace(/^\/+/, "");
  const withSlash = `/${withoutNotebook}`;
  return unique([withSlash, stripMarkdownExt(withSlash)]);
};

const titleCandidates = (target: DocumentOpenTarget): string[] => {
  const values = [
    target.title || "",
    target.path?.split(/[\\/]/).pop() || "",
  ].map((item) => stripMarkdownExt(compactDocTitle(item)));
  return unique(values);
};

const searchTokens = (title: string): string[] => {
  const normalized = stripMarkdownExt(title)
    .replace(/c\+\+/gi, "c ")
    .replace(/([a-z0-9])([\u4e00-\u9fa5])/gi, "$1 $2")
    .replace(/([\u4e00-\u9fa5])([a-z0-9])/gi, "$1 $2")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, " ")
    .trim()
    .toLowerCase();
  const parts = normalized.split(/\s+/).filter((part) => part.length >= 2 && !/^(v|md|json)$/i.test(part));
  return unique(parts).slice(0, 8);
};

const slugLikeTokens = (title: string): string[] =>
  unique([
    ...searchTokens(title),
    ...stripMarkdownExt(title)
      .toLowerCase()
      .split(/[^\p{L}\p{N}\u4e00-\u9fa5+]+/u)
      .filter((part) => part.length >= 2)
      .map((part) => (part === "c++" ? "c" : part)),
  ]).slice(0, 10);

export class SiyuanDocumentOpener {
  constructor(private readonly app: App) {}

  async open(target: DocumentOpenTarget): Promise<void> {
    try {
      const id = await this.resolveDocId(target);
      if (!id) {
        showMessage(`未找到文档：${target.title || target.path || target.id || ""}`, 4000, "error");
        return;
      }
      await openTab({ app: this.app, doc: { id }, openNewTab: true });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), 4000, "error");
    }
  }

  private async resolveDocId(target: DocumentOpenTarget): Promise<string | undefined> {
    if (target.id) return target.id;
    const notebook = await this.findNotebook();
    for (const hpath of target.path ? pathCandidates(target.path) : []) {
      const id = (await this.getIdsByHPath(notebook.id, hpath))[0];
      if (id) return id;
    }
    for (const title of titleCandidates(target)) {
      const id = await this.findDocByTitle(notebook.id, title);
      if (id) return id;
      const fuzzyId = await this.findDocByFuzzyTitle(notebook.id, title);
      if (fuzzyId) return fuzzyId;
    }
    return undefined;
  }

  private async findDocByTitle(notebookId: string, title: string): Promise<string | undefined> {
    if (!title) return undefined;
    const plain = escapeSql(title);
    const plainNoMd = escapeSql(stripMarkdownExt(title));
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebookId)}'`,
        "AND type = 'd'",
        `AND (content = '${plain}' OR content = '${plainNoMd}' OR hpath LIKE '%/${plain}' OR hpath LIKE '%/${plainNoMd}')`,
        `ORDER BY CASE WHEN content = '${plain}' OR content = '${plainNoMd}' THEN 0 ELSE 1 END`,
        "LIMIT 1",
      ].join(" "),
    );
    return rows[0]?.id;
  }

  private async findDocByFuzzyTitle(notebookId: string, title: string): Promise<string | undefined> {
    const tokens = slugLikeTokens(title);
    if (tokens.length === 0) return undefined;
    const important = tokens.filter((token) => !/^\d+$/.test(token) || token.length >= 4).slice(0, 8);
    const clauses = important.length ? important : tokens.slice(0, 8);
    const likeClauses = clauses.map((token) => {
      const escaped = escapeLike(token);
      return `(lower(content) LIKE '%${escaped}%' ESCAPE '\\' OR lower(hpath) LIKE '%${escaped}%' ESCAPE '\\')`;
    });
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, content, hpath",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebookId)}'`,
        "AND type = 'd'",
        `AND (${likeClauses.join(" OR ")})`,
        this.fuzzyOrderBy(tokens),
        "LIMIT 1",
      ].join(" "),
    );
    return rows[0]?.id;
  }

  private fuzzyOrderBy(tokens: string): string;
  private fuzzyOrderBy(tokens: string[]): string;
  private fuzzyOrderBy(tokens: string | string[]): string {
    const items = Array.isArray(tokens) ? tokens : [tokens];
    const scoreParts = items.slice(0, 8).map((token) => {
      const escaped = escapeLike(token);
      return `(CASE WHEN lower(content) LIKE '%${escaped}%' ESCAPE '\\' THEN 2 ELSE 0 END + CASE WHEN lower(hpath) LIKE '%${escaped}%' ESCAPE '\\' THEN 1 ELSE 0 END)`;
    });
    return `ORDER BY ${scoreParts.join(" + ")} DESC, updated DESC`;
  }

  private async getIdsByHPath(notebookId: string, hpath: string): Promise<string[]> {
    try {
      return await this.postJson<string[]>("/api/filetree/getIDsByHPath", { notebook: notebookId, path: hpath });
    } catch {
      return [];
    }
  }

  private async findNotebook(): Promise<SiyuanNotebook> {
    const data = await this.postJson<{ notebooks: SiyuanNotebook[] }>("/api/notebook/lsNotebooks", {});
    const notebook = data.notebooks.find((item) => item.name === NOTEBOOK_NAME);
    if (!notebook) throw new Error(`未找到 ${NOTEBOOK_NAME} 笔记本`);
    if (notebook.closed) throw new Error(`${NOTEBOOK_NAME} 笔记本当前处于关闭状态`);
    return notebook;
  }

  private async query<T>(stmt: string): Promise<T[]> {
    return this.postJson<T[]>("/api/query/sql", { stmt });
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
}
