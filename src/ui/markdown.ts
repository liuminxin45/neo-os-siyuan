const URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

type TableAlign = "left" | "center" | "right" | undefined;

export interface MarkdownDocumentTarget {
  id?: string;
  title?: string;
  path?: string;
}

export interface MarkdownRenderOptions {
  onOpenDocument?: (target: MarkdownDocumentTarget) => void;
}

export const renderMarkdown = (target: HTMLElement, markdown: string, options: MarkdownRenderOptions = {}): void => {
  target.replaceChildren();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([^\s`]*)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (fence[1]) code.dataset.language = fence[1];
      code.textContent = codeLines.join("\n");
      pre.append(code);
      target.append(pre);
      continue;
    }

    if (isHorizontalRule(line)) {
      target.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const element = document.createElement(`h${level}`);
      appendInlineMarkdown(element, heading[2], options);
      target.append(element);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      const blockquote = document.createElement("blockquote");
      renderMarkdown(blockquote, quoteLines.join("\n"), options);
      target.append(blockquote);
      continue;
    }

    if (isTableStart(lines, index)) {
      const { table, nextIndex } = renderTable(lines, index, options);
      target.append(table);
      index = nextIndex;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!itemMatch || /\d+\./.test(itemMatch[2]) !== ordered) break;
        const item = document.createElement("li");
        const task = itemMatch[3].match(/^\[([ xX])\]\s+(.+)$/);
        if (task && !ordered) {
          item.className = "siyuan-addon-markdown-task";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = task[1].toLowerCase() === "x";
          checkbox.disabled = true;
          item.append(checkbox);
          appendInlineMarkdown(item, task[2], options);
        } else {
          appendInlineMarkdown(item, itemMatch[3], options);
        }
        list.append(item);
        index += 1;
      }
      target.append(list);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !isHorizontalRule(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !isTableStart(lines, index) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"), options);
    target.append(paragraph);
  }
};

export const appendInlineMarkdown = (target: HTMLElement, markdown: string, options: MarkdownRenderOptions = {}): void => {
  const pattern =
    /(`[^`]+`|\[\[[^\]]+]]|!\[[^\]]*]\([^)]+\)|\[[^\]]+]\([^)]+\)|https?:\/\/[^\s<)]+|~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\n)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown))) {
    if (match.index > lastIndex) {
      target.append(document.createTextNode(markdown.slice(lastIndex, match.index)));
    }
    appendInlineToken(target, match[0], options);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < markdown.length) {
    target.append(document.createTextNode(markdown.slice(lastIndex)));
  }
};

const appendInlineToken = (target: HTMLElement, token: string, options: MarkdownRenderOptions): void => {
  if (token === "\n") {
    target.append(document.createElement("br"));
    return;
  }

  if (token.startsWith("`") && token.endsWith("`")) {
    const code = document.createElement("code");
    code.textContent = token.slice(1, -1);
    target.append(code);
    return;
  }

  const wikiLink = token.match(/^\[\[([^\]]+)]]$/);
  if (wikiLink) {
    appendDocumentButton(target, wikiLink[1], { title: wikiLink[1] }, options);
    return;
  }

  const image = token.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
  if (image) {
    const src = safeImageSrc(image[2].trim());
    if (src) {
      const element = document.createElement("img");
      element.src = src;
      element.alt = image[1];
      element.loading = "lazy";
      target.append(element);
      return;
    }
    target.append(document.createTextNode(image[1]));
    return;
  }

  if (/^https?:\/\//.test(token)) {
    const href = safeHref(token);
    if (href) {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = token;
      target.append(anchor);
      return;
    }
  }

  const deleted = token.match(/^~~([\s\S]+)~~$/);
  if (deleted) {
    const element = document.createElement("del");
    appendInlineMarkdown(element, deleted[1], options);
    target.append(element);
    return;
  }

  const strong = token.match(/^(\*\*|__)([\s\S]+)\1$/);
  if (strong) {
    const element = document.createElement("strong");
    appendInlineMarkdown(element, strong[2], options);
    target.append(element);
    return;
  }

  const emphasis = token.match(/^(\*|_)([\s\S]+)\1$/);
  if (emphasis) {
    const element = document.createElement("em");
    appendInlineMarkdown(element, emphasis[2], options);
    target.append(element);
    return;
  }

  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const label = link[1].trim();
    const rawHref = link[2].trim();
    if (rawHref.startsWith("siyuan-doc://")) {
      appendDocumentButton(target, label, { title: label, id: rawHref.replace(/^siyuan-doc:\/\//, "") }, options);
      return;
    }
    const href = safeHref(rawHref);
    if (href) {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      appendInlineMarkdown(anchor, label, options);
      target.append(anchor);
      return;
    }
    if (isDocumentHref(rawHref, options)) {
      appendDocumentButton(target, label, { title: label, path: rawHref }, options);
      return;
    }
    target.append(document.createTextNode(label));
    return;
  }

  target.append(document.createTextNode(token));
};

const isHorizontalRule = (line: string): boolean => /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);

