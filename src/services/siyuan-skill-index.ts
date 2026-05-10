import type { SkillIndexItem } from "../models/skill";

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

const NOTEBOOK_NAME = "LLM-Wiki";
const SKILLS_HPATH_PREFIX = "/skills/";
const MAX_SKILLS = 100;

const escapeSql = (value: string): string => value.replace(/'/g, "''");

const cleanText = (value: string): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const summarize = (value: string): string => {
  const cleaned = cleanText(value);
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
};

const summarizeDescription = (value: string): string => {
  const cleaned = cleanText(value);
  const explicit = cleaned.match(/^(?:summary|description|desc|摘要|简述)\s*[:：]\s*(.+)$/i)?.[1] || cleaned;
  return explicit.length > 160 ? `${explicit.slice(0, 157)}...` : explicit;
};

const fullNotebookPath = (notebookName: string, hpath: string): string =>
  `/${notebookName}${hpath.startsWith("/") ? hpath : `/${hpath}`}`;

export class SiyuanSkillIndexReader {
  async listSkills(): Promise<SkillIndexItem[]> {
    const notebook = await this.findNotebook();
    const docs = await this.query<SiyuanBlockRow>(
      [
        "SELECT id, content, hpath",
        "FROM blocks",
        `WHERE box = '${escapeSql(notebook.id)}'`,
        "AND type = 'd'",
        `AND hpath LIKE '${escapeSql(SKILLS_HPATH_PREFIX)}%'`,
        `AND hpath != '${SKILLS_HPATH_PREFIX.slice(0, -1)}'`,
        "ORDER BY hpath ASC",
        `LIMIT ${MAX_SKILLS}`,
      ].join(" "),
    );

    const items = await Promise.all(
      docs
        .filter((doc) => doc.id && doc.hpath)
        .map(async (doc) => {
          const name = summarize(doc.content || this.nameFromPath(doc.hpath || ""));
          const summary = await this.readSummary(doc.id || "");
          return {
            name: name || this.nameFromPath(doc.hpath || ""),
            summary: summary || "暂无简述",
            sourcePath: fullNotebookPath(notebook.name, doc.hpath || ""),
          };
        }),
    );

    return items.filter((item) => item.name && item.sourcePath);
  }

  private async findNotebook(): Promise<SiyuanNotebook> {
    const data = await this.post<{ notebooks: SiyuanNotebook[] }>("/api/notebook/lsNotebooks", {});
    const notebook = data.notebooks.find((item) => item.name === NOTEBOOK_NAME);
    if (!notebook) throw new Error(`未找到 ${NOTEBOOK_NAME} 笔记本`);
    if (notebook.closed) throw new Error(`${NOTEBOOK_NAME} 笔记本当前处于关闭状态`);
    return notebook;
  }

  private async readSummary(rootId: string): Promise<string> {
    if (!rootId) return "";
    const rows = await this.query<SiyuanBlockRow>(
      [
        "SELECT content",
        "FROM blocks",
        `WHERE root_id = '${escapeSql(rootId)}'`,
        `AND id != '${escapeSql(rootId)}'`,
        "AND type IN ('p', 'l', 'h')",
        "AND content != ''",
        "ORDER BY created ASC",
        "LIMIT 1",
      ].join(" "),
    );
    return summarizeDescription(rows[0]?.content || "");
  }

  private nameFromPath(hpath: string): string {
    const parts = hpath.split("/").map((part) => part.trim()).filter(Boolean);
    return parts[parts.length - 1] || hpath;
  }

  private async query<T>(stmt: string): Promise<T[]> {
    return this.post<T[]>("/api/query/sql", { stmt });
  }

  private async post<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
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
