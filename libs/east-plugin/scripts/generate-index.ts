#!/usr/bin/env node
/**
 * generate-index.ts
 *
 * Builds the example search index (index.json) the plugin's MCP search tool
 * serves (#654) — East's, or a plugin's that builds on East's: the sources,
 * the libraries and the hand-written entries are the caller's.
 *
 * Usage: east-plugin-generate-index --base-dir <dir> [--config <index.config.json>]
 *            [--static <index.static.json>] [--out <index.json>]
 *
 * Each path defaults to this package's own (East's index). From code, call
 * `generateIndex` with the config and entries themselves.
 *
 * Two kinds of source, declared in index.config.json:
 *
 * - `ir: true` — a package whose `*.examples.ts` are East programs (east,
 *   east-node-std, east-node-io, east-py-datascience). Each `example()` export
 *   is imported from the package's BUILT test modules (`distTest`) and stored
 *   as its IR — the example itself, loc_ids zeroed — with its declared types,
 *   inputs, expected return, the builtins and platform functions it calls,
 *   and the TypeScript printed from that IR by `East.toSource` — with the
 *   `libraries` of the config imported and given to the printer, so a
 *   platform call prints as the library exports it (`Compression.Tar.create`)
 *   rather than as a hoisted declaration. The python rendering is added by
 *   `scripts/render-python.py` (the python printer), which fills the
 *   `python` field this script leaves null. No authored source text is
 *   stored: both languages are printings of the IR.
 * - otherwise — a package whose examples are not printable programs (UI
 *   components authored as JSX, hand-written CLI stubs): the authored
 *   TypeScript source is extracted from the file text, as before.
 *
 * Each example uses the `example()` pattern:
 *   export const name = example({ keywords, description, fn, inputs, returns })
 *
 * Section comments (// ---\n// Name\n// ---) provide suite grouping. Each
 * file is read by `examples-file.ts`, through the TypeScript parser.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Expr, IRType, toJSONFor, toEastTypeValue, toSource, typeSource } from "@elaraai/east";
import { parseExamplesFile, type ParsedExample } from "./examples-file.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One package whose examples are indexed. */
export interface SourceConfig {
    package: string;
    skill: string;
    testDir: string;
    pattern: string | string[];
    /** The examples are East programs: store their IR (see the module notes). */
    ir?: boolean;
    /** The package's build output (mirrors the package layout: `test/x.examples.ts` → `dist/test/x.examples.js`); default `<testDir>/dist`. */
    dist?: string;
}

