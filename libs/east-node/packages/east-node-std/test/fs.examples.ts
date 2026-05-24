/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, StringType, example } from "@elaraai/east";
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
