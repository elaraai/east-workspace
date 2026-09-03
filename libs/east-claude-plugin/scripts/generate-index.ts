/**
 * generate-index.ts
 *
 * Builds the example search index (index.json) the plugin's MCP search tool
 * serves (#654).
 *
 * Usage: node dist/scripts/generate-index.js --base-dir /path/to/libs
 *
 * Two kinds of source, declared in index.config.json:
 *
 * - `ir: true` — a package whose `*.examples.ts` are East programs (east,
 *   east-node-std, east-node-io, east-py-datascience). Each `example()` export
 *   is imported from the package's BUILT test modules (`distTest`) and stored
 *   as its IR — the example itself, loc_ids zeroed — with its declared types,
 *   inputs, expected return, the builtins and platform functions it calls,
 *   and the TypeScript printed from that IR by `East.toSource`. The python
 *   rendering is added by `scripts/render-python.py` (the python printer),
 *   which fills the `python` field this script leaves null. No authored
 *   source text is stored: both languages are printings of the IR.
 * - otherwise — a package whose examples are not printable programs (UI
 *   components authored as JSX, hand-written CLI stubs): the authored
 *   TypeScript source is extracted from the file text, as before.
 *
 * Each example uses the `example()` pattern:
 *   export const name = example({ keywords, description, fn, inputs, returns })
 *
 * Section comments (// ---\n// Name\n// ---) provide suite grouping.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Expr, IRType, toJSONFor, toEastTypeValue, toSource, typeSource } from "@elaraai/east";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceConfig {
    package: string;
    skill: string;
    testDir: string;
    pattern: string | string[];
    /** The examples are East programs: store their IR (see the module notes). */
    ir?: boolean;
    /** The package's build output (mirrors the package layout: `test/x.examples.ts` → `dist/test/x.examples.js`); default `<testDir>/dist`. */
    dist?: string;
}

interface IndexConfig {
    sources: SourceConfig[];
}

/** One example. A program entry carries `ir` / `ts` / `python` / `signature` / `inputs` / `returns` / `builtins`; a source entry carries `source`. */
export interface IndexEntry {
    id: string;
    skill: string;
    package: string;
    file: string;
    suite: string;
    test: string;
    keywords: string[];
    imports: string[];
    /**
     * What the entry can be shown as: `["typescript", "python"]` for a program
     * (both printed from its IR), `["tsx"]` for a JSX-authored UI example,
     * `["typescript"]` for authored TypeScript that is not a printable program.
     * Derived from the package and the file, never declared per example.
     */
    languages: Array<"typescript" | "python" | "tsx">;
    /** Authored TypeScript (UI and static entries only). */
    source?: string;
    /** The example's IR as JSON, loc_ids zeroed (program entries). */
    ir?: string;
    /** The TypeScript printed from `ir` (program entries). */
    ts?: string;
    /** The python printed from `ir`; null until `render-python.py` runs (program entries). */
    python?: string | null;
    /** The declared function type, as TypeScript type constructors (program entries). */
    signature?: { inputs: string[]; output: string; async: boolean };
    /** The example inputs and expected return as JSON (program entries; null when they are expressions). */
    inputs?: string | null;
    returns?: string | null;
    /** The builtins and platform functions the IR calls, sorted (program entries). */
    builtins?: string[];
}

interface IndexStats {
    totalEntries: number;
    totalFiles: number;
    packages: Record<string, number>;
}

interface IndexOutput {
    version: number;
    stats: IndexStats;
    entries: IndexEntry[];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): { baseDir: string } {
    const idx = args.indexOf("--base-dir");
    if (idx === -1 || idx + 1 >= args.length) {
        console.error("Usage: generate-index --base-dir <path>");
        process.exit(1);
    }
    return { baseDir: args[idx + 1]! };
}

// ---------------------------------------------------------------------------
// Glob-style pattern matching (minimal, supports * and **)
// ---------------------------------------------------------------------------

function patternToRegex(pattern: string): RegExp {
    let re = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\0GLOBSTAR\0")
        .replace(/\*/g, "[^/]*")
        .replace(/\0GLOBSTAR\0/g, ".*");
    return new RegExp(`^${re}$`);
}

