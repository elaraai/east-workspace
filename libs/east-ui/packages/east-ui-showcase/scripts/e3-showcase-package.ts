/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The showcase's e3 package (#849): every e3 definition the e3-ui example
 * modules export — inputs, records with their mutations and indexes, the
 * tasks that generate rows, functions — in one package, exported with the
 * real e3 SDK (`e3.export`) as the zip the page imports into the e3 it runs.
 *
 * Run as a script, it writes the zip to the path it is given:
 *
 *     pnpm exec tsx scripts/e3-showcase-package.ts /tmp/e3-showcase.zip
 *
 * `vite-plugin-e3-showcase.ts` runs it so for the dev server and the build,
 * which serve the zip themselves.
 *
 * @remarks
 * - The modules are every `*.examples.ts(x)` under e3-ui's `test/`, found as
 *   the source-extraction plugin finds them (`discoverExampleFiles`), each
 *   imported compiled through e3-ui's `./examples/*` export. An example binds
 *   what it reads by path and by name, so every definition an example binds
 *   is exported from its module, and the package carries it.
 * - `e3.package` keys what it collects by path and by name and keeps the last
 *   it meets, so two modules declaring one dataset, task or function would
 *   leave one of them reading the other's. Two different definitions at one
 *   path or name fail the step, naming the modules that declare them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import e3, {
    type DataTreeDef, type DatasetDef, type FunctionDef, type MigrationDef, type MutationDef,
    type PackageDef, type RecordIndexDef, type TaskDef,
} from "@elaraai/e3";
import { pathToString } from "@elaraai/e3-types";
import { discoverExampleFiles } from "./discover-example-files";
import pkgInfo from "../package.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));

/** e3-ui's test root: the example modules' sources. */
export const E3_UI_TEST_DIR = path.resolve(here, "../../e3-ui/test");

/** The package's name. */
export const SHOWCASE_PACKAGE_NAME = "e3-showcase";

/** The package's version: the showcase's own. */
export const SHOWCASE_PACKAGE_VERSION = pkgInfo.version;

/** An e3 definition an example module exports for the package. */
export type ShowcaseDefinition = DatasetDef | TaskDef | FunctionDef | MutationDef | RecordIndexDef | MigrationDef;

/** The kinds of {@link ShowcaseDefinition}. */
const DEFINITION_KINDS: ReadonlySet<string> = new Set(["dataset", "task", "function", "mutation", "recordIndex", "migration"]);

/** One example module and the e3 definitions it exports. */
export interface ShowcaseModule {
    /** The module's key under e3-ui's `test/`, e.g. `bind/data/data`. */
    pathKey: string;
    /** Its e3 definitions, each with its export name, in export order. */
    definitions: [name: string, definition: ShowcaseDefinition][];
}

/**
 * Whether a module's export is an e3 definition the package carries.
 *
 * @param value - The export
 * @returns Whether it is a dataset, a record, a task, a function, a mutation,
 *   an index or a migration
 */
export function isShowcaseDefinition(value: unknown): value is ShowcaseDefinition {
    return typeof value === "object" && value !== null && "kind" in value
        && typeof value.kind === "string" && DEFINITION_KINDS.has(value.kind);
}

/**
 * Imports every e3-ui example module, compiled, and collects the e3
 * definitions each exports.
 *
 * @returns The modules, in key order
 * @throws {Error} When a module does not import — e3-ui is not built
 */
export async function loadShowcaseModules(): Promise<ShowcaseModule[]> {
    const files = await discoverExampleFiles({ testDir: E3_UI_TEST_DIR, includeTopLevel: true });
    const modules: ShowcaseModule[] = [];
    for (const { pathKey } of files) {
        const exports: Record<string, unknown> = await import(`@elaraai/e3-ui/examples/${pathKey}`);
        const definitions = Object.entries(exports)
            .filter((entry): entry is [string, ShowcaseDefinition] => isShowcaseDefinition(entry[1]));
        modules.push({ pathKey, definitions });
    }
    return modules;
}

/** A tree, dataset or task the package collects, or a definition a module exports. */
type Collected = DataTreeDef | ShowcaseDefinition;

/** What a definition reaches: a dataset's or task's dependencies, a
 *  mutation's, index's or migration's record, a migration's earlier step. */
function reachedFrom(item: Collected): Collected[] {
    switch (item.kind) {
        case "datatree":
        case "dataset":
        case "task":
            return [...item.deps];
        case "mutation":
        case "recordIndex":
            return [item.record];
        case "migration":
            return item.after === undefined ? [item.record] : [item.record, item.after];
        case "function":
            return [];
    }
}

/** Who declares each definition the modules reach: the module and export
 *  that names it, or the export it is reached through. */
