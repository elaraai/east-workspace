/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East } from "@elaraai/east";
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { Compression } from "@elaraai/east-node-io";
import * as ex from "./tar.examples.js";

await describeEast("TAR Platform Functions", (test) => {
    Assert.examples(test, { tarCreate: ex.tarCreate, tarExtract: ex.tarExtract });

    test("creates and extracts a TAR archive with single file", $ => {
        const fileContent = "Hello from file1.txt";
        const entries = $.let([
            {
                name: "file1.txt",
                data: East.value(fileContent).encodeUtf8(),
            },
        ]);

        // Create TAR
        const tarBlob = $.let(Compression.Tar.create(entries));

        // Extract TAR
        const files = $.let(Compression.Tar.extract(tarBlob));

        // Verify file was extracted
        $(Assert.equal(files.size(), 1n));

        const extractedData = $.let(files.get("file1.txt"));
        const extractedText = $.let(extractedData.decodeUtf8());
        $(Assert.equal(extractedText, fileContent));
    });

    test("creates and extracts a TAR archive with multiple files", $ => {
        const entries = $.let([
            {
                name: "file1.txt",
                data: East.value("Content of file 1").encodeUtf8(),
            },
            {
                name: "file2.txt",
                data: East.value("Content of file 2").encodeUtf8(),
            },
            {
                name: "file3.txt",
                data: East.value("Content of file 3").encodeUtf8(),
            },
        ]);

        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));

        $(Assert.equal(files.size(), 3n));

        const file1 = $.let(files.get("file1.txt").decodeUtf8());
        const file2 = $.let(files.get("file2.txt").decodeUtf8());
        const file3 = $.let(files.get("file3.txt").decodeUtf8());

        $(Assert.equal(file1, "Content of file 1"));
        $(Assert.equal(file2, "Content of file 2"));
        $(Assert.equal(file3, "Content of file 3"));
    });

    test("handles files with directory paths", $ => {
        const entries = $.let([
            {
                name: "dir1/file1.txt",
                data: East.value("File in dir1").encodeUtf8(),
            },
            {
                name: "dir2/subdir/file2.txt",
                data: East.value("File in dir2/subdir").encodeUtf8(),
            },
        ]);

        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));

        $(Assert.equal(files.size(), 2n));

        const file1 = $.let(files.get("dir1/file1.txt").decodeUtf8());
        const file2 = $.let(files.get("dir2/subdir/file2.txt").decodeUtf8());

        $(Assert.equal(file1, "File in dir1"));
        $(Assert.equal(file2, "File in dir2/subdir"));
    });

    test("handles empty file", $ => {
        const entries = $.let([
            {
                name: "empty.txt",
                data: East.value("").encodeUtf8(),
            },
        ]);

        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));

        $(Assert.equal(files.size(), 1n));

        const extractedText = $.let(files.get("empty.txt").decodeUtf8());
        $(Assert.equal(extractedText, ""));
    });

    test("handles large file", $ => {
        const largeContent = "A".repeat(100000);
        const entries = $.let([
            {
                name: "large.txt",
                data: East.value(largeContent).encodeUtf8(),
            },
        ]);

        const tarBlob = $.let(Compression.Tar.create(entries));
        const files = $.let(Compression.Tar.extract(tarBlob));

        const extractedText = $.let(files.get("large.txt").decodeUtf8());
        $(Assert.equal(extractedText, largeContent));
    });
}, { platformFns: [...Compression.Tar.Implementation, ...NodePlatform] });
