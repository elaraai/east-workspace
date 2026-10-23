/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The e3 packages of e3-ui's examples (#849, #1375): every e3 definition the
 * example modules export — inputs, records with their mutations and indexes,
 * the tasks that generate rows, functions and migrations — packaged with the
 * real e3 SDK as the zips an e3 imports. The renderer's tests import the
 * package of the modules a test file mounts into the e3-web each file starts.
 * The showcase's page imports an area's package — an area is the examples
 * under one directory of `test/`, which the showcase shows as one page — into
 * a workspace of the area's own, the first time one of its examples shows
 * (#1397). This is the one place the SDK packages the examples, so neither the
 * showcase's page nor the renderer declares it.
 *
 * Run as a script, it writes each area's zip into the directory it is given:
 *
 *     node dist/test/examples-package.js /tmp/e3-ui-examples
 *
 * The showcase's Vite plugin runs it so, for the dev server and the build.
 *
 * @remarks
 * - The modules are every `*.examples.ts(x)` under e3-ui's `test/`, found
 *   compiled beside this module and imported as they are. An example binds
 *   what it reads by path and by name, so every definition an example binds is
 *   exported from a module, and the package carries it.
 * - `e3.package` keys what it collects by path and by name and keeps the last
 *   it meets, so two modules declaring one dataset, task or function would
 *   leave one of them reading the other's. Two different definitions at one
 *   path or name fail the step, naming the modules that declare them — across
 *   every module, so the areas' packages agree on each.
 * - An area's package carries its modules' definitions, and what its examples
 *   bind that another area's module declares — a dataset or a paged source, a
 *   record with every mutation, index and migration declared on it, a
 *   function — found as a UI task's preview finds what it reads
 *   (`deriveManifest`). So an area's workspace holds everything its examples
 *   read, and starting it runs no other area's work: a page of the Schematic
 *   deploys none of the Sheet's work orders.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExampleDef } from "@elaraai/east";
import e3, {
    type DataTreeDef, type DatasetDef, type FunctionDef, type MigrationDef, type MutationDef,
    type PackageDef, type RecordIndexDef, type TaskDef,
} from "@elaraai/e3";
import { pathToString, type TreePath } from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";

/** Where this module is: beside the compiled example modules. */
const here = path.dirname(fileURLToPath(import.meta.url));

/** What a compiled example module's file name ends with. */
const COMPILED_EXAMPLES = ".examples.js";

/** The package's name; an area's package is named after it, then the area. */
export const EXAMPLES_PACKAGE_NAME = "e3-ui-examples";

/** An e3 definition an example module exports for the package. */
export type ExampleDefinition = DatasetDef | TaskDef | FunctionDef | MutationDef | RecordIndexDef | MigrationDef;

/** The kinds of {@link ExampleDefinition}. */
const DEFINITION_KINDS: ReadonlySet<string> = new Set(["dataset", "task", "function", "mutation", "recordIndex", "migration"]);

/** One example module: the e3 definitions it exports, and its examples. */
export interface ExampleModule {
    /** The module's key under e3-ui's `test/`, e.g. `calendar/calendar-records`. */
    pathKey: string;
    /** Its e3 definitions, each with its export name, in export order. */
    definitions: [name: string, definition: ExampleDefinition][];
    /** Its examples, each with its export name, in export order. */
    examples: [name: string, example: ExampleDef][];
}

/**
 * Whether a module's export is an e3 definition the package carries.
 *
 * @param value - The export
 * @returns Whether it is a dataset, a record, a task, a function, a mutation,
 *   an index or a migration
 */
export function isExampleDefinition(value: unknown): value is ExampleDefinition {
    return typeof value === "object" && value !== null && "kind" in value
        && typeof value.kind === "string" && DEFINITION_KINDS.has(value.kind);
}

/**
 * Whether a module's export is an example, as `example()` makes one: a
 * function with its description and keywords.
 *
 * @param value - The export
 * @returns Whether it is an example
 */
export function isExample(value: unknown): value is ExampleDef {
    return typeof value === "object" && value !== null && "fn" in value && "description" in value && "keywords" in value;
}

/**
 * An example module the caller has imported, as the package takes it.
 *
 * @param pathKey - The module's key under e3-ui's `test/`, e.g. `calendar/calendar-records`
 * @param exports - The module's exports
 * @returns The module, the e3 definitions it exports and its examples, in
 *   export order
 */
export function exampleModule(pathKey: string, exports: Readonly<Record<string, unknown>>): ExampleModule {
    const entries = Object.entries(exports);
    return {
        pathKey,
        definitions: entries.filter((entry): entry is [string, ExampleDefinition] => isExampleDefinition(entry[1])),
        examples: entries.filter((entry): entry is [string, ExampleDef] => isExample(entry[1])),
    };
}

/**
 * The area a module is in: the directory of e3-ui's `test/` it is under,
 * whose examples the showcase shows as one page.
 *
 * @param pathKey - The module's key under e3-ui's `test/`, e.g. `plan/plan-records`
 * @returns Its area, e.g. `plan`
 */
export function exampleArea(pathKey: string): string {
    return pathKey.split("/", 1)[0]!;
}

/**
 * The keys of every compiled example module beside this one: each
 * `<key>.examples.js` under e3-ui's `dist/test/`, in key order.
 *
 * @returns The modules' keys, e.g. `calendar/calendar-records`
 */
export function exampleModuleKeys(): string[] {
    return fs.readdirSync(here, { recursive: true, encoding: "utf8" })
        .map((file) => file.replace(/\\/g, "/"))
        .filter((file) => file.endsWith(COMPILED_EXAMPLES))
        .map((file) => file.slice(0, -COMPILED_EXAMPLES.length))
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Imports every e3-ui example module, compiled, and collects the e3
 * definitions and the examples each exports.
 *
 * @returns The modules, in key order
 * @throws {Error} When a module does not import
 */
export async function loadExampleModules(): Promise<ExampleModule[]> {
    const modules: ExampleModule[] = [];
    for (const pathKey of exampleModuleKeys()) {
        const file = path.join(here, `${pathKey}${COMPILED_EXAMPLES}`);
        const exports = await import(pathToFileURL(file).href) as Record<string, unknown>;
        modules.push(exampleModule(pathKey, exports));
    }
    return modules;
}

/** A tree, dataset or task the package collects, or a definition a module exports. */
type Collected = DataTreeDef | ExampleDefinition;

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
function ownersOf(modules: readonly ExampleModule[]): Map<Collected, string> {
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
                `the e3-ui examples' package: ${owners.get(held) ?? "a module"} and ${owners.get(item) ?? "another module"} ` +
                `both declare the ${what} '${key}' — declare it in one module and import it where another binds it`,
            );
        }
    }
}