function findFiles(dir: string, pattern: string): string[] {
    const regex = patternToRegex(pattern);
    const results: string[] = [];

    function walk(currentDir: string, relativePath: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "dist") continue;
                walk(path.join(currentDir, entry.name), rel);
            } else if (entry.isFile() && regex.test(rel)) {
                results.push(path.join(currentDir, entry.name));
            }
        }
    }

    walk(dir, "");
    return results.sort();
}

// ---------------------------------------------------------------------------
// Extract imports (stop at first export or section divider)
// ---------------------------------------------------------------------------

function extractImports(lines: string[]): string[] {
    const imports: string[] = [];
    for (const line of lines) {
        if (/^\s*export\s+const\s/.test(line) || /^\/\/ -{3,}/.test(line)) {
            break;
        }
        if (/^\s*import\s/.test(line)) {
            imports.push(line.trimEnd());
        }
    }
    return imports;
}

// ---------------------------------------------------------------------------
// Balanced bracket/paren/brace matching (string/comment aware)
// ---------------------------------------------------------------------------

/**
 * Starting from an opening bracket at `content[openIndex]`, find the
 * matching closing bracket. Handles `{}`, `()`, `[]` and skips over
 * string literals (single, double, template) and comments.
 *
 * Returns the index of the matching closing bracket, or null if unbalanced.
 */
function findMatchingBrace(content: string, openIndex: number): number | null {
    const openCh = content[openIndex]!;
    const closeCh = openCh === "{" ? "}" : openCh === "(" ? ")" : openCh === "[" ? "]" : null;
    if (closeCh == null) return null;

    let depth = 1;
    let i = openIndex + 1;

    while (i < content.length && depth > 0) {
        const ch = content[i]!;

        // Skip string literals
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            i++;
            while (i < content.length && content[i] !== quote) {
                if (content[i] === "\\") i++;
                i++;
            }
            i++;
            continue;
        }

        // Skip line comments
        if (ch === "/" && i + 1 < content.length && content[i + 1] === "/") {
            while (i < content.length && content[i] !== "\n") i++;
            continue;
        }

        // Skip block comments
        if (ch === "/" && i + 1 < content.length && content[i + 1] === "*") {
            i += 2;
            while (i + 1 < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
                i++;
            }
            i += 2;
            continue;
        }

        if (ch === openCh) depth++;
        else if (ch === closeCh) depth--;

        i++;
    }

    return depth === 0 ? i - 1 : null;
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a string-array literal from text, e.g. `["a", "b", "c"]` -> ["a","b","c"]
 */
function parseStringArray(text: string): string[] {
    const results: string[] = [];
    const re = /["'`]([^"'`]*)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        results.push(m[1]!);
    }
    return results;
}

/**
 * Extract a string literal value from text like `"some description"` or `'desc'`
 */
function parseStringLiteral(text: string): string | null {
    const m = /^["'`]([\s\S]*?)["'`]/.exec(text.trim());
    return m != null ? m[1]! : null;
}

/**
 * Extract the text for a field value starting after `fieldName:` within an object literal.
 * Handles nested brackets, strings, and comments. Returns the raw text of the value.
 */
function extractFieldValue(objText: string, fieldName: string): string | null {
    const fieldRe = new RegExp(`(?:^|[,{\\n])\\s*${fieldName}\\s*:\\s*`, "gm");
    const match = fieldRe.exec(objText);
    if (match == null) return null;

    const valueStart = match.index + match[0].length;
    let i = valueStart;

    while (i < objText.length && /\s/.test(objText[i]!)) i++;
    if (i >= objText.length) return null;

    const startCh = objText[i]!;

    // If value starts with a bracket, find matching close
    if (startCh === "[" || startCh === "(" || startCh === "{") {
        const closeIndex = findMatchingBrace(objText, i);
        if (closeIndex == null) return null;
        return objText.slice(i, closeIndex + 1);
    }

    // If value starts with a string literal, extract it (including quotes)
    if (startCh === '"' || startCh === "'" || startCh === "`") {
        const quote = startCh;
        let j = i + 1;
        while (j < objText.length && objText[j] !== quote) {
            if (objText[j] === "\\") j++;
            j++;
        }
        return objText.slice(i, j + 1);
    }

    // Otherwise, scan until comma or closing brace at depth 0
    let depth = 0;
    let j = i;
    while (j < objText.length) {
        const ch = objText[j]!;

        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            j++;
            while (j < objText.length && objText[j] !== quote) {
                if (objText[j] === "\\") j++;
                j++;
            }
            j++;
            continue;
        }

        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") {
            if (depth === 0) break;
            depth--;
        } else if (ch === "," && depth === 0) {
            break;
        }

        j++;
    }

    return objText.slice(i, j).trim();
}

