/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East } from "@elaraai/east";
import { describeEast, Assert, Path, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./path.examples.js";

describeEast("Path platform functions", (test) => {
    Assert.examples(test, { pathJoin: ex.pathJoin, pathDirname: ex.pathDirname, pathBasename: ex.pathBasename, pathExtname: ex.pathExtname, pathResolve: ex.pathResolve });

    test("join combines path segments", $ => {
        const segments = $.let(["foo", "bar", "baz.txt"]);
        const result = $.let(Path.join(segments));

        $(Assert.equal(result.contains("/"), true));
    });

    test("dirname returns directory portion", $ => {
        const path = $.let(East.value("/foo/bar/file.txt"));
        const result = $.let(Path.dirname(path));

        $(Assert.equal(result, "/foo/bar"));
    });

    test("basename returns file name", $ => {
        const path = $.let(East.value("/foo/bar/file.txt"));
        const result = $.let(Path.basename(path));

        $(Assert.equal(result, "file.txt"));
    });

    test("extname returns file extension", $ => {
        const path = $.let(East.value("file.txt"));
        const result = $.let(Path.extname(path));

        $(Assert.equal(result, ".txt"));
    });

    test("resolve returns absolute path", $ => {
        const path = $.let(East.value("test.txt"));
        const result = $.let(Path.resolve(path));
        const len = $.let(result.length());

        // Absolute paths are longer than relative
        $(Assert.greater(len, 8n));
    });
}, { platformFns: NodePlatform });
