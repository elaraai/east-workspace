/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, StringType, BlobType, ArrayType, SetType, DictType, StructType, SortedMap, SortedSet, compareFor, encodeBeast2PagedFor, example } from "@elaraai/east";
import { FileSystem } from "@elaraai/east-node-std";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const fsWriteAndReadFile = example({
    keywords: ["fs", "FileSystem", "writeFile", "readFile", "text", "file"],
    description: "Write and read back a text file",
    fn: East.asyncFunction([], StringType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-write-read.txt")));
        $(FileSystem.writeFile(path, "Hello, World!"));
        const content = $.let(FileSystem.readFile(path));
        return content;
    }),
    inputs: [],
    returns: "Hello, World!",
});

export const fsAppendFile = example({
    keywords: ["fs", "FileSystem", "appendFile", "append", "file"],
    description: "Append content to a file",
    fn: East.asyncFunction([], StringType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-append.txt")));
        $(FileSystem.writeFile(path, "Line 1\n"));
        $(FileSystem.appendFile(path, "Line 2\n"));
        const content = $.let(FileSystem.readFile(path));
        return content;
    }),
    inputs: [],
    returns: "Line 1\nLine 2\n",
});

export const fsExists = example({
    keywords: ["fs", "FileSystem", "exists", "check", "file"],
    description: "Check if a file exists",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-exists.txt")));
        $(FileSystem.writeFile(path, "content"));
        const exists = $.let(FileSystem.exists(path));
        return exists;
    }),
    inputs: [],
    returns: true,
});

export const fsIsFile = example({
    keywords: ["fs", "FileSystem", "isFile", "check", "file"],
    description: "Check if a path is a file",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-isfile.txt")));
        $(FileSystem.writeFile(path, "content"));
        return FileSystem.isFile(path);
    }),
    inputs: [],
    returns: true,
});

export const fsIsDirectory = example({
    keywords: ["fs", "FileSystem", "isDirectory", "check", "directory"],
    description: "Check if a path is a directory",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-isdir")));
        $(FileSystem.createDirectory(path));
        return FileSystem.isDirectory(path);
    }),
    inputs: [],
    returns: true,
});

export const fsCreateDirectory = example({
    keywords: ["fs", "FileSystem", "createDirectory", "mkdir", "directory"],
    description: "Create a nested directory structure",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-mkdir", "nested", "dir")));
        $(FileSystem.createDirectory(path));
        return FileSystem.exists(path);
    }),
    inputs: [],
    returns: true,
});

export const fsReadDirectory = example({
    keywords: ["fs", "FileSystem", "readDirectory", "list", "directory"],
    description: "List the contents of a directory",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const dir = $.let(East.value(join(tmpdir(), "ex-readdir")));
        $(FileSystem.createDirectory(dir));
        $(FileSystem.writeFile(dir.concat("/a.txt"), "a"));
        $(FileSystem.writeFile(dir.concat("/b.txt"), "b"));
        const entries = $.let(FileSystem.readDirectory(dir));
        return entries.size();
    }),
    inputs: [],
    returns: 2n,
});

export const fsDeleteFile = example({
    keywords: ["fs", "FileSystem", "deleteFile", "remove", "file"],
    description: "Delete a file",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-delete.txt")));
        $(FileSystem.writeFile(path, "content"));
        $(FileSystem.deleteFile(path));
        return FileSystem.exists(path);
    }),
    inputs: [],
    returns: false,
});

export const fsWriteAndReadFileBytes = example({
    keywords: ["fs", "FileSystem", "writeFileBytes", "readFileBytes", "binary", "blob"],
    description: "Write and read back binary data",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-binary.dat")));
        const data = $.let(new Uint8Array([0, 1, 2, 255]));
        $(FileSystem.writeFileBytes(path, data));
        const read = $.let(FileSystem.readFileBytes(path));
        return East.is(read, data);
    }),
    inputs: [],
    returns: true,
});

// The blobs below are what the paged writers produce — segmented, indexed,
// self-contained — 30 rows in segments of 10, so a keyed read decodes one of
// three segments. Each example writes its blob to a file first, because
// FileSystem.openBeast opens a PATH: the file is what gets mapped (east-c,
// east-py) or read (Node) and paged from.

const OpenRowType = StructType({ id: IntegerType, name: StringType });
const OpenTableType = DictType(IntegerType, OpenRowType);
const OpenTagsType = SetType(StringType);
const OpenRowsType = ArrayType(StringType);