/**
 * Extract the `fn:` field value — specifically the `East.function(...)` or similar expression.
 */
function extractFnValue(objText: string): string | null {
    const fnRe = /(?:^|[,{\n])\s*fn\s*:\s*/gm;
    const match = fnRe.exec(objText);
    if (match == null) return null;

    let i = match.index + match[0].length;

    while (i < objText.length && /\s/.test(objText[i]!)) i++;
    if (i >= objText.length) return null;

    // Find the opening paren of `East.function(`
    const valueStart = i;
    while (i < objText.length && objText[i] !== "(") {
        if (objText[i] === "," || objText[i] === "}") return null;
        i++;
    }
    if (i >= objText.length) return null;

    const closeIndex = findMatchingBrace(objText, i);
    if (closeIndex == null) return null;

    return objText.slice(valueStart, closeIndex + 1);
}

// ---------------------------------------------------------------------------
// Parse a single examples file (*.examples.ts)
// ---------------------------------------------------------------------------

interface ParsedExample {
    exportName: string;
    suiteName: string;
    description: string;
    keywords: string[];
    source: string;
    imports: string[];
}

function parseExamplesFile(filePath: string): ParsedExample[] {
    // Normalise CRLF/CR to LF so the extracted source (and the index built from
    // it) is byte-identical regardless of the checkout's line-ending settings.
    const content = fs.readFileSync(filePath, "utf-8").replace(/\r\n?/g, "\n");
    const lines = content.split("\n");
    const imports = extractImports(lines);
    const results: ParsedExample[] = [];

    // Extract section names from comment dividers
    const sectionRe = /^\/\/ -{3,}\s*\n\/\/ (.+)\n\/\/ -{3,}/gm;
    interface Section { name: string; index: number; }
    const sections: Section[] = [];
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = sectionRe.exec(content)) !== null) {
        sections.push({ name: sectionMatch[1]!.trim(), index: sectionMatch.index });
    }

    // Find all `export const NAME = example({` declarations
    const exportRe = /export\s+const\s+(\w+)\s*=\s*example\s*\(\s*\{/g;
    let exportMatch: RegExpExecArray | null;

    while ((exportMatch = exportRe.exec(content)) !== null) {
        const exportName = exportMatch[1]!;
        const exportIndex = exportMatch.index;

        // Determine which section this export belongs to
        let currentSuite = "";
        for (const section of sections) {
            if (section.index < exportIndex) {
                currentSuite = section.name;
            } else {
                break;
            }
        }

        // The `{` is the last char of exportMatch[0]
        const openBraceIndex = exportMatch.index + exportMatch[0].length - 1;
        const closeBraceIndex = findMatchingBrace(content, openBraceIndex);
        if (closeBraceIndex == null) {
            console.warn(`  Warning: Could not find matching brace for example "${exportName}" in ${filePath}`);
            continue;
        }

        const objText = content.slice(openBraceIndex, closeBraceIndex + 1);

        // Extract fields
        const keywordsRaw = extractFieldValue(objText, "keywords");
        const keywords = keywordsRaw != null ? parseStringArray(keywordsRaw) : [];

        const descriptionRaw = extractFieldValue(objText, "description");
        const description = descriptionRaw != null ? (parseStringLiteral(descriptionRaw) ?? "") : "";

        const fnValue = extractFnValue(objText);
        if (fnValue == null) {
            console.warn(`  Warning: Could not extract fn for example "${exportName}" in ${filePath}`);
            continue;
        }

        const inputsRaw = extractFieldValue(objText, "inputs");
        const returnsRaw = extractFieldValue(objText, "returns");

        // Compose annotated source: prepend description + inputs/returns as comments
        const commentLines: string[] = [];
        if (description) {
            commentLines.push(`// ${description}`);
        }
        if (inputsRaw != null || returnsRaw != null) {
            const parts: string[] = [];
            if (inputsRaw != null) parts.push(`inputs: ${inputsRaw}`);
            if (returnsRaw != null) parts.push(`returns: ${returnsRaw}`);
            commentLines.push(`// ${parts.join("  ")}`);
        }

        const source = [...commentLines, fnValue].join("\n");

        results.push({
            exportName,
            suiteName: currentSuite,
            description,
            keywords,
            source,
            imports,
        });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Program entries: the example's IR and what is printed from it
// ---------------------------------------------------------------------------

/** The JSON of `value` with every `loc_id` zeroed — an index carries no source map. */
function zeroLocations(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(zeroLocations);
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = k === "loc_id" ? "0" : zeroLocations(v);
        }
        return out;
    }
    return value;
}

/** The builtin and platform function names an IR (as JSON) calls, sorted and unique. */
function builtinsOf(irJson: unknown): string[] {
    const names = new Set<string>();
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) { for (const x of v) walk(x); return; }
        if (v === null || typeof v !== "object") return;
        const node = v as { type?: unknown; value?: unknown };
        if (typeof node.type === "string" && node.value !== null && typeof node.value === "object") {
            const p = node.value as Record<string, unknown>;
            if (node.type === "Builtin" && typeof p["builtin"] === "string") names.add(p["builtin"]);
            if (node.type === "Platform" && typeof p["name"] === "string") names.add(p["name"]);
        }
        for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    };
    walk(irJson);
    return [...names].sort();
}

