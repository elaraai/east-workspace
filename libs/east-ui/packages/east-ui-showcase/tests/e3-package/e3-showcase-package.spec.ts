/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The showcase's e3 package (#849), as the page takes it in: the zip the
 * package step writes, built as the Vite plugin builds it and imported into
 * an in-memory e3. Every e3 definition each e3-ui example module exports is
 * in the package, and every example finds what it binds there — its
 * datasets, paged sources, functions and records.
 *
 * The modules are found here, as the source-extraction plugin finds them,
 * rather than taken from the step, so a module the step leaves out fails.
 * Two modules declaring one dataset, task or function fail the step.
 */

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    East, FloatType, IntegerType, equalFor, isTypeValueEqual, toEastTypeValue, variant,
    type EastType, type EastTypeValue, type ExampleDef,
} from "@elaraai/east";
import e3, { type DatasetDef, type FunctionDef, type MigrationDef, type MutationDef, type RecordDef, type RecordIndexDef, type TaskDef } from "@elaraai/e3";
import { InMemoryStorage, keypathToRefPath, packageImport, packageRead } from "@elaraai/e3-core";
import {
    TreePathType, decodeFunctionObject, decodeMutationObject, decodeRecordIndexObject, decodeRecordObject,
    decodeTaskObject, pathToString, type PackageObject, type RecordObject, type Structure, type TreePath,
} from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import { discoverExampleFiles } from "../../scripts/discover-example-files";
import { showcasePackage } from "../../scripts/e3-showcase-package";
import { buildE3ShowcaseZip } from "../../scripts/vite-plugin-e3-showcase";

/** The showcase package's root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The repository the zip is imported into. */
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
    const files = await discoverExampleFiles({ testDir: path.resolve(ROOT, "../e3-ui/test"), includeTopLevel: true });
    const modules: ExampleModule[] = [];
    for (const { pathKey } of files) {
        modules.push({ pathKey, exports: await import(`@elaraai/e3-ui/examples/${pathKey}`) });
    }
    return modules;
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

