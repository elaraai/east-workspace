/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The showcase's e3 packages (#849, #1397), as the page takes them in: the
 * zips e3-ui's examples' package step writes (#1375), one an area — the e3
 * examples of one category, one directory of e3-ui's `test/` — built as the
 * Vite plugin builds them and imported into an in-memory e3. Every e3
 * definition each e3-ui example module exports is in its area's package;
 * every example finds what it binds there — its datasets, paged sources,
 * functions and records; and an area's package holds no record but those its
 * modules reach and its examples bind, so starting an area deploys no other
 * area's records.
 *
 * The modules are found here, as the source-extraction plugin finds them,
 * rather than taken from the step, so a module the step leaves out fails.
 * The step's refusals of two modules declaring one dataset, task or function,
 * and of an example binding what no module declares, are e3-ui's
 * (`test/examples-package.spec.ts`).
 */

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    equalFor, isTypeValueEqual, toEastTypeValue,
    type EastType, type EastTypeValue, type ExampleDef,
} from "@elaraai/east";
import type { DataTreeDef, DatasetDef, FunctionDef, MigrationDef, MutationDef, RecordDef, RecordIndexDef, TaskDef } from "@elaraai/e3";
import { InMemoryStorage, keypathToRefPath, packageImport, packageRead } from "@elaraai/e3-core";
import {
    TreePathType, decodeFunctionObject, decodeMutationObject, decodeRecordIndexObject, decodeRecordObject,
    decodeTaskObject, pathToString, type PackageObject, type RecordObject, type Structure, type TreePath,
} from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import { discoverExampleFiles } from "../../scripts/discover-example-files";
import { buildE3ShowcaseZips } from "../../scripts/vite-plugin-e3-showcase";

/** The showcase package's root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** e3-ui's root, where the package step is. */
const E3_UI = path.resolve(ROOT, "../e3-ui");

/** The repository the zips are imported into. */
const REPO = "showcase";

/** An e3 definition a module may export. */
type Definition = DatasetDef | TaskDef | FunctionDef | MutationDef | RecordIndexDef | MigrationDef;

const DEFINITION_KINDS: ReadonlySet<string> = new Set(["dataset", "task", "function", "mutation", "recordIndex", "migration"]);

/** An example module: its key under e3-ui's `test/`, and its exports. */
interface ExampleModule {
    pathKey: string;
    exports: Record<string, unknown>;
}

/** Every e3-ui example module, compiled, as e3-ui exports it. */
async function exampleModules(): Promise<ExampleModule[]> {
    const files = await discoverExampleFiles({ testDir: path.resolve(E3_UI, "test"), includeTopLevel: true });
    const modules: ExampleModule[] = [];
    for (const { pathKey } of files) {
        modules.push({ pathKey, exports: await import(`@elaraai/e3-ui/examples/${pathKey}`) });
    }
    return modules;
}

/** The area a module is in: the directory of e3-ui's `test/` it is under. */
function areaOf(pathKey: string): string {
    return pathKey.split("/", 1)[0]!;
}

function isDefinition(value: unknown): value is Definition {
    return typeof value === "object" && value !== null && "kind" in value
        && typeof value.kind === "string" && DEFINITION_KINDS.has(value.kind);
}

function isRecord(definition: DatasetDef): definition is RecordDef {
    return "recordKind" in definition && definition.recordKind === "record";
}

function isExample(value: unknown): value is ExampleDef {
    return typeof value === "object" && value !== null && "fn" in value && "keywords" in value;
}

/** Whether a type stored in the package is a definition's type. */
function sameType(stored: EastTypeValue, declared: EastType): boolean {
    return isTypeValueEqual(stored, toEastTypeValue(declared));
}

/** The package structure's node at a path, when it has one. */
function nodeAt(structure: Structure, treePath: TreePath): Structure | undefined {
    let node: Structure | undefined = structure;
    for (const segment of treePath) {
        if (node === undefined || node.type !== "struct") return undefined;
        node = node.value.get(segment.value);
    }
    return node;
}

/** What a definition reaches, as `e3.package` collects it: a dataset's or
 *  task's dependencies, a mutation's, index's or migration's record, a
 *  migration's earlier step. */