const exportIR = toJSONFor(IRType);

/**
 * The program fields of one built `example()` export: IR, printed
 * TypeScript, signature, inputs, expected return, builtins.
 */
function programFields(exportName: string, ex: { fn: any; inputs: unknown[]; returns?: unknown }): Pick<IndexEntry, "ir" | "ts" | "python" | "signature" | "inputs" | "returns" | "builtins"> {
    const fnType = Expr.type(ex.fn) as { type: string; inputs: any[]; output: any };
    const bundle = ex.fn.toIR();
    const irJson = zeroLocations(exportIR(bundle.ir));
    const isExpr = (v: unknown): boolean => v instanceof Expr;
    const inputs = ex.inputs.some(isExpr) ? null : JSON.stringify(ex.inputs.map((v, i) => toJSONFor(fnType.inputs[i])(v as any)));
    const returns = ex.returns === undefined || isExpr(ex.returns) ? null : JSON.stringify(toJSONFor(fnType.output)(ex.returns as any));
    return {
        ir: JSON.stringify(irJson),
        ts: toSource(bundle.ir, { name: exportName }),
        python: null,
        signature: {
            inputs: fnType.inputs.map((t) => typeSource(toEastTypeValue(t))),
            output: typeSource(toEastTypeValue(fnType.output)),
            async: fnType.type === "AsyncFunction",
        },
        inputs,
        returns,
        builtins: builtinsOf(irJson),
    };
}

