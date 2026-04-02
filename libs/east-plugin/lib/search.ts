import { readFile } from "node:fs/promises";
import MiniSearch from "minisearch";

export const MIN_SCORE = 5;

interface IndexEntry {
  id: number;
  skill: string;
  package: string;
  suite: string;
  test: string;
  keywords: string[];
  imports: string[];
  source: string;
  keywordsText?: string;
}

interface IndexData {
  entries: IndexEntry[];
}

export async function buildSearchIndex(indexPath: string) {
  const raw = await readFile(indexPath, "utf-8");
  const data = JSON.parse(raw) as IndexData;

  const miniSearch = new MiniSearch<IndexEntry>({
    fields: ["keywordsText", "test", "suite", "source"],
    storeFields: ["skill", "package", "suite", "test", "keywords", "imports", "source"],
    searchOptions: {
      boost: { keywordsText: 3, test: 2, suite: 1.5, source: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const documents = data.entries.map((entry) => ({
    ...entry,
    keywordsText: entry.keywords.join(" "),
  }));

  miniSearch.addAll(documents);
  return miniSearch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatResults(results: Array<Record<string, any>>): string {
  const sections = results.map((r: Record<string, unknown>) => {
    const keywords = r.keywords as string[];
    const imports = r.imports as string[];
    const keywordsStr = keywords.join(", ");
    const importsStr = imports.join("\n");
    return [
      `### ${r.test as string}`,
      `Suite: ${r.suite as string} | Package: ${r.package as string} | Keywords: ${keywordsStr}`,
      "",
      "```typescript",
      importsStr,
      "",
      r.source as string,
      "```",
    ].join("\n");
  });

  return ["<east-examples>", "## Relevant East Examples", "", ...sections, "</east-examples>"].join(
    "\n"
  );
}
