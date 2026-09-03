import { readFile } from "node:fs/promises";
import MiniSearch from "minisearch";

// The example index (#654): every East program example stored as its IR with
// the TypeScript and python printed from it, UI and hand-written examples as
// their authored TypeScript. Searched by what an example IS — its keywords,
// description, the builtins it calls, its types — and rendered in the
// language the caller asks for, as a summary or in full.

export const MIN_SCORE = 5;

export type Language = "typescript" | "python";
export type Format = "summary" | "full";

export interface IndexEntry {
  id: string;
  skill: string;
  package: string;
  file: string;
  suite: string;
  test: string;
  keywords: string[];
  imports: string[];
  /** `["typescript", "python"]` (a program, printed from IR), `["tsx"]` (JSX-authored UI), `["typescript"]` (authored, not a program). */
  languages: Array<"typescript" | "python" | "tsx">;
  /** Authored TypeScript (UI and static entries). */
  source?: string;
  /** The example's IR as JSON (program entries). */
  ir?: string;
  /** The TypeScript printed from the IR (program entries). */
  ts?: string;
  /** The python printed from the IR, or null when the index was built without python (program entries). */
  python?: string | null;
  signature?: { inputs: string[]; output: string; async: boolean };
  inputs?: string | null;
  returns?: string | null;
  builtins?: string[];
}

interface IndexData {
  version?: number;
  entries: IndexEntry[];
}

/** The fields MiniSearch scores — derived text, not stored twice. */
interface SearchDocument extends IndexEntry {
  keywordsText: string;
  builtinsText: string;
  typesText: string;
  code: string;
}

export type ExampleIndex = MiniSearch<SearchDocument>;

/** The loaded index: the search over it and the package names it holds. */
export interface LoadedIndex {
  search: ExampleIndex;
  /** Every indexed package name, sorted — the values the `package` filter accepts. */
  packages: string[];
}

/** The searchable index over `indexPath` (loaded once per process). */
export async function buildSearchIndex(indexPath: string): Promise<ExampleIndex> {
  return (await loadIndex(indexPath)).search;
}

