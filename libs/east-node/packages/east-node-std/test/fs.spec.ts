/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test as unitTest } from "node:test";
import assert from "node:assert/strict";
import { East, ArrayType, DictType, IntegerType, StringType, StructType, SortedMap, compareFor, encodeBeast2PagedFor, toEastTypeValue, isFrozenValue, Beast2Pages, type EastTypeValue } from "@elaraai/east";
import { describeEast, Assert, FileSystem, FileSystemImpl, NodePlatform } from "@elaraai/east-node-std";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ex from "./fs.examples.js";

// 30 rows in segments of 10: three segments, so a keyed read decodes one.
const TableType = DictType(IntegerType, StructType({ id: IntegerType, name: StringType }));
const TABLE_BLOB = encodeBeast2PagedFor(TableType, { batchSize: 10 })(
    new SortedMap(
        Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
        compareFor(IntegerType),
    ),
);

describeEast("FileSystem platform functions", (test) => {
    Assert.examples(test, { fsWriteAndReadFile: ex.fsWriteAndReadFile, fsAppendFile: ex.fsAppendFile, fsExists: ex.fsExists, fsIsFile: ex.fsIsFile, fsIsDirectory: ex.fsIsDirectory, fsCreateDirectory: ex.fsCreateDirectory, fsReadDirectory: ex.fsReadDirectory, fsDeleteFile: ex.fsDeleteFile, fsWriteAndReadFileBytes: ex.fsWriteAndReadFileBytes, fsOpenBeastDict: ex.fsOpenBeastDict, fsOpenBeastDictForLoop: ex.fsOpenBeastDictForLoop, fsOpenBeastArray: ex.fsOpenBeastArray, fsOpenBeastSet: ex.fsOpenBeastSet, fsOpenBeastIndexless: ex.fsOpenBeastIndexless });

    test("writeFile and readFile work", $ => {
        const path = $.let(East.value(join(tmpdir(), "test.txt")));
        const content = $.let(East.value("Hello, World!"));

        $(FileSystem.writeFile(path, content));
        const read = $.let(FileSystem.readFile(path));

        $(Assert.equal(read, "Hello, World!"));
    });

    test("appendFile appends content", $ => {
        const path = $.let(East.value(join(tmpdir(), "append.txt")));

        $(FileSystem.writeFile(path, "Line 1\n"));
        $(FileSystem.appendFile(path, "Line 2\n"));

        const content = $.let(FileSystem.readFile(path));
        $(Assert.equal(content, "Line 1\nLine 2\n"));
    });

    test("exists returns true for existing files", $ => {
        const path = $.let(East.value(join(tmpdir(), "exists.txt")));

        $(FileSystem.writeFile(path, "content"));
        const exists = $.let(FileSystem.exists(path));

        $(Assert.equal(exists, true));
    });

    test("exists returns false for non-existing files", $ => {
        const path = $.let(East.value(join(tmpdir(), "does-not-exist.txt")));
        const exists = $.let(FileSystem.exists(path));

        $(Assert.equal(exists, false));
    });

    test("isFile returns true for files", $ => {
        const path = $.let(East.value(join(tmpdir(), "file.txt")));

        $(FileSystem.writeFile(path, "content"));
        const isFile = $.let(FileSystem.isFile(path));

        $(Assert.equal(isFile, true));
    });

    test("isDirectory returns true for directories", $ => {
        const path = $.let(East.value(join(tmpdir(), "subdir")));

        $(FileSystem.createDirectory(path));
        const isDir = $.let(FileSystem.isDirectory(path));

        $(Assert.equal(isDir, true));
    });

    test("createDirectory creates nested directories", $ => {
        const path = $.let(East.value(join(tmpdir(), "a", "b", "c")));

        $(FileSystem.createDirectory(path));
        const exists = $.let(FileSystem.exists(path));

        $(Assert.equal(exists, true));
    });

    test("readDirectory lists directory contents", $ => {
        const dir = $.let(East.value(join(tmpdir(), "listdir")));

        $(FileSystem.createDirectory(dir));
        $(FileSystem.writeFile(dir.concat("/file1.txt"), "a"));
        $(FileSystem.writeFile(dir.concat("/file2.txt"), "b"));

        const entries = $.let(FileSystem.readDirectory(dir));
        const count = $.let(entries.size());

        $(Assert.equal(count, 2n));
    });

    test("deleteFile removes a file", $ => {
        const path = $.let(East.value(join(tmpdir(), "delete-me.txt")));

        $(FileSystem.writeFile(path, "content"));
        $(FileSystem.deleteFile(path));

        const exists = $.let(FileSystem.exists(path));
        $(Assert.equal(exists, false));
    });

    // OS failures must be loud (#64) — a missing/unreadable file previously
    // returned an empty value from the east-c runner (and a failed write was
    // a silent no-op). These cases replay against every runner via the
    // compliance suite, pinning cross-runtime parity of the error behaviour.
    test("readFile of a missing path throws", $ => {
        $(Assert.throws(FileSystem.readFile("/definitely/does/not/exist-64.txt"), /Failed to read file/));
    });

    test("readFileBytes of a missing path throws", $ => {
        $(Assert.throws(FileSystem.readFileBytes("/definitely/does/not/exist-64.bin"), /Failed to read file bytes/));
    });

    test("writeFile into a missing directory throws", $ => {
        $(Assert.throws(FileSystem.writeFile("/definitely/does/not/exist-64/out.txt", "content"), /Failed to write file/));
    });

    test("appendFile into a missing directory throws", $ => {
        $(Assert.throws(FileSystem.appendFile("/definitely/does/not/exist-64/out.txt", "content"), /Failed to append to file/));
    });

    test("writeFileBytes into a missing directory throws", $ => {
        $(Assert.throws(FileSystem.writeFileBytes("/definitely/does/not/exist-64/out.bin", new Uint8Array([1])), /Failed to write file bytes/));
    });

    test("writeFileBytes and readFileBytes work with binary data", $ => {
        const path = $.let(East.value(join(tmpdir(), "binary.dat")));
        const data = $.let(new Uint8Array([0, 1, 2, 255]));

        $(FileSystem.writeFileBytes(path, data));
        const read = $.let(FileSystem.readFileBytes(path));

        $(Assert.equal(read, data));
    });

    // FileSystem.openBeast: the error texts and the frozen contract replay on
    // every runner through the std compliance suite, so the three
    // implementations agree with each other and with blob.openBeast.
    test("openBeast of a missing path throws", $ => {
        $(Assert.throws(FileSystem.openBeast(TableType, "/definitely/does/not/exist-660.beast2"), /Failed to open beast file/));
    });

    test("openBeast refuses a file whose header carries another type, naming both", $ => {
        const path = $.let(East.value(join(tmpdir(), "open-beast-mismatch.beast2")));
        $(FileSystem.writeFileBytes(path, East.value(TABLE_BLOB)));
        $(Assert.throws(FileSystem.openBeast(ArrayType(IntegerType), path), /Failed to open beast file .*cannot open a blob of type/));
    });

    test("openBeast refuses a file that is not a beast2 container", $ => {
        const path = $.let(East.value(join(tmpdir(), "open-beast-garbage.beast2")));
        $(FileSystem.writeFile(path, "not a beast2 container"));
        $(Assert.throws(FileSystem.openBeast(TableType, path), /Failed to open beast file/));
    });

    test("openBeast returns a frozen value: mutation is refused, a copy is mutable", $ => {
        const path = $.let(East.value(join(tmpdir(), "open-beast-frozen.beast2")));
        $(FileSystem.writeFileBytes(path, East.value(TABLE_BLOB)));
        const table = $.let(FileSystem.openBeast(TableType, path));
        $(Assert.throws(table.insert(999n, { id: 999n, name: "new" }), /cannot mutate a frozen value/));
        const copy = $.let(table.copy());
        $(copy.insert(999n, { id: 999n, name: "new" }));
        $(Assert.equal(copy.size(), 31n));
        $(Assert.equal(table.size(), 30n));
    });
}, {
    platformFns: NodePlatform,
});