function reachedFrom(item: DataTreeDef | Definition): (DataTreeDef | Definition)[] {
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

/** Every definition the roots reach, themselves among them. */
function reachOf(roots: readonly (DataTreeDef | Definition)[]): Set<DataTreeDef | Definition> {
    const reached = new Set<DataTreeDef | Definition>();
    const stack = [...roots];
    while (stack.length > 0) {
        const item = stack.pop()!;
        if (reached.has(item)) continue;
        reached.add(item);
        stack.push(...reachedFrom(item));
    }
    return reached;
}

describe("the showcase's e3 packages, one an area", () => {
    const storage = new InMemoryStorage();
    const packages = new Map<string, PackageObject>();
    let modules: ExampleModule[];

    before(async () => {
        const zips = await buildE3ShowcaseZips(E3_UI);
        await storage.repos.create(REPO);
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-spec-"));
        try {
            for (const [area, bytes] of zips) {
                const zip = path.join(dir, `${area}.zip`);
                await fs.writeFile(zip, bytes);
                const imported = await packageImport(storage, REPO, zip);
                packages.set(area, await packageRead(storage, REPO, imported.name, imported.version));
            }
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
        modules = await exampleModules();
    });

    const read = (hash: string) => storage.objects.read(REPO, hash);

    /** The package of a module's area. */
    function packageOf(pathKey: string): PackageObject {
        const area = areaOf(pathKey);
        const pkg = packages.get(area);
        assert.ok(pkg !== undefined, `${pathKey}: the showcase has no package for its area '${area}'`);
        return pkg;
    }

    /** A package's record of a name, decoded. */
    async function recordObject(pkg: PackageObject, name: string, where: string): Promise<RecordObject> {
        const hash = pkg.records.get(name);
        assert.ok(hash !== undefined, `${where}: its area's package has no record '${name}'`);
        return decodeRecordObject(await read(hash));
    }

    /** A dataset is in a package's structure at its path, typed and writable
     *  as declared, with a ref holding its value when it has one. */
    function assertDataset(pkg: PackageObject, dataset: DatasetDef, where: string): void {
        const at = pathToString(dataset.path);
        const node = nodeAt(pkg.data.structure, dataset.path);
        assert.ok(node !== undefined && node.type === "value", `${where}: its area's package has no dataset at ${at}`);
        assert.ok(sameType(node.value.type, dataset.type), `${where}: its area's package's ${at} is not of the declared type`);
        assert.equal(node.value.writable, dataset.writable, `${where}: its area's package's ${at} is not writable as declared`);
        // The package's refs name a dataset as e3's ref store does: `inputs/count`.
        const ref = pkg.data.refs.get(keypathToRefPath(at));
        assert.ok(ref !== undefined, `${where}: its area's package has no ref for ${at}`);
        const holdsValue = dataset.default !== undefined || dataset.source?.type === "value";
        assert.equal(ref.type, holdsValue ? "value" : "unassigned", `${where}: its area's package's ${at} is ${ref.type}`);
    }

    async function assertCarried(pkg: PackageObject, definition: Definition, where: string): Promise<void> {
        switch (definition.kind) {
            case "dataset": {
                assertDataset(pkg, definition, where);
                if (isRecord(definition)) {
                    const record = await recordObject(pkg, definition.name, where);
                    assert.equal(record.path, keypathToRefPath(pathToString(definition.path)), `${where}: the record's path`);
                    for (const name of Object.keys(definition.mutations)) {
                        assert.ok(record.mutations.has(name), `${where}: the record has no mutation '${name}'`);
                    }
                    for (const name of Object.keys(definition.indexes)) {
                        assert.ok(record.indexes.has(name), `${where}: the record has no index '${name}'`);
                    }
                }
                return;
            }
            case "task": {
                const hash = pkg.tasks.get(definition.name);
                assert.ok(hash !== undefined, `${where}: its area's package has no task '${definition.name}'`);
                const task = decodeTaskObject(await read(hash));
                assert.ok(equalFor(TreePathType)(task.output.path, definition.output.path),
                    `${where}: its area's package's task '${definition.name}' writes ${pathToString(task.output.path)}`);
                assertDataset(pkg, definition.output, `${where}'s output`);
                return;
            }
            case "function": {
                const hash = pkg.functions.get(definition.name);
                assert.ok(hash !== undefined, `${where}: its area's package has no function '${definition.name}'`);
                const fn = decodeFunctionObject(await read(hash));
                assert.ok(
                    fn.inputTypes.length === definition.inputTypes.length
                        && fn.inputTypes.every((type, i) => sameType(type, definition.inputTypes[i]!))
                        && sameType(fn.outputType, definition.outputType),
                    `${where}: its area's package's function '${definition.name}' has another signature`,
                );
                return;
            }
            case "mutation": {
                const record = await recordObject(pkg, definition.record.name, where);
                const hash = record.mutations.get(definition.name);
                assert.ok(hash !== undefined, `${where}: record '${definition.record.name}' has no mutation '${definition.name}'`);
                const mutation = decodeMutationObject(await read(hash));
                assert.equal(mutation.form.type, definition.form, `${where}: the mutation's form`);
                return;
            }
            case "recordIndex": {
                const record = await recordObject(pkg, definition.record.name, where);
                const hash = record.indexes.get(definition.name);
                assert.ok(hash !== undefined, `${where}: record '${definition.record.name}' has no index '${definition.name}'`);
                const index = decodeRecordIndexObject(await read(hash));
                assert.ok(sameType(index.keyType, definition.keyType), `${where}: the index's key type`);
                return;
            }
            case "migration": {
                const record = await recordObject(pkg, definition.record.name, where);
                assert.ok(record.migrations.some((step) => step.name === definition.name),
                    `${where}: record '${definition.record.name}' has no migration '${definition.name}'`);
                return;
            }
        }
    }

    test("carries every e3 definition each example module exports, in the package of the module's area", async () => {
        let carried = 0;
        for (const { pathKey, exports } of modules) {
            const pkg = packageOf(pathKey);
            for (const [name, value] of Object.entries(exports)) {
                if (!isDefinition(value)) continue;
                await assertCarried(pkg, value, `${pathKey}'s ${name}`);
                carried++;
            }
        }
        assert.ok(carried > 0, "the example modules export no e3 definition");
    });

    test("every example finds the datasets, paged sources, functions and records it binds in its area's package", () => {
        let examples = 0;
        for (const { pathKey, exports } of modules) {
            const pkg = packageOf(pathKey);
            for (const [name, value] of Object.entries(exports)) {
                if (!isExample(value)) continue;
                examples++;
                const where = `${pathKey}'s ${name}`;
                const manifest = deriveManifest(value.fn);
                for (const bound of [...manifest.paths, ...manifest.pages]) {
                    assert.ok(nodeAt(pkg.data.structure, bound)?.type === "value",
                        `${where} binds ${pathToString(bound)}, and its area's package has no dataset there`);
                }
                for (const fn of manifest.functions) {
                    assert.ok(pkg.functions.has(fn), `${where} binds function '${fn}', and its area's package has none`);
                }
                for (const record of manifest.records) {
                    assert.ok(pkg.records.has(record), `${where} binds record '${record}', and its area's package has none`);
                }
            }
        }
        assert.ok(examples > 0, "the example modules export no example");
    });

    test("an area's package holds only the records its modules reach and its examples bind: starting an area deploys no other area's", () => {
        // Every definition the modules reach, by the path an example binds it by.
        const declared = reachOf(modules.flatMap(({ exports }) => Object.values(exports).filter(isDefinition)));
        const atPath = new Map<string, DatasetDef>();
        for (const item of declared) if (item.kind === "dataset") atPath.set(pathToString(item.path), item);
        const records = [...declared].filter((item) => item.kind === "dataset" && isRecord(item)).length;

        let fewer = 0;
        for (const [area, pkg] of packages) {
            const members = modules.filter(({ pathKey }) => areaOf(pathKey) === area);
            const roots: (DataTreeDef | Definition)[] = members.flatMap(({ exports }) => Object.values(exports).filter(isDefinition));
            for (const { exports } of members) {
                for (const value of Object.values(exports)) {
                    if (!isExample(value)) continue;
                    const manifest = deriveManifest(value.fn);
                    for (const bound of [...manifest.paths, ...manifest.pages]) {
                        const dataset = atPath.get(pathToString(bound));
                        if (dataset !== undefined) roots.push(dataset);
                    }
                }
            }
            const reached = new Set([...reachOf(roots)].flatMap((item) => item.kind === "dataset" && isRecord(item) ? [item.name] : []));
            const held = [...pkg.records.keys()];
            assert.deepEqual(held.filter((record) => !reached.has(record)), [],
                `the ${area} area's package holds records none of its modules reach and none of its examples bind`);
            if (held.length < records) fewer++;
        }
        assert.ok(fewer > 0, "every area's package holds every record: the packages are not split by area");
    });
});