const OPEN_TABLE_BLOB = encodeBeast2PagedFor(OpenTableType, { batchSize: 10 })(
    new SortedMap(
        Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
        compareFor(IntegerType),
    ),
);
const OPEN_TAGS_BLOB = encodeBeast2PagedFor(OpenTagsType, { batchSize: 10 })(
    new SortedSet(Array.from({ length: 30 }, (_, i) => `tag-${String(i).padStart(4, "0")}`), compareFor(StringType)),
);
const OPEN_ROWS_BLOB = encodeBeast2PagedFor(OpenRowsType, { batchSize: 10 })(
    Array.from({ length: 30 }, (_, i) => `row-${i}`),
);

export const fsOpenBeastDict = example({
    keywords: ["fs", "FileSystem", "openBeast", "beast2", "lazy", "paged", "dict", "DictType", "file", "mmap", "frozen"],
    description: "Open an indexed beast2 dict file lazily and read a key without decoding the whole file",
    fn: East.asyncFunction([BlobType], IntegerType, ($, blob) => {
        const path = $.let(East.value(join(tmpdir(), "ex-open-beast-dict.beast2")));
        $(FileSystem.writeFileBytes(path, blob));
        const table = $.let(FileSystem.openBeast(OpenTableType, path));
        return table.size().add(table.get(7n).id);
    }),
    inputs: [OPEN_TABLE_BLOB],
    returns: 37n,
});

export const fsOpenBeastDictForLoop = example({
    keywords: ["fs", "FileSystem", "openBeast", "beast2", "lazy", "paged", "dict", "for", "loop", "stream", "segment"],
    description: "Iterate a lazily opened beast2 dict file with $.for, one decoded segment at a time",
    fn: East.asyncFunction([BlobType], IntegerType, ($, blob) => {
        const path = $.let(East.value(join(tmpdir(), "ex-open-beast-loop.beast2")));
        $(FileSystem.writeFileBytes(path, blob));
        const table = $.let(FileSystem.openBeast(OpenTableType, path));
        const sum = $.let(0n);
        $.for(table, ($, row) => {
            $.assign(sum, sum.add(row.id));
        });
        return sum;
    }),
    inputs: [OPEN_TABLE_BLOB],
    returns: 435n,
});

export const fsOpenBeastArray = example({
    keywords: ["fs", "FileSystem", "openBeast", "beast2", "lazy", "paged", "array", "ArrayType", "index", "file"],
    description: "Open an indexed beast2 array file lazily and read one element by index",
    fn: East.asyncFunction([BlobType], StringType, ($, blob) => {
        const path = $.let(East.value(join(tmpdir(), "ex-open-beast-array.beast2")));
        $(FileSystem.writeFileBytes(path, blob));
        const rows = $.let(FileSystem.openBeast(OpenRowsType, path));
        return rows.get(25n);
    }),
    inputs: [OPEN_ROWS_BLOB],
    returns: "row-25",
});

export const fsOpenBeastSet = example({
    keywords: ["fs", "FileSystem", "openBeast", "beast2", "lazy", "paged", "set", "SetType", "has", "membership", "file"],
    description: "Open an indexed beast2 set file lazily and test membership",
    fn: East.asyncFunction([BlobType], BooleanType, ($, blob) => {
        const path = $.let(East.value(join(tmpdir(), "ex-open-beast-set.beast2")));
        $(FileSystem.writeFileBytes(path, blob));
        const tags = $.let(FileSystem.openBeast(OpenTagsType, path));
        return tags.has("tag-0007");
    }),
    inputs: [OPEN_TAGS_BLOB],
    returns: true,
});

export const fsOpenBeastIndexless = example({
    keywords: ["fs", "FileSystem", "openBeast", "beast2", "encodeBeast", "index-less", "fallback", "whole decode", "frozen"],
    description: "FileSystem.openBeast on an index-less beast2 file falls back to the whole frozen decode",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const path = $.let(East.value(join(tmpdir(), "ex-open-beast-indexless.beast2")));
        const values = $.const([1n, 2n, 3n], ArrayType(IntegerType));
        $(FileSystem.writeFileBytes(path, East.Blob.encodeBeast(values, 'v2')));
        return FileSystem.openBeast(ArrayType(IntegerType), path).get(1n);
    }),
    inputs: [],
    returns: 2n,
});
