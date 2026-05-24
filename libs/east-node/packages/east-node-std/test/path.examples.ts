/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, StringType, example } from "@elaraai/east";
import { Path } from "@elaraai/east-node-std";

export const pathJoin = example({
    keywords: ["path", "Path", "join", "combine", "segments"],
    description: "Join path segments into a single path",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const segments = $.let(["foo", "bar", "baz.txt"]);
        const result = $.let(Path.join(segments));
        return result.contains("/");
    }),
    inputs: [],
    returns: true,
});

export const pathDirname = example({
    keywords: ["path", "Path", "dirname", "directory", "parent"],
    description: "Get the directory portion of a path",
    fn: East.asyncFunction([], StringType, ($) => {
        const path = $.let(East.value("/foo/bar/file.txt"));
        return Path.dirname(path);
    }),
    inputs: [],
    returns: "/foo/bar",
});

export const pathBasename = example({
    keywords: ["path", "Path", "basename", "filename"],
    description: "Get the file name from a path",
    fn: East.asyncFunction([], StringType, ($) => {
        const path = $.let(East.value("/foo/bar/file.txt"));
        return Path.basename(path);
    }),
    inputs: [],
    returns: "file.txt",
});

export const pathExtname = example({
    keywords: ["path", "Path", "extname", "extension"],
    description: "Get the file extension from a path",
    fn: East.asyncFunction([], StringType, ($) => {
        const path = $.let(East.value("file.txt"));
        return Path.extname(path);
    }),
    inputs: [],
    returns: ".txt",
});

export const pathResolve = example({
    keywords: ["path", "Path", "resolve", "absolute"],
    description: "Resolve a relative path to an absolute path",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const path = $.let(East.value("test.txt"));
        const result = $.let(Path.resolve(path));
        return result.length().greater(8n);
    }),
    inputs: [],
    returns: true,
});
