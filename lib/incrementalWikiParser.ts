export type IncrementalWikiUpdate = {
  suggestedUpdates: Array<{ existingTitle: string; content: string }>;
  newEntries: Array<{ title: string; content: string }>;
};

function cleanIncrementalTitle(value: string) {
  return value.trim().replace(/^[:\s]+/, "").trim();
}

function normaliseIncrementalBlockContent(lines: string[]) {
  return lines.join("\n").trim();
}

export function parseIncrementalWikiUpdate(markdown: string): IncrementalWikiUpdate {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const result: IncrementalWikiUpdate = { suggestedUpdates: [], newEntries: [] };
  let current: { kind: "existing" | "new"; title: string; contentLines: string[] } | null = null;

  const finishCurrent = () => {
    if (!current) return;
    const content = normaliseIncrementalBlockContent(current.contentLines);
    if (current.kind === "existing") {
      result.suggestedUpdates.push({ existingTitle: current.title, content });
    } else {
      result.newEntries.push({ title: current.title, content });
    }
    current = null;
  };

  for (const line of lines) {
    if (/^#{1,2}\s+Not Included\s*$/i.test(line.trim())) {
      finishCurrent();
      break;
    }

    const existingMatch = line.match(/^#{1,2}\s+Existing Entry:\s*(.+)$/i);
    const newMatch = line.match(/^#{1,2}\s+New Entry:\s*(.+)$/i);

    if (existingMatch || newMatch) {
      finishCurrent();
      current = {
        kind: existingMatch ? "existing" : "new",
        title: cleanIncrementalTitle((existingMatch || newMatch)?.[1] || ""),
        contentLines: []
      };
      continue;
    }

    if (current) current.contentLines.push(line);
  }

  finishCurrent();
  result.suggestedUpdates = result.suggestedUpdates.filter((item) => item.existingTitle);
  result.newEntries = result.newEntries.filter((item) => item.title);
  return result;
}