/** What an index holds: `index.config.json`'s shape. */
export interface IndexConfig {
    sources: SourceConfig[];
    /** Library modules whose exported declarations spell platform calls in the printed TypeScript: specifier → built entry, relative to the base dir. */
    libraries?: Record<string, string>;
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

/** How many entries and files an index holds, by package. */
export interface IndexStats {
    totalEntries: number;
    totalFiles: number;
    packages: Record<string, number>;
}

/** An index: `index.json`'s shape. */
export interface IndexOutput {
    version: number;
    stats: IndexStats;
    entries: IndexEntry[];
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
function programFields(exportName: string, ex: { fn: any; inputs: unknown[]; returns?: unknown }, libraries: Record<string, object>): Pick<IndexEntry, "ir" | "ts" | "python" | "signature" | "inputs" | "returns" | "builtins"> {
    const fnType = Expr.type(ex.fn) as { type: string; inputs: any[]; output: any };
    const bundle = ex.fn.toIR();
    const irJson = zeroLocations(exportIR(bundle.ir));
    const isExpr = (v: unknown): boolean => v instanceof Expr;
    const inputs = ex.inputs.some(isExpr) ? null : JSON.stringify(ex.inputs.map((v, i) => toJSONFor(fnType.inputs[i])(v as any)));
    const returns = ex.returns === undefined || isExpr(ex.returns) ? null : JSON.stringify(toJSONFor(fnType.output)(ex.returns as any));
    return {
        ir: JSON.stringify(irJson),
        ts: toSource(bundle.ir, { name: exportName, libraries }),
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
// The index
// ---------------------------------------------------------------------------

/** What `generateIndex` indexes. */
export interface GenerateIndexOptions {
    /** The directory the config's `testDir`, `dist` and library paths are relative to. */
    baseDir: string;
    /** The packages whose examples are indexed, and the libraries their printed TypeScript imports. */
    config: IndexConfig;
    /** Hand-written entries merged in (`index.static.json`'s `entries`), e.g. a CLI's. */
    staticEntries?: readonly IndexEntry[];
    /** Progress lines (default `console.log`). */
    log?: (line: string) => void;
}

/**
 * Builds an index: every `example()` of each source's examples files, a
 * program's as its IR and the TypeScript printed from it, any other's as its
 * authored source, then the hand-written entries. The python printings are
 * `scripts/render-python.py`'s, run over the written index.
 *
 * @param options - The base directory, the config and the hand-written entries
 * @returns The index, ready to write as `index.json`
 * @throws {Error} When a program package or a library is not built, or an export is not an `example()`
 */
export async function generateIndex(options: GenerateIndexOptions): Promise<IndexOutput> {
    const log = options.log ?? ((line: string) => console.log(line));
    const resolvedBaseDir = path.resolve(options.baseDir);
    const config = options.config;
    if (!Array.isArray(config.sources) || config.sources.length === 0) {
        throw new Error("Invalid config: sources array is empty or missing");
    }

    const entries: IndexEntry[] = [];
    const fileCount = new Set<string>();
    const packageCounts: Record<string, number> = {};

    // The libraries whose exports spell platform calls in the printed
    // TypeScript — imported once, by the specifier the printed code imports.
    const libraries: Record<string, object> = {};
    for (const [specifier, entry] of Object.entries(config.libraries ?? {})) {
        const built = path.resolve(resolvedBaseDir, entry);
        if (!fs.existsSync(built)) {
            throw new Error(`library ${specifier} is not built: ${built} — build the package first`);
        }
        libraries[specifier] = (await import(pathToFileURL(built).href)) as object;
    }
    if (Object.keys(libraries).length > 0) log(`[libraries] ${Object.keys(libraries).join(", ")}`);

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

        log(`[${source.package}] Found ${uniqueFiles.length} files in ${testDir}${source.ir ? " (programs: IR)" : ""}`);

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
                    Object.assign(entry, programFields(ex.exportName, value as { fn: any; inputs: unknown[]; returns?: unknown }, libraries));
                } else {
                    entry.source = ex.source;
                }
                entries.push(entry);
                packageCounts[source.package] = (packageCounts[source.package] ?? 0) + 1;
            }
        }
    }

    // Merge static entries (e.g. hand-written e3 examples)
    const staticEntries = options.staticEntries ?? [];
    for (const entry of staticEntries) {
        entries.push({ ...entry, languages: entry.languages ?? ["typescript"] });
        packageCounts[entry.package] = (packageCounts[entry.package] ?? 0) + 1;
    }
    if (staticEntries.length > 0) log(`\n[static] Merged ${staticEntries.length} hand-written entries`);

    return {
        version: 2,
        stats: {
            totalEntries: entries.length,
            totalFiles: fileCount.size,
            packages: packageCounts,
        },
        entries,
    };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The value after `flag`, if given. */
function argument(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    const value = args[idx + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const baseDir = argument(args, "--base-dir");
    if (baseDir === undefined) {
        console.error("Usage: east-plugin-generate-index --base-dir <dir> [--config <index.config.json>] [--static <index.static.json>] [--out <index.json>]");
        process.exit(1);
    }

    // This package's own files (dist/scripts -> package root is ../../): East's index.
    const projectRoot = path.resolve(import.meta.dirname, "..", "..");
    const configPath = path.resolve(argument(args, "--config") ?? path.join(projectRoot, "index.config.json"));
    if (!fs.existsSync(configPath)) {
        console.error(`Config not found: ${configPath}`);
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as IndexConfig;

    const staticFlag = argument(args, "--static");
    const staticPath = path.resolve(staticFlag ?? path.join(projectRoot, "index.static.json"));
    const staticEntries = staticFlag !== undefined || fs.existsSync(staticPath)
        ? (JSON.parse(fs.readFileSync(staticPath, "utf-8")) as { entries: IndexEntry[] }).entries
        : [];

    const output = await generateIndex({ baseDir, config, staticEntries });

    const outPath = path.resolve(argument(args, "--out") ?? path.join(projectRoot, "index.json"));
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

    const programs = output.entries.filter((e) => e.ir !== undefined).length;
    console.log(`\nGenerated ${outPath}`);
    console.log(`  Entries: ${output.entries.length} (${programs} programs with IR, python pending: scripts/render-python.py)`);
    console.log(`  Files:   ${output.stats.totalFiles}`);
    for (const [pkg, count] of Object.entries(output.stats.packages)) {
        console.log(`  ${pkg}: ${count}`);
    }
}

// Run only as a command (the bin's link resolves to this file), never on import.
if (process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
