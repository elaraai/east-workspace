import { readFile } from "node:fs/promises";

const MAX_READ_BYTES = 200_000;

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TranscriptEntry {
  type: string;
  message?: {
    content?: ContentBlock[] | string;
  };
}

export async function readRecentEntries(transcriptPath: string, maxEntries = 30): Promise<TranscriptEntry[]> {
  let raw: string;
  try {
    const buf = await readFile(transcriptPath);
    const slice = buf.length > MAX_READ_BYTES
      ? buf.subarray(buf.length - MAX_READ_BYTES)
      : buf;
    raw = slice.toString("utf-8");
  } catch {
    return [];
  }

  const lines = raw.trimEnd().split("\n");
  const entries: TranscriptEntry[] = [];

  for (let i = lines.length - 1; i >= 0 && entries.length < maxEntries; i--) {
    try {
      const entry = JSON.parse(lines[i]!) as TranscriptEntry;
      if (entry.type === "assistant" || entry.type === "user") {
        entries.push(entry);
      }
    } catch {
      // skip malformed lines (including partial first line from slice)
    }
  }

  return entries;
}

export function extractRecentContext(entries: TranscriptEntry[]): string {
  const texts: string[] = [];
  const files: string[] = [];
  let textCount = 0;

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
        textCount++;
      } else if (block.type === "thinking" && block.thinking) {
        texts.push(block.thinking);
        textCount++;
      } else if (block.type === "tool_use") {
        const filePath = block.input?.file_path;
        if (typeof filePath === "string" && !files.includes(filePath)) {
          files.push(filePath);
        }
        if (block.name === "Grep" && typeof block.input?.pattern === "string") {
          texts.push(block.input.pattern);
        }
      }
    }

    if (textCount >= 5) break;
  }

  const fileContext = files.slice(0, 5).map((f) => f.split("/").pop()).join(" ");
  const reasoning = texts.join("\n").slice(0, 2000);

  return [reasoning, fileContext].filter(Boolean).join("\n");
}

export function extractRecentFiles(entries: TranscriptEntry[], maxFiles = 10): string[] {
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== "tool_use") continue;
      if (!["Read", "Edit", "Write"].includes(block.name ?? "")) continue;

      const filePath = block.input?.file_path;
      if (typeof filePath === "string" && !files.includes(filePath)) {
        files.push(filePath);
        if (files.length >= maxFiles) return files;
      }
    }
  }

  return files;
}