const isTableStart = (lines: string[], index: number): boolean =>
  index + 1 < lines.length && splitTableRow(lines[index]).length > 1 && isTableSeparator(lines[index + 1]);

const renderTable = (
  lines: string[],
  startIndex: number,
  options: MarkdownRenderOptions,
): { table: HTMLTableElement; nextIndex: number } => {
  const headerCells = splitTableRow(lines[startIndex]);
  const aligns = splitTableRow(lines[startIndex + 1]).map(parseTableAlign);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const columnCount = headerCells.length;

  headerCells.forEach((cell, cellIndex) => {
    const th = document.createElement("th");
    applyTableAlign(th, aligns[cellIndex]);
    appendInlineMarkdown(th, cell.trim(), options);
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  let index = startIndex + 2;
  while (index < lines.length && lines[index].trim() && splitTableRow(lines[index]).length > 1) {
    if (isTableSeparator(lines[index])) {
      index += 1;
      continue;
    }
    const row = document.createElement("tr");
    const cells = splitTableRow(lines[index]);
    for (let cellIndex = 0; cellIndex < columnCount; cellIndex += 1) {
      const td = document.createElement("td");
      applyTableAlign(td, aligns[cellIndex]);
      appendInlineMarkdown(td, (cells[cellIndex] || "").trim(), options);
      row.append(td);
    }
    tbody.append(row);
    index += 1;
  }
  table.append(tbody);
  return { table, nextIndex: index };
};

const splitTableRow = (line: string): string[] => {
  let content = line.trim();
  if (!content.includes("|")) return [];
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|") && !content.endsWith("\\|")) content = content.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\\" && next === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
};

const isTableSeparator = (line: string): boolean => {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
};

const parseTableAlign = (cell: string): TableAlign => {
  const value = cell.trim();
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  if (value.startsWith(":")) return "left";
  return undefined;
};

const applyTableAlign = (cell: HTMLTableCellElement, align: TableAlign): void => {
  if (align) cell.style.textAlign = align;
};

const safeHref = (href: string): string | undefined => {
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return URL_PROTOCOLS.has(url.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
};

const safeImageSrc = (src: string): string | undefined => {
  try {
    const url = new URL(src);
    return IMAGE_PROTOCOLS.has(url.protocol) ? src : undefined;
  } catch {
    return undefined;
  }
};

const isDocumentHref = (href: string, options: MarkdownRenderOptions): boolean =>
  Boolean(options.onOpenDocument) &&
  !href.startsWith("#") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
  /(?:^|\/)(wiki|raw|runs|skills)\//i.test(href.replace(/\\/g, "/"));

const appendDocumentButton = (
  target: HTMLElement,
  label: string,
  documentTarget: MarkdownDocumentTarget,
  options: MarkdownRenderOptions,
): void => {
  if (!options.onOpenDocument) {
    target.append(document.createTextNode(`[[${label}]]`));
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "siyuan-addon-doc-link";
  button.textContent = label.includes("|") ? label.split("|").slice(-1)[0].trim() : label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onOpenDocument?.(documentTarget);
  });
  target.append(button);
};