/**
 * The version the package carries: e3-ui's own, read from the package.json
 * above this module.
 *
 * @returns The version
 * @throws {Error} When no e3-ui package.json is found above this module
 */
function e3UiVersion(): string {
    for (let dir = here; ; dir = path.dirname(dir)) {
        const file = path.join(dir, "package.json");
        if (fs.existsSync(file)) {
            const info = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown; version?: unknown };
            if (info.name === "@elaraai/e3-ui" && typeof info.version === "string") return info.version;
        }
        if (path.dirname(dir) === dir) throw new Error(`the e3-ui examples' package: no @elaraai/e3-ui package.json above ${here}`);
    }
}

/**
 * The package of the modules' e3 definitions, as `e3.package` collects them.
 *
 * @param modules - The example modules
 * @returns The package
 * @throws {Error} When two modules declare different definitions at one
 *   dataset path, task name, function name, or mutation, index or migration
 *   name on one record, naming both
 */
export function examplesPackage(modules: readonly ExampleModule[]): PackageDef<Record<string, unknown>> {
    const owners = ownersOf(modules);
    const definitions = modules.flatMap((module) => module.definitions.map(([, definition]) => definition));
    const ofKind = <K extends ExampleDefinition["kind"]>(kind: K) =>
        definitions.filter((definition): definition is Extract<ExampleDefinition, { kind: K }> => definition.kind === kind);

    // What `e3.package` keys by name and never reaches through a dependency.
    claimOnce("function", ofKind("function"), (fn) => fn.name, owners);
    claimOnce("mutation", ofKind("mutation"), (mutation) => `${mutation.record.name}.${mutation.name}`, owners);
    claimOnce("index", ofKind("recordIndex"), (index) => `${index.record.name}.${index.name}`, owners);
    claimOnce("migration", ofKind("migration"), (migration) => `${migration.record.name}.${migration.name}`, owners);

    const pkg = e3.package(EXAMPLES_PACKAGE_NAME, e3UiVersion(), ...definitions);

    // What it collected, the dependencies it reached included: each path holds
    // one tree or dataset, and each name one task. A path is keyed as e3
    // prints it (`.inputs.count`).
    const nodes = pkg.contents.filter((item): item is DataTreeDef | DatasetDef => item.kind !== "task");
    claimOnce("path", nodes, (node) => pathToString(node.path), owners);
    claimOnce("task", pkg.contents.filter((item): item is TaskDef => item.kind === "task"), (task) => task.name, owners);
    return pkg;
}

/**
 * The package of the modules' e3 definitions, as the zip an e3 imports.
 *
 * @param modules - The example modules
 * @returns The zip's bytes
 * @throws {Error} When two modules declare one definition ({@link examplesPackage})
 */