describe("FileSystem.openBeast laziness and build-time checks", () => {
    // Mechanism pins for the Node implementation: the values above are shared
    // with every runner, the pager accounting is this runner's own.
    const path = join(tmpdir(), "open-beast-probe.beast2");
    writeFileSync(path, TABLE_BLOB);
    const entry = FileSystemImpl.find((p) => p.name === "fs_open_beast")!;
    const open = (entry.fn as (T: EastTypeValue) => (file: string) => unknown)(toEastTypeValue(TableType) as EastTypeValue);

    unitTest("size, a keyed read and a for loop are served from the pager", () => {
        const fn = East.function([StringType], IntegerType, ($, file) => {
            const t = $.let(FileSystem.openBeast(TableType, file));
            const sum = $.let(t.size().add(t.get(7n).id));
            $.for(t, ($, row) => {
                $.assign(sum, sum.add(row.id));
            });
            return sum;
        });
        const compiled = East.compile(fn, FileSystemImpl);
        const proto = Beast2Pages.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        const originalGet = proto.get!;
        const originalSegment = proto.segment!;
        let keyed = 0;
        let segments = 0;
        proto.get = function (this: unknown, ...args: unknown[]) { keyed++; return originalGet.apply(this, args); };
        proto.segment = function (this: unknown, ...args: unknown[]) { segments++; return originalSegment.apply(this, args); };
        try {
            assert.equal(compiled(path), 37n + 435n);
        } finally {
            proto.get = originalGet;
            proto.segment = originalSegment;
        }
        assert.equal(keyed, 1, "one keyed read reaches the pager");
        assert.equal(segments, 3, "the for loop streams each segment exactly once");
    });

    unitTest("the opened value is frozen and stays un-hydrated after served reads", () => {
        const table = open(path) as SortedMap<bigint, { id: bigint; name: string }>;
        assert.ok(table instanceof SortedMap);
        assert.equal(table.size, 30);
        assert.equal(table.get(7n)?.name, "row-7");
        assert.ok(isFrozenValue(table), "the opened value carries the frozen brand");
        assert.equal((table as unknown as { hydrated: boolean }).hydrated, false, "served reads never hydrate");
    });

    unitTest("the file descriptor is released once the value is collected", { skip: process.platform === "linux" && existsSync("/proc/self/fd") ? false : "needs /proc/self/fd" }, () => {
        // Each lazy value pages from its own descriptor; a child with the
        // collector exposed opens several, drops them, collects, and reports
        // its descriptor count at each step. The release is a finalizer, so
        // the probe is tolerant: a couple may still be pending.
        const script = `
            import { readdirSync } from "node:fs";
            import { DictType, IntegerType, StringType, StructType, toEastTypeValue } from "@elaraai/east";
            import { FileSystemImpl } from "@elaraai/east-node-std";
            const T = DictType(IntegerType, StructType({ id: IntegerType, name: StringType }));
            const open = FileSystemImpl.find((p) => p.name === "fs_open_beast").fn(toEastTypeValue(T));
            const fds = () => readdirSync("/proc/self/fd").length;
            const before = fds();
            let values = [];
            for (let i = 0; i < 8; i++) values.push(open(${JSON.stringify(path)}));
            for (const v of values) v.get(7n);
            const held = fds();
            values = null;
            let after = held;
            for (let i = 0; i < 40 && after > before; i++) {
                globalThis.gc();
                await new Promise((resolve) => setTimeout(resolve, 5));
                after = fds();
            }
            console.log(JSON.stringify({ before, held, after }));
        `;
        const out = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
            cwd: fileURLToPath(new URL("../..", import.meta.url)),
            encoding: "utf8",
        });
        const { before, held, after } = JSON.parse(out.trim()) as { before: number; held: number; after: number };
        assert.ok(held - before >= 8, `each lazy value holds one descriptor (before ${before}, held ${held})`);
        assert.ok(after <= before + 2, `descriptors released after collection (before ${before}, held ${held}, after ${after})`);
    });

    unitTest("a non-collection type is refused when the expression is built", () => {
        assert.throws(
            () => East.function([StringType], IntegerType, ($, file) => (FileSystem as unknown as { openBeast: (t: unknown, p: unknown) => never }).openBeast(IntegerType, file)),
            /FileSystem.openBeast opens Array, Set or Dict files/,
        );
    });
});
