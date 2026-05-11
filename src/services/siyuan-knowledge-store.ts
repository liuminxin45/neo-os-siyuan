import type { LlmWikiLayer, SkillManifest } from "../models/llm-wiki";
import { classifyLlmWikiPath, LLM_WIKI_DEFAULT_NOTEBOOK, stripNotebookPrefix } from "../models/llm-wiki";

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
  updated?: string;
}

interface SiyuanExportMd {
  hPath: string;
  content: string;
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  path: string;
  layer: LlmWikiLayer;
  summary: string;
  updated?: string;
}

const escapeSql = (value: string): string => value.replace(/'/g, "''");

const cleanText = (value: string): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const summaryOf = (value: string, maxLength = 220): string => {
  const cleaned = cleanText(value);
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
};

const titleFromPath = (path: string): string => path.split("/").filter(Boolean).pop() || path;

const hpathFor = (path: string, notebookName: string): string => {
  const stripped = stripNotebookPrefix(path, notebookName);
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
};

const fullPathFor = (notebookName: string, hpath: string): string =>
  `/${notebookName}${hpath.startsWith("/") ? hpath : `/${hpath}`}`;

const isSkillRoot = (hpath: string): boolean => {
  const parts = hpath.split("/").filter(Boolean);
  return parts.length === 2 && parts[0] === "skills";
};

const skillEntryPath = (skillRootHpath: string): string =>
  `${skillRootHpath.replace(/\/+$/, "")}/SKILL`;

export class SiyuanKnowledgeStore {
  async readDocumentMarkdown(path: string, notebookName = LLM_WIKI_DEFAULT_NOTEBOOK): Promise<string | undefined> {
    const notebook = await this.findNotebook(notebookName);
    const id = (await this.getIdsByHPath(notebook.id, hpathFor(path, notebook.name)))[0];
    if (!id) return undefined;
    return (await this.exportMarkdown(id)).content || "";
  }

  async searchDocuments(
    query: string,
    options: { notebookName?: string; layer?: LlmWikiLayer; limit?: number } = {},
  ): Promise<KnowledgeSearchResult[]> {
    const notebook = await this.findNotebook(options.notebookName || LLM_WIKI_DEFAULT_NOTEBOOK);
    const layerPrefix = options.layer && options.layer !== "agents" ? `/${options.layer}/` : undefined;
    const escapedQuery = escapeSql(query.trim());
    const clauses = [
      `box = '${escapeSql(notebook.id)}'`,
      "type = 'd'",
      "content != ''",
      layerPrefix ? `hpath LIKE '${escapeSql(layerPrefix)}%'` : "(hpath LIKE '/wiki/%' OR hpath LIKE '/skills/%')",
      escapedQuery ? `(content LIKE '%${escapedQuery}%' OR hpath LIKE '%${escapedQuery}%')` : "1 = 1",
    ];
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, content, hpath, updated",
        "FROM blocks",
        `WHERE ${clauses.join(" AND ")}`,
        "ORDER BY updated DESC",
        `LIMIT ${options.limit || 5}`,
      ].join(" "),
    );
    const results: KnowledgeSearchResult[] = [];
    for (const row of rows) {
        const path = fullPathFor(notebook.name, row.hpath || "");
        const layer = classifyLlmWikiPath(path, notebook.name);
        if (!row.id || !row.hpath || !layer) continue;
        results.push({
          id: row.id,
          title: cleanText(row.content || titleFromPath(row.hpath)),
          path,
          layer,
          summary: summaryOf(row.content || row.hpath),
          updated: row.updated,
        });
    }
    return results;
  }

  async listSkillManifests(notebookName = LLM_WIKI_DEFAULT_NOTEBOOK): Promise<SkillManifest[]> {
    const notebook = await this.findNotebook(notebookName);
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, content, hpath, updated",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebook.id)}'`,
        "AND type = 'd'",
        "AND hpath LIKE '/skills/%'",
        "ORDER BY hpath ASC",
        "LIMIT 500",
      ].join(" "),
    );
    const rowsByHpath = new Map(rows.filter((row) => row.hpath).map((row) => [row.hpath || "", row]));
    return rows
      .filter((row) => row.hpath && isSkillRoot(row.hpath))
      .filter((row) => Boolean(rowsByHpath.get(skillEntryPath(row.hpath || ""))))
      .map((row) => {
        const name = titleFromPath(row.hpath || "");
        const entry = rowsByHpath.get(skillEntryPath(row.hpath || ""));
        return {
          name,
          summary: summaryOf(entry?.content || row.content || name),
          triggers: [name],
          sourcePath: fullPathFor(notebook.name, entry?.hpath || ""),
          requiredTools: ["mcp.fs"],
          writePolicy: "auto-safe",
        };
      });
  }

  async createDocumentWithMarkdown(path: string, markdown: string, notebookName = LLM_WIKI_DEFAULT_NOTEBOOK): Promise<string> {
    const notebook = await this.findNotebook(notebookName);
    return this.postJson<string>("/api/filetree/createDocWithMd", {
      notebook: notebook.id,
      path: hpathFor(path, notebook.name),
      markdown,
    });
  }

  async ensureDocumentPath(path: string, notebookName = LLM_WIKI_DEFAULT_NOTEBOOK): Promise<string> {
    const notebook = await this.findNotebook(notebookName);
    const hpath = hpathFor(path, notebook.name);
    const parts = hpath.split("/").filter(Boolean);
    let current = "";
    let latestId = "";
    for (const part of parts) {
      current = `${current}/${part}`;
      const existing = (await this.getIdsByHPath(notebook.id, current))[0];
      if (existing) {
        latestId = existing;
        continue;
      }
      latestId = await this.postJson<string>("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: current,
        markdown: `# ${part}\n`,
      });
    }
    return latestId;
  }

  async query<T>(stmt: string): Promise<T[]> {
    return this.postJson<T[]>("/api/query/sql", { stmt });
  }

  private async findNotebook(name: string): Promise<SiyuanNotebook> {
    const data = await this.postJson<{ notebooks: SiyuanNotebook[] }>("/api/notebook/lsNotebooks", {});
    const notebook = data.notebooks.find((item) => item.name === name);
    if (!notebook) throw new Error(`未找到 ${name} 笔记本`);
    if (notebook.closed) throw new Error(`${name} 笔记本当前处于关闭状态`);
    return notebook;
  }

  private async getIdsByHPath(notebookId: string, hpath: string): Promise<string[]> {
    try {
      return await this.postJson<string[]>("/api/filetree/getIDsByHPath", { notebook: notebookId, path: hpath });
    } catch {
      return [];
    }
  }

  private async exportMarkdown(id: string): Promise<SiyuanExportMd> {
    return this.postJson<SiyuanExportMd>("/api/export/exportMdContent", { id });
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