export async function examplesPackageZip(modules: readonly ExampleModule[]): Promise<Uint8Array> {
    const pkg = examplesPackage(modules);
    // The SDK exports to a file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e3-ui-examples-"));
    try {
        const zip = path.join(dir, "package.zip");
        await e3.export(pkg, zip);
        return new Uint8Array(fs.readFileSync(zip));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * The package of each area's examples (#1397): every e3 definition the area's
 * modules export, and every dataset, paged source, record and function its
 * examples bind that another area's module declares — each record with every
 * mutation, index and migration any module declares on it, as the package of
 * every module carries it.
 *
 * @param modules - The example modules
 * @returns Each area's package, named after the examples' package and the
 *   area, by area in the modules' order
 * @throws {Error} When two modules declare one definition ({@link examplesPackage}),
 *   or an example binds what no module declares, naming the example and what
 *   it binds
 */
export function examplesAreaPackages(modules: readonly ExampleModule[]): Map<string, PackageDef<Record<string, unknown>>> {
    // Every module's definitions together: two declaring one path or name are
    // refused across the areas, so the areas' packages agree on each.
    const whole = examplesPackage(modules);
    // The dataset at each path, as e3 prints it (`.records.racks`): an input, a
    // record, or a task's output — which depends on its task, so the package
    // collecting it collects the task and what the task reads.
    const datasets = new Map<string, DatasetDef>();
    for (const item of whole.contents) if (item.kind === "dataset") datasets.set(pathToString(item.path), item);
    const datasetAt = (bound: TreePath, where: string): DatasetDef => {
        const dataset = datasets.get(pathToString(bound));
        if (dataset === undefined) {
            throw new Error(`the e3-ui examples' package: ${where} binds ${pathToString(bound)}, which no example module declares — export it from the module that declares it`);
        }
        return dataset;
    };

    const areas = new Map<string, ExampleModule[]>();
    for (const module of modules) {
        const area = exampleArea(module.pathKey);
        areas.set(area, [...(areas.get(area) ?? []), module]);
    }
    const version = e3UiVersion();
    const packages = new Map<string, PackageDef<Record<string, unknown>>>();
    for (const [area, members] of areas) {
        const items: ExampleDefinition[] = members.flatMap((module) => module.definitions.map(([, definition]) => definition));
        for (const { pathKey, examples } of members) {
            for (const [name, example] of examples) {
                const where = `${pathKey} (${name})`;
                const manifest = deriveManifest(example.fn);
                for (const bound of [...manifest.paths, ...manifest.pages]) items.push(datasetAt(bound, where));
                for (const record of manifest.records) {
                    const declared = whole.records[record];
                    if (declared === undefined) {
                        throw new Error(`the e3-ui examples' package: ${where} binds the record '${record}', which no example module declares — export it from the module that declares it`);
                    }
                    items.push(datasetAt(declared.path, where));
                }
                for (const fn of manifest.functions) {
                    const declared = whole.functions[fn];
                    if (declared === undefined) {
                        throw new Error(`the e3-ui examples' package: ${where} binds the function '${fn}', which no example module declares — export it from the module that declares it`);
                    }
                    items.push(declared);
                }
            }
        }
        const name = `${EXAMPLES_PACKAGE_NAME}-${area}`;
        // Each record the area holds — however it came to — carries what any
        // module declares on it: a record is one record in every area.
        const held = e3.package(name, version, ...items);
        const onRecords = Object.keys(held.records).flatMap((record) => {
            const declared = whole.records[record]!;
            return [...Object.values(declared.mutations), ...Object.values(declared.indexes), ...declared.migrations];
        });
        packages.set(area, e3.package(name, version, ...items, ...onRecords));
    }
    return packages;
}

/**
 * Writes each area's package of every e3-ui example module to a zip of its
 * own, `<area>.zip`, in one directory.
 *
 * @param outDir - Where the zips go; made if missing
 * @returns The areas, in the order their zips were written
 * @throws {Error} When a module does not import, or the packages cannot be
 *   made ({@link examplesAreaPackages})
 */
export async function writeExamplesAreaPackages(outDir: string): Promise<string[]> {
    const packages = examplesAreaPackages(await loadExampleModules());
    fs.mkdirSync(outDir, { recursive: true });
    for (const [area, pkg] of packages) await e3.export(pkg, path.join(outDir, `${area}.zip`));
    return [...packages.keys()];
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

// Run as a script: write each area's zip into the directory the first argument names.
if (isScript()) {
    const out = process.argv[2];
    if (out === undefined) {
        console.error("usage: node dist/test/examples-package.js <directory>");
        process.exit(2);
    }
    const areas = await writeExamplesAreaPackages(path.resolve(out));
    console.log(`${out}: ${EXAMPLES_PACKAGE_NAME}, a package for each of ${areas.length} areas (${areas.join(", ")})`);
}