/** The index over `indexPath`, with its package names. */
export async function loadIndex(indexPath: string): Promise<LoadedIndex> {
  const raw = await readFile(indexPath, "utf-8");
  const data = JSON.parse(raw) as IndexData;

  const miniSearch = new MiniSearch<SearchDocument>({
    idField: "id",
    fields: ["keywordsText", "test", "builtinsText", "suite", "typesText", "code"],
    storeFields: ["id", "skill", "package", "suite", "test", "keywords", "imports", "languages", "source", "ts", "python", "signature", "inputs", "returns", "builtins"],
    searchOptions: {
      boost: { keywordsText: 3, test: 2, builtinsText: 2, suite: 1.5, typesText: 1, code: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const documents = data.entries.map((entry): SearchDocument => ({
    ...entry,
    keywordsText: entry.keywords.join(" "),
    builtinsText: (entry.builtins ?? []).join(" "),
    typesText: entry.signature ? [...entry.signature.inputs, entry.signature.output].join(" ") : "",
    code: entry.source ?? entry.ts ?? "",
  }));

  miniSearch.addAll(documents);
  return { search: miniSearch, packages: [...new Set(data.entries.map((e) => e.package))].sort() };
}

/** A package filter as the index names packages: `@elaraai/east-node-io` and `east-node-io` are the same package. */
export function normalizePackage(filter: string): string {
  return filter.trim().toLowerCase().replace(/^@elaraai\//, "");
}

export interface SearchRequest {
  query: string;
  limit: number;
  /** A package or skill name; the `@elaraai/` scope is accepted and ignored. */
  package?: string | undefined;
}

export interface SearchResult {
  entries: IndexEntry[];
  /** Set when the package filter names no indexed package — the caller should say so, with `known`. */
  unknownPackage?: string;
  known: string[];
}

/**
 * The search the tool runs: scored hits above `MIN_SCORE`, the package
 * filter applied INSIDE the search so `limit` counts filtered hits (a filter
 * applied after a capped result list starves), and an unknown package
 * reported rather than returned as an empty list.
 */
export function searchExamples(index: LoadedIndex, request: SearchRequest): SearchResult {
  const known = index.packages;
  const filter = request.package;
  const pkg = typeof filter === "string" && filter.trim() !== "" ? normalizePackage(filter) : undefined;
  if (pkg !== undefined && typeof filter === "string" && !known.includes(pkg)) {
    return { entries: [], unknownPackage: filter, known };
  }
  const options = {
    limit: request.limit,
    ...(pkg === undefined ? {} : { filter: (r: { package: string; skill: string }) => r.package === pkg || r.skill === pkg }),
  } as unknown as Parameters<ExampleIndex["search"]>[1];
  const hits = index.search.search(request.query, options) as unknown as Array<IndexEntry & { score: number }>;
  return { entries: hits.filter((r) => r.score >= MIN_SCORE).slice(0, request.limit), known };
}

/** `(inputs) -> output`, or the kind of a non-program entry. */
function signatureOf(entry: IndexEntry): string {
  if (entry.signature === undefined) return entry.languages.includes("tsx") ? "tsx (a UI component, authored as JSX)" : "typescript (authored)";
  const arrow = entry.signature.async ? "~>" : "->";
  return `(${entry.signature.inputs.join(", ")}) ${arrow} ${entry.signature.output}`;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Whether an entry has something to show for a requested language: `typescript` covers authored TSX too. */
export function speaks(entry: IndexEntry, language: Language): boolean {
  return language === "python" ? entry.languages.includes("python") : entry.languages.some((l) => l === "typescript" || l === "tsx");
}

/** The code of an entry in `language` and the fence it takes, or null when the entry has none in it. */
export function codeOf(entry: IndexEntry, language: Language): { code: string; fence: string } | null {
  if (language === "python") return entry.python ? { code: entry.python, fence: "python" } : null;
  if (entry.ts !== undefined) return { code: entry.ts, fence: "typescript" };
  if (entry.source !== undefined) {
    return { code: [...entry.imports, "", entry.source].join("\n"), fence: entry.languages.includes("tsx") ? "tsx" : "typescript" };
  }
  return null;
}

/** One line per hit: id, description, signature, keywords, the example's inputs and result. */
export function formatSummary(entries: IndexEntry[], language: Language): string {
  const lines = entries.map((e) => {
    const parts = [`- \`${e.id}\` — ${e.test}`, `  ${signatureOf(e)}`];
    if (e.keywords.length > 0) parts.push(`  keywords: ${clip(e.keywords.join(", "), 160)}`);
    if (e.inputs !== undefined && e.inputs !== null) parts.push(`  e.g. ${clip(e.inputs, 100)} → ${e.returns === null || e.returns === undefined ? "(see the example)" : clip(e.returns, 100)}`);
    if (language === "python" && !speaks(e, "python")) parts.push(`  (${e.languages.join("/")} only)`);
    else if (language === "python" && !e.python) parts.push("  (no python rendering in this index build)");
    return parts.join("\n");
  });
  return [
    "<east-examples>",
    `## ${entries.length} East example(s) — fetch one in full with get_east_example(id, language: "${language}")`,
    "",
    ...lines,
    "</east-examples>",
  ].join("\n");
}

/** An entry in full: its description, signature, code in `language`, and the example inputs and result. */
export function formatFull(entries: IndexEntry[], language: Language): string {
  const sections = entries.map((e) => {
    const code = codeOf(e, language);
    const body = code === null
      ? (!speaks(e, language)
        ? `_${e.languages.join("/")} only: request language: "typescript"._`
        : "_No python rendering in this index build._")
      : ["```" + code.fence, code.code, "```"].join("\n");
    const io = e.inputs !== undefined && e.inputs !== null
      ? `Inputs: \`${clip(e.inputs, 300)}\`${e.returns === null || e.returns === undefined ? "" : ` → returns \`${clip(e.returns, 300)}\``}`
      : "";
    return [
      `### \`${e.id}\``,
      `${e.test} · Suite: ${e.suite} · Package: ${e.package}`,
      `Signature: ${signatureOf(e)}`,
      e.keywords.length > 0 ? `Keywords: ${e.keywords.join(", ")}` : "",
      "",
      body,
      io,
    ].filter((l) => l !== "").join("\n");
  });
  return ["<east-examples>", ...sections, "</east-examples>"].join("\n\n");
}

/** Search results as the tool renders them. */
export function formatResults(entries: IndexEntry[], language: Language, format: Format): string {
  return format === "full" ? formatFull(entries, language) : formatSummary(entries, language);
}

/** The index entry with `id`, or null. */
export function getEntry(index: ExampleIndex, id: string): IndexEntry | null {
  const stored = index.getStoredFields(id) as unknown as IndexEntry | undefined;
  return stored === undefined ? null : stored;
}