/** The built module of an examples file: the package's `dist` mirrors its layout, so `test/a/b.examples.ts` is `dist/test/a/b.examples.js`. */
async function loadExamplesModule(packageDir: string, dist: string, filePath: string): Promise<Record<string, unknown>> {
    const built = path.join(dist, path.relative(packageDir, filePath)).replace(/\.tsx?$/, ".js");
    if (!fs.existsSync(built)) {
        throw new Error(`built example module not found: ${built} — build the package first (its tsconfig must include the test directory)`);
    }
    return (await import(pathToFileURL(built).href)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const { baseDir } = parseArgs(process.argv.slice(2));
    const resolvedBaseDir = path.resolve(baseDir);

    // Resolve project root (dist/scripts -> project root is ../../)
    const projectRoot = path.resolve(import.meta.dirname, "..", "..");

    // Read config
    const configPath = path.join(projectRoot, "index.config.json");
    if (!fs.existsSync(configPath)) {
        console.error(`Config not found: ${configPath}`);
        process.exit(1);
    }

    const config: IndexConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as IndexConfig;
    if (!Array.isArray(config.sources) || config.sources.length === 0) {
        console.error("Invalid config: sources array is empty or missing");
        process.exit(1);
    }

    const entries: IndexEntry[] = [];
    const fileCount = new Set<string>();
    const packageCounts: Record<string, number> = {};

    for (const source of config.sources) {
        const testDir = path.resolve(resolvedBaseDir, source.testDir);

        if (!fs.existsSync(testDir)) {
            console.warn(`Warning: Test directory not found, skipping: ${testDir}`);
            continue;
        }

        // Support pattern as string or string[]
        const patterns = Array.isArray(source.pattern) ? source.pattern : [source.pattern];
        const files = patterns.flatMap(p => findFiles(testDir, p));
        const uniqueFiles = [...new Set(files)].sort();

        console.log(`[${source.package}] Found ${uniqueFiles.length} files in ${testDir}${source.ir ? " (programs: IR)" : ""}`);

        for (const filePath of uniqueFiles) {
            let examples: ParsedExample[];
            try {
                examples = parseExamplesFile(filePath);
            } catch (err) {
                console.warn(`  Warning: Could not parse ${filePath}: ${err}`);
                continue;
            }

            if (examples.length === 0) continue;
            fileCount.add(filePath);

            // Forward slashes so the index is byte-identical whether generated
            // on Windows or POSIX (path.relative emits os-native separators).
            const relFile = path.relative(resolvedBaseDir, filePath).split(path.sep).join("/");

            // A program package: the built module supplies the IR; the text
            // parse supplies the suite each export sits in and its order.
            const built = source.ir
                ? await loadExamplesModule(testDir, path.resolve(resolvedBaseDir, source.dist ?? path.join(source.testDir, "dist")), filePath)
                : null;

            for (const ex of examples) {
                const entry: IndexEntry = {
                    id: `${source.package}:${path.basename(filePath)}:${ex.exportName}`,
                    skill: source.skill,
                    package: source.package,
                    file: relFile,
                    suite: ex.suiteName,
                    test: ex.description,
                    keywords: ex.keywords,
                    imports: ex.imports,
                    languages: built !== null ? ["typescript", "python"] : filePath.endsWith(".tsx") ? ["tsx"] : ["typescript"],
                };
                if (built !== null) {
                    const value = built[ex.exportName] as { fn?: unknown; inputs?: unknown[] } | undefined;
                    if (value === undefined || typeof value !== "object" || !("fn" in value) || !Array.isArray(value.inputs)) {
                        throw new Error(`${relFile}: export "${ex.exportName}" is not an example() in the built module`);
                    }
                    Object.assign(entry, programFields(ex.exportName, value as { fn: any; inputs: unknown[]; returns?: unknown }));
                } else {
                    entry.source = ex.source;
                }
                entries.push(entry);
                packageCounts[source.package] = (packageCounts[source.package] ?? 0) + 1;
            }
        }
    }

    // Merge static entries (e.g. hand-written e3 examples)
    const staticPath = path.join(projectRoot, "index.static.json");
    if (fs.existsSync(staticPath)) {
        const staticData = JSON.parse(fs.readFileSync(staticPath, "utf-8")) as { entries: IndexEntry[] };
        for (const entry of staticData.entries) {
            entries.push({ ...entry, languages: entry.languages ?? ["typescript"] });
            packageCounts[entry.package] = (packageCounts[entry.package] ?? 0) + 1;
        }
        console.log(`\n[static] Merged ${staticData.entries.length} entries from index.static.json`);
    }

    // Build output
    const output: IndexOutput = {
        version: 2,
        stats: {
            totalEntries: entries.length,
            totalFiles: fileCount.size,
            packages: packageCounts,
        },
        entries,
    };

    // Write output
    const outPath = path.join(projectRoot, "index.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

    const programs = entries.filter((e) => e.ir !== undefined).length;
    console.log(`\nGenerated ${outPath}`);
    console.log(`  Entries: ${entries.length} (${programs} programs with IR, python pending: scripts/render-python.py)`);
    console.log(`  Files:   ${fileCount.size}`);
    for (const [pkg, count] of Object.entries(packageCounts)) {
        console.log(`  ${pkg}: ${count}`);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