function ownersOf(modules: readonly ShowcaseModule[]): Map<Collected, string> {
    const owners = new Map<Collected, string>();
    for (const { pathKey, definitions } of modules) {
        for (const [name, definition] of definitions) {
            if (!owners.has(definition)) owners.set(definition, `${pathKey} (${name})`);
            const reached = reachedFrom(definition);
            while (reached.length > 0) {
                const item = reached.pop()!;
                if (owners.has(item)) continue;
                owners.set(item, `${pathKey} (through ${name})`);
                reached.push(...reachedFrom(item));
            }
        }
    }
    return owners;
}

/**
 * Refuses two different definitions under one key.
 *
 * @param what - What the key names, for the message: `dataset`, `task`, …
 * @param items - The definitions
 * @param keyOf - The key two definitions may not share
 * @param owners - Who declares each definition
 * @throws {Error} Naming the key and the two modules that declare it
 */
function claimOnce<T extends Collected>(what: string, items: readonly T[], keyOf: (item: T) => string, owners: Map<Collected, string>): void {
    const claimed = new Map<string, T>();
    for (const item of items) {
        const key = keyOf(item);
        const held = claimed.get(key);
        if (held === undefined) {
            claimed.set(key, item);
        } else if (!Object.is(held, item)) {
            throw new Error(
                `the showcase's e3 package: ${owners.get(held) ?? "a module"} and ${owners.get(item) ?? "another module"} ` +
                `both declare the ${what} '${key}' — declare it in one module and import it where another binds it`,
            );
        }
    }
}

/**
 * The package of every module's e3 definitions, as `e3.package` collects them.
 *
 * @param modules - The example modules
 * @returns The package
 * @throws {Error} When two modules declare different definitions at one
 *   dataset path, task name, function name, or mutation, index or migration
 *   name on one record, naming both
 */
export function showcasePackage(modules: readonly ShowcaseModule[]): PackageDef<Record<string, unknown>> {
    const owners = ownersOf(modules);
    const definitions = modules.flatMap((module) => module.definitions.map(([, definition]) => definition));
    const ofKind = <K extends ShowcaseDefinition["kind"]>(kind: K) =>
        definitions.filter((definition): definition is Extract<ShowcaseDefinition, { kind: K }> => definition.kind === kind);

    // What `e3.package` keys by name and never reaches through a dependency.
    claimOnce("function", ofKind("function"), (fn) => fn.name, owners);
    claimOnce("mutation", ofKind("mutation"), (mutation) => `${mutation.record.name}.${mutation.name}`, owners);
    claimOnce("index", ofKind("recordIndex"), (index) => `${index.record.name}.${index.name}`, owners);
    claimOnce("migration", ofKind("migration"), (migration) => `${migration.record.name}.${migration.name}`, owners);

    const pkg = e3.package(SHOWCASE_PACKAGE_NAME, SHOWCASE_PACKAGE_VERSION, ...definitions);

    // What it collected, the dependencies it reached included: each path holds
    // one tree or dataset, and each name one task. A path is keyed as e3
    // prints it (`.inputs.count`).
    const nodes = pkg.contents.filter((item): item is DataTreeDef | DatasetDef => item.kind !== "task");
    claimOnce("path", nodes, (node) => pathToString(node.path), owners);
    claimOnce("task", pkg.contents.filter((item): item is TaskDef => item.kind === "task"), (task) => task.name, owners);
    return pkg;
}

/**
 * Writes the package of every e3-ui example module's definitions to a zip.
 *
 * @param outPath - Where the zip goes; its directory is made if missing
 * @returns The modules the package was made from
 * @throws {Error} When a module does not import, or two declare one
 *   definition ({@link showcasePackage})
 */
export async function writeShowcasePackage(outPath: string): Promise<ShowcaseModule[]> {
    const modules = await loadShowcaseModules();
    const pkg = showcasePackage(modules);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await e3.export(pkg, outPath);
    return modules;
}

/** Whether this module is the script node was started with. */
function isScript(): boolean {
    const started = process.argv[1];
    if (started === undefined) return false;
    try {
        return fs.realpathSync(started) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

// Run as a script: write the zip where the first argument says.
if (isScript()) {
    const out = process.argv[2];
    if (out === undefined) {
        console.error("usage: tsx scripts/e3-showcase-package.ts <zip>");
        process.exit(2);
    }
    const modules = await writeShowcasePackage(path.resolve(out));
    const count = modules.reduce((sum, module) => sum + module.definitions.length, 0);
    console.log(`${out}: ${SHOWCASE_PACKAGE_NAME}@${SHOWCASE_PACKAGE_VERSION}, ${count} definitions from ${modules.length} example modules`);
}
