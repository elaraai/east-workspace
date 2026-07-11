/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East } from "@elaraai/east";
import { describeEast, Assert, FileSystem, NodePlatform } from "@elaraai/east-node-std";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ex from "./fs.examples.js";

describeEast("FileSystem platform functions", (test) => {
    Assert.examples(test, { fsWriteAndReadFile: ex.fsWriteAndReadFile, fsAppendFile: ex.fsAppendFile, fsExists: ex.fsExists, fsIsFile: ex.fsIsFile, fsIsDirectory: ex.fsIsDirectory, fsCreateDirectory: ex.fsCreateDirectory, fsReadDirectory: ex.fsReadDirectory, fsDeleteFile: ex.fsDeleteFile, fsWriteAndReadFileBytes: ex.fsWriteAndReadFileBytes });

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
}, {
    platformFns: NodePlatform,
});