describe("the showcase's e3 package", () => {
    const storage = new InMemoryStorage();
    let pkg: PackageObject;
    let modules: ExampleModule[];

    before(async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-spec-"));
        try {
            const zip = path.join(dir, "e3-showcase.zip");
            await fs.writeFile(zip, await buildE3ShowcaseZip(ROOT));
            await storage.repos.create(REPO);
            const imported = await packageImport(storage, REPO, zip);
            pkg = await packageRead(storage, REPO, imported.name, imported.version);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
        modules = await exampleModules();
    });

    const read = (hash: string) => storage.objects.read(REPO, hash);

    /** The package's record of a name, decoded. */
    async function recordObject(name: string, where: string): Promise<RecordObject> {
        const hash = pkg.records.get(name);
        assert.ok(hash !== undefined, `${where}: the package has no record '${name}'`);
        return decodeRecordObject(await read(hash));
    }

    /** A dataset is in the package's structure at its path, typed and
     *  writable as declared, with a ref holding its value when it has one. */
    function assertDataset(dataset: DatasetDef, where: string): void {
        const at = pathToString(dataset.path);
        const node = nodeAt(pkg.data.structure, dataset.path);
        assert.ok(node !== undefined && node.type === "value", `${where}: the package has no dataset at ${at}`);
        assert.ok(sameType(node.value.type, dataset.type), `${where}: the package's ${at} is not of the declared type`);
        assert.equal(node.value.writable, dataset.writable, `${where}: the package's ${at} is not writable as declared`);
        // The package's refs name a dataset as e3's ref store does: `inputs/count`.
        const ref = pkg.data.refs.get(keypathToRefPath(at));
        assert.ok(ref !== undefined, `${where}: the package has no ref for ${at}`);
        const holdsValue = dataset.default !== undefined || dataset.source?.type === "value";
        assert.equal(ref.type, holdsValue ? "value" : "unassigned", `${where}: the package's ${at} is ${ref.type}`);
    }

    async function assertCarried(definition: Definition, where: string): Promise<void> {
        switch (definition.kind) {
            case "dataset": {
                assertDataset(definition, where);
                if (isRecord(definition)) {
                    const record = await recordObject(definition.name, where);
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
                assert.ok(hash !== undefined, `${where}: the package has no task '${definition.name}'`);
                const task = decodeTaskObject(await read(hash));
                assert.ok(equalFor(TreePathType)(task.output.path, definition.output.path),
                    `${where}: the package's task '${definition.name}' writes ${pathToString(task.output.path)}`);
                assertDataset(definition.output, `${where}'s output`);
                return;
            }
            case "function": {
                const hash = pkg.functions.get(definition.name);
                assert.ok(hash !== undefined, `${where}: the package has no function '${definition.name}'`);
                const fn = decodeFunctionObject(await read(hash));
                assert.ok(
                    fn.inputTypes.length === definition.inputTypes.length
                        && fn.inputTypes.every((type, i) => sameType(type, definition.inputTypes[i]!))
                        && sameType(fn.outputType, definition.outputType),
                    `${where}: the package's function '${definition.name}' has another signature`,
                );
                return;
            }
            case "mutation": {
                const record = await recordObject(definition.record.name, where);
                const hash = record.mutations.get(definition.name);
                assert.ok(hash !== undefined, `${where}: record '${definition.record.name}' has no mutation '${definition.name}'`);
                const mutation = decodeMutationObject(await read(hash));
                assert.equal(mutation.form.type, definition.form, `${where}: the mutation's form`);
                return;
            }
            case "recordIndex": {
                const record = await recordObject(definition.record.name, where);
                const hash = record.indexes.get(definition.name);
                assert.ok(hash !== undefined, `${where}: record '${definition.record.name}' has no index '${definition.name}'`);
                const index = decodeRecordIndexObject(await read(hash));
                assert.ok(sameType(index.keyType, definition.keyType), `${where}: the index's key type`);
                return;
            }
            case "migration": {
                const record = await recordObject(definition.record.name, where);
                assert.ok(record.migrations.some((step) => step.name === definition.name),
                    `${where}: record '${definition.record.name}' has no migration '${definition.name}'`);
                return;
            }
        }
    }

    test("carries every e3 definition each example module exports", async () => {
        let carried = 0;
        for (const { pathKey, exports } of modules) {
            for (const [name, value] of Object.entries(exports)) {
                if (!isDefinition(value)) continue;
                await assertCarried(value, `${pathKey}'s ${name}`);
                carried++;
            }
        }
        assert.ok(carried > 0, "the example modules export no e3 definition");
    });

    test("every example finds the datasets, paged sources, functions and records it binds", () => {
        let examples = 0;
        for (const { pathKey, exports } of modules) {
            for (const [name, value] of Object.entries(exports)) {
                if (!isExample(value)) continue;
                examples++;
                const where = `${pathKey}'s ${name}`;
                const manifest = deriveManifest(value.fn);
                for (const bound of [...manifest.paths, ...manifest.pages]) {
                    assert.ok(nodeAt(pkg.data.structure, bound)?.type === "value",
                        `${where} binds ${pathToString(bound)}, and the package has no dataset there`);
                }
                for (const fn of manifest.functions) {
                    assert.ok(pkg.functions.has(fn), `${where} binds function '${fn}', and the package has none`);
                }
                for (const record of manifest.records) {
                    assert.ok(pkg.records.has(record), `${where} binds record '${record}', and the package has none`);
                }
            }
        }
        assert.ok(examples > 0, "the example modules export no example");
    });
});

// `e3.package` keeps the last definition it meets at a path or name, so the
// step refuses two, naming the modules.
describe("the package step", () => {
    const count = (value: bigint) => e3.input("count", IntegerType, variant("value", value));
    const double = East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2n));

    test("takes a definition two modules both export once", () => {
        const shared = count(1n);
        const pkg = showcasePackage([
            { pathKey: "one/first", definitions: [["countInput", shared]] },
            { pathKey: "two/second", definitions: [["countInput", shared]] },
        ]);
        assert.equal(pkg.contents.filter((item) => item.kind === "dataset").length, 1);
    });

    test("refuses two modules declaring different datasets at one path", () => {
        assert.throws(
            () => showcasePackage([
                { pathKey: "one/first", definitions: [["countInput", count(1n)]] },
                { pathKey: "two/second", definitions: [["otherCount", count(2n)]] },
            ]),
            /one\/first \(countInput\) and two\/second \(otherCount\) both declare the path '\.inputs\.count'/,
        );
    });

    test("refuses a dataset another module's task reads at the same path", () => {
        const doubled = e3.task("doubled", [count(1n)], double);
        assert.throws(
            () => showcasePackage([
                { pathKey: "one/first", definitions: [["doubledTask", doubled]] },
                { pathKey: "two/second", definitions: [["countInput", count(2n)]] },
            ]),
            /one\/first \(through doubledTask\) and two\/second \(countInput\) both declare the path '\.inputs\.count'/,
        );
    });

    test("refuses two modules declaring different functions of one name", () => {
        const half = East.function([FloatType], FloatType, (_$, x) => x.divide(2.0));
        // Two definitions, one name: each module makes its own.
        const halveNamed = (name: string) => e3.function(name, half);
        assert.throws(
            () => showcasePackage([
                { pathKey: "one/first", definitions: [["halveFn", halveNamed("halve")]] },
                { pathKey: "two/second", definitions: [["halfFn", halveNamed("halve")]] },
            ]),
            /one\/first \(halveFn\) and two\/second \(halfFn\) both declare the function 'halve'/,
        );
    });
});
