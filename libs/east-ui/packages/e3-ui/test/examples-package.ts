/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The e3 package of e3-ui's examples (#849, #1375): every e3 definition the
 * example modules export — inputs, records with their mutations and indexes,
 * the tasks that generate rows, functions and migrations — packaged with the
 * real e3 SDK as the zip an e3 imports. The showcase's page imports the package
 * of every module into the e3 it runs; the renderer's tests import the package
 * of the modules a test file mounts into the e3-web each file starts. This is
 * the one place the SDK packages the examples, so neither the showcase's page
 * nor the renderer declares it.
 *
 * Run as a script, it writes the zip of every module to the path it is given:
 *
 *     node dist/test/examples-package.js /tmp/e3-ui-examples.zip
 *
 * The showcase's Vite plugin runs it so, for the dev server and the build.
 *
 * @remarks
 * - The modules are every `*.examples.ts(x)` under e3-ui's `test/`, found
 *   compiled beside this module and imported as they are. An example binds
 *   what it reads by path and by name, so every definition an example binds is
 *   exported from its module, and the package carries it.
 * - `e3.package` keys what it collects by path and by name and keeps the last
 *   it meets, so two modules declaring one dataset, task or function would
 *   leave one of them reading the other's. Two different definitions at one
 *   path or name fail the step, naming the modules that declare them.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import e3, {
    type DataTreeDef, type DatasetDef, type FunctionDef, type MigrationDef, type MutationDef,
    type PackageDef, type RecordIndexDef, type TaskDef,
} from "@elaraai/e3";
import { pathToString } from "@elaraai/e3-types";

/** Where this module is: beside the compiled example modules. */
const here = path.dirname(fileURLToPath(import.meta.url));

/** What a compiled example module's file name ends with. */
const COMPILED_EXAMPLES = ".examples.js";

/** The package's name. */
export const EXAMPLES_PACKAGE_NAME = "e3-ui-examples";

/** An e3 definition an example module exports for the package. */
export type ExampleDefinition = DatasetDef | TaskDef | FunctionDef | MutationDef | RecordIndexDef | MigrationDef;

/** The kinds of {@link ExampleDefinition}. */
const DEFINITION_KINDS: ReadonlySet<string> = new Set(["dataset", "task", "function", "mutation", "recordIndex", "migration"]);

/** One example module and the e3 definitions it exports. */
export interface ExampleModule {
    /** The module's key under e3-ui's `test/`, e.g. `calendar/calendar-records`. */
    pathKey: string;
    /** Its e3 definitions, each with its export name, in export order. */
    definitions: [name: string, definition: ExampleDefinition][];
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
 * An example module the caller has imported, as the package takes it.
 *
 * @param pathKey - The module's key under e3-ui's `test/`, e.g. `calendar/calendar-records`
 * @param exports - The module's exports
 * @returns The module and the e3 definitions it exports, in export order
 */
export function exampleModule(pathKey: string, exports: Readonly<Record<string, unknown>>): ExampleModule {
    const definitions = Object.entries(exports)
        .filter((entry): entry is [string, ExampleDefinition] => isExampleDefinition(entry[1]));
    return { pathKey, definitions };
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
 * definitions each exports.
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
 * Writes the package of every e3-ui example module's definitions to a zip.
 *
 * @param outPath - Where the zip goes; its directory is made if missing
 * @returns The modules the package was made from
 * @throws {Error} When a module does not import, or two declare one
 *   definition ({@link examplesPackage})
 */
export async function writeExamplesPackage(outPath: string): Promise<ExampleModule[]> {
    const modules = await loadExampleModules();
    const pkg = examplesPackage(modules);
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
        console.error("usage: node dist/test/examples-package.js <zip>");
        process.exit(2);
    }
    const modules = await writeExamplesPackage(path.resolve(out));
    const count = modules.reduce((sum, module) => sum + module.definitions.length, 0);
    console.log(`${out}: ${EXAMPLES_PACKAGE_NAME}, ${count} definitions from ${modules.length} example modules`);
}
