/**
 * generate-index.ts
 *
 * Extracts structured examples from East `*.examples.ts` files
 * into a search index (index.json).
 *
 * Usage: node build/scripts/generate-index.js --base-dir /path/to/repos
 *
 * Each example uses the `example()` pattern:
 *   export const name = example({ keywords, description, fn, inputs, returns })
 *
 * Section comments (// ---\n// Name\n// ---) provide suite grouping.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceConfig {
    package: string;
    skill: string;
    testDir: string;
    pattern: string | string[];
}

interface IndexConfig {
    sources: SourceConfig[];
}

interface IndexEntry {
    id: string;
    skill: string;
    package: string;
    file: string;
    suite: string;
    test: string;
    keywords: string[];
    imports: string[];
    source: string;
}

interface IndexStats {
    totalEntries: number;
    totalFiles: number;
    packages: Record<string, number>;
}

interface IndexOutput {
    version: number;
    generated: string;
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
    const content = fs.readFileSync(filePath, "utf-8");
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
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const { baseDir } = parseArgs(process.argv.slice(2));
    const resolvedBaseDir = path.resolve(baseDir);

    // Resolve project root (build/scripts -> project root is ../../)
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

        console.log(`[${source.package}] Found ${uniqueFiles.length} files in ${testDir}`);

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

            const relFile = path.relative(resolvedBaseDir, filePath);

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
                    source: ex.source,
                };
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
            entries.push(entry);
            packageCounts[entry.package] = (packageCounts[entry.package] ?? 0) + 1;
        }
        console.log(`\n[static] Merged ${staticData.entries.length} entries from index.static.json`);
    }

    // Build output
    const output: IndexOutput = {
        version: 1,
        generated: new Date().toISOString(),
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

    console.log(`\nGenerated ${outPath}`);
    console.log(`  Entries: ${entries.length}`);
    console.log(`  Files:   ${fileCount.size}`);
    for (const [pkg, count] of Object.entries(packageCounts)) {
        console.log(`  ${pkg}: ${count}`);
    }
}

main();
