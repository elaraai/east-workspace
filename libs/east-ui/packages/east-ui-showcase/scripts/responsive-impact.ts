/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Select responsive checks from the complete PR diff. Unknown browser-facing
 * changes run everything; only known component boundaries narrow the suite.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listTests } from "./responsive-shards.js";

// Only these reviewed suites belong exclusively to one component. New or
// cross-component specs remain shared and run with every component change.
const componentSpecs = {
    calendar: ["calendar.spec.ts", "calendar-narrowing.spec.ts", "calendar-records.spec.ts"],
    flowchart: ["flowchart-builder.spec.ts", "flowchart-drop.spec.ts", "flowchart-flows.spec.ts", "flowchart-frame.spec.ts", "flowchart-records.spec.ts"],
    plan: ["plan-builder-dnd.spec.ts", "plan-builder.spec.ts", "plan-delete.spec.ts", "plan-frame.spec.ts", "plan-geometry.spec.ts", "plan-narrowing.spec.ts", "plan-time-ruler.spec.ts", "plan-windows.spec.ts"],
    query: ["query-builder.spec.ts", "query-library.spec.ts", "query-runs.spec.ts"],
    roster: ["roster.spec.ts", "roster-inspector.spec.ts", "roster-load.spec.ts"],
    // The Schematic's frame (#1387), editing (#1388), library (#1389), drops
    // (#1390), narrowing (#1392), windows and their budget (#1393) and phone
    // (#1394); its hosts in the shared suites — the toolbar sweep, the touch
    // toolbars, the cold load, the shadow sweep, and its links beside the
    // Plan's (#1403) — run with it always.
    schematic: [
        "schematic-drop.spec.ts", "schematic-editing.spec.ts", "schematic-frame.spec.ts", "schematic-library.spec.ts", "schematic-narrowing.spec.ts",
        "schematic-perf.spec.ts", "schematic-phone.spec.ts", "schematic-window.spec.ts",
    ],
    sheet: ["sheet-bound.spec.ts", "sheet-chrome.spec.ts", "sheet-frame.spec.ts", "sheet-keys.spec.ts", "sheet-lens.spec.ts", "sheet-narrowing.spec.ts"],
    studio: ["studio-builder.spec.ts", "studio-page-library.spec.ts", "studio-page.spec.ts"],
} as const;

type Component = keyof typeof componentSpecs;
export interface ResponsiveImpact {
    mode: "all" | "focused" | "none";
    components: Component[];
    specs: string[];
    reason: string;
}
const responsiveRoot = "libs/east-ui/packages/east-ui-showcase/tests/responsive/";
const all = (reason: string): ResponsiveImpact => ({ mode: "all", components: [], specs: [], reason });

/** Classify only known independent renderer directories; IR and fixtures stay shared. */
export function classifyChanges(paths: readonly string[] | null): ResponsiveImpact {
    if (paths === null) return all("The comparison base is unavailable");
    const components = new Set<Component>();
    const specs = new Set<string>();
    for (const path of paths) {
        if (/\.md$/i.test(path) || path.startsWith("docs/")) continue;
        if (path.startsWith(responsiveRoot)) {
            if (path.endsWith(".spec.ts")) { specs.add(basename(path)); continue; }
            return all(`Shared browser helper: ${path}`);
        }
        // Unit tests are covered by their package jobs. Examples, test data,
        // harnesses and tooling do not match this suffix and stay conservative.
        if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) continue;
        // e3-api-server stays shared: e3-web imports its portable routes.
        if (/^libs\/east-ui\/packages\/(?:e3-ui-cli|east-ui-extension)\//.test(path)
            || /^libs\/e3\/packages\/(?:e3-cli|e3-job)\//.test(path)
            || path.startsWith("libs/east-c/")
            || (path.startsWith("libs/east-py/") && !path.startsWith("libs/east-py/packages/east-py-datascience/"))) continue;
        const component = /^libs\/east-ui\/packages\/e3-ui-components\/src\/([^/]+)\//.exec(path)?.[1];
        if (component && Object.hasOwn(componentSpecs, component)) {
            components.add(component as Component);
            continue;
        }
        return all(`Shared or unclassified change: ${path}`);
    }
    return {
        mode: components.size || specs.size ? "focused" : "none",
        components: [...components].sort(),
        specs: [...specs].sort(),
        reason: components.size || specs.size ? "Known component or browser-spec changes" : "No browser-facing changes",
    };
}

/** Read names from the same documented list format used by the shard runner. */
function specOf(test: string): string | undefined {
    const file = /^\[[^\]]+\] › (.+?):\d+:\d+ › /.exec(test)?.[1];
    return file && basename(file.replaceAll("\\", "/"));
}

/** Keep shared checks for component changes; missing/deleted specs fall back to all. */
export function selectTests(tests: readonly string[], impact: ResponsiveImpact): string[] {
    if (impact.mode === "all") return [...tests];
    if (impact.mode === "none") return [];
    const files = tests.map(specOf);
    if (files.some(file => !file) || impact.specs.some(spec => !files.includes(spec))) return [...tests];
    const owners = new Map<string, Component>();
    for (const [component, specs] of Object.entries(componentSpecs)) {
        for (const spec of specs) owners.set(spec, component as Component);
    }
    const selected = tests.filter((_, i) => {
        const file = files[i]!;
        const owner = owners.get(file);
        return impact.specs.includes(file)
            || (impact.components.length > 0 && (!owner || impact.components.includes(owner)));
    });
    // Never turn an unknown selection into a green job that executes nothing.
    return selected.length ? selected : [...tests];
}

/** Diff both sides of renames, across the full comparison rather than the last commit. */
export function changedPaths(base: string, head = "HEAD", cwd = process.cwd()): string[] | null {
    try {
        const commit = (ref: string) => execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", commit(base), commit(head), "--"], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
            .split("\0").filter(Boolean);
    } catch { return null; }
}

/** At most 16 jobs, with no empty shard for a small focused selection. */
export function shardCount(testCount: number): number {
    return Math.max(1, Math.min(16, Math.ceil(testCount / 75)));
}

function main(): void {
    const { values } = parseArgs({ options: { base: { type: "string", default: "" }, head: { type: "string", default: "HEAD" }, output: { type: "string" } } });
    if (!values.output) throw new Error("responsive-impact requires --output=<directory>");
    const impact = classifyChanges(changedPaths(values.base, values.head));
    const discovered = listTests();
    const selected = selectTests(discovered, impact);
    const count = shardCount(selected.length);
    const shards = Array.from({ length: count }, (_, i) => i + 1);
    const summary = `${selected.length} of ${discovered.length} responsive cases; ${selected.length ? count : 0} jobs. ${impact.reason}.`;
    mkdirSync(values.output, { recursive: true });
    writeFileSync(join(values.output, "responsive-tests.txt"), selected.length ? selected.join("\n") + "\n" : "");
    writeFileSync(join(values.output, "responsive-impact.json"), JSON.stringify({ ...impact, selected: selected.length, discovered: discovered.length, shards: selected.length ? shards : [] }, null, 2) + "\n");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${selected.length}\nshards=${JSON.stringify(shards)}\ntotal=${count}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Responsive selection\n\n${summary}\n`);
    console.log(summary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
