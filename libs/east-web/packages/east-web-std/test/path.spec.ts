/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Path's functions are east-node-std's: node:path/posix's, which a browser
 * does not have, ported. Every path of up to eight characters drawn from `/`,
 * `.` and a name, and every join of up to three segments, gives node's answer.
 * A browser has no working directory, so `resolve` resolves against `/`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { ArrayType, East, StringType } from "@elaraai/east";
import { Path } from "@elaraai/east-web-std";

const join = East.function([ArrayType(StringType)], StringType, ($, segments) => Path.join(segments)).toIR().compile(Path.Implementation);
const resolve = East.function([StringType], StringType, ($, path) => Path.resolve(path)).toIR().compile(Path.Implementation);
const dirname = East.function([StringType], StringType, ($, path) => Path.dirname(path)).toIR().compile(Path.Implementation);
const basename = East.function([StringType], StringType, ($, path) => Path.basename(path)).toIR().compile(Path.Implementation);
const extname = East.function([StringType], StringType, ($, path) => Path.extname(path)).toIR().compile(Path.Implementation);

/** Every string of up to `length` characters drawn from `alphabet`. */
function strings(alphabet: readonly string[], length: number): string[] {
    const all = [""];
    let previous = [""];
    for (let n = 1; n <= length; n++) {
        previous = previous.flatMap(prefix => alphabet.map(character => prefix + character));
        all.push(...previous);
    }
    return all;
}

/** Paths a person writes, beside the generated ones. */
const NAMED = [
    "file.txt", "/foo/bar/file.txt", "/foo/bar/", "foo/bar", ".bashrc", "a.b.c", "archive.tar.gz", "..", "...",
    "a..", "..a", "a/..", "/..", "../..", "//", "///a//b//", "./a/./b/../c", "é/ü.txt", "日本/語.md",
    "/home/user/documents/file.txt", "C:\\windows\\path.txt", "a\\b/c", " spaced / name .txt",
];

/** The corpus: every path of up to eight characters of `/`, `.` and `a`, and the named ones. */
const PATHS = [...strings(["/", ".", "a"], 8), ...NAMED];

/** Every array of up to three segments drawn from these. */
const SEGMENTS = ["", ".", "..", "a", "/", "b/", "/c", "d.e", "..."];
const JOINS: string[][] = [[]];
for (let n = 1; n <= 3; n++) {
    const previous = JOINS.filter(segments => segments.length === n - 1);
    JOINS.push(...previous.flatMap(prefix => SEGMENTS.map(segment => [...prefix, segment])));
}

/** Where a function answers otherwise than node's, at most the first ten. */
function differences(inputs: readonly string[], ours: (path: string) => string, node: (path: string) => string): string[] {
    return inputs
        .filter(path => ours(path) !== node(path))
        .slice(0, 10)
        .map(path => `${JSON.stringify(path)}: ${JSON.stringify(ours(path))} here, ${JSON.stringify(node(path))} on node`);
}

describe("Path gives node:path/posix's answers", () => {
    it("covers the corpus", () => {
        assert.equal(PATHS.length, 9841 + NAMED.length);
        assert.equal(JOINS.length, 1 + 9 + 81 + 729);
    });

    it("dirname", () => {
        assert.deepEqual(differences(PATHS, dirname, posix.dirname), []);
    });

    it("basename", () => {
        assert.deepEqual(differences(PATHS, basename, (path) => posix.basename(path)), []);
    });

    it("extname", () => {
        assert.deepEqual(differences(PATHS, extname, posix.extname), []);
    });

    it("join", () => {
        const found = JOINS
            .filter(segments => join(segments) !== posix.join(...segments))
            .slice(0, 10)
            .map(segments => `${JSON.stringify(segments)}: ${JSON.stringify(join(segments))} here, ${JSON.stringify(posix.join(...segments))} on node`);
        assert.deepEqual(found, []);
    });

    it("resolve, against the root", () => {
        assert.deepEqual(differences(PATHS, resolve, (path) => posix.resolve("/", path)), []);
    });
});

describe("Path.resolve", () => {
    it("gives an absolute path, a relative one resolved against the root", () => {
        assert.equal(resolve("test.txt"), "/test.txt");
        assert.equal(resolve("documents/../file.txt"), "/file.txt");
        assert.equal(resolve("../../up"), "/up");
        assert.equal(resolve(""), "/");
        assert.equal(resolve("/already/absolute/"), "/already/absolute");
        for (const path of PATHS) {
            assert.ok(resolve(path).startsWith("/"), `${JSON.stringify(path)} resolved relative`);
        }
    });
});

describe("Path.join", () => {
    it("joins with forward slashes and normalises", () => {
        assert.equal(join(["foo", "bar", "baz.txt"]), "foo/bar/baz.txt");
        assert.equal(join(["/foo", "../bar", "./baz/"]), "/bar/baz/");
        assert.equal(join([]), ".");
        assert.equal(join(["", ""]), ".");
    });
});
