/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * FTP platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require FTP server running on localhost:21.
 * Run `npm run dev:services` to start Docker containers.
 */
import { East } from "@elaraai/east";
import { describeEast, Assert, Console, NodePlatform } from "@elaraai/east-node-std";
import { Transfer, ftp_close_all } from "@elaraai/east-node-io";
import * as ex from "./ftp.examples.js";

// FTP test configuration
const TEST_CONFIG = {
    host: "localhost",
    port: 21n,
    user: "testuser",
    password: "testpass",
    secure: false,
};

await describeEast("FTP platform functions", (test) => {
    Assert.examples(test, { ftpConnect: ex.ftpConnect, ftpClose: ex.ftpClose, ftpPut: ex.ftpPut, ftpGet: ex.ftpGet, ftpDelete: ex.ftpDelete, ftpList: ex.ftpList });

    test("connect and close FTP connection", $ => {
        $(Console.log("connect and close FTP connection"));

        const config = $.let(TEST_CONFIG);
        const handle = $.let(Transfer.FTP.connect(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Close connection
        $(Transfer.FTP.close(handle));
    });

    test("put uploads file successfully", $ => {
        $(Console.log("put uploads file successfully"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3, 4, 5]));

        const conn = $.let(Transfer.FTP.connect(config));
        $(Transfer.FTP.put(conn, "test-upload.bin", testData));
        $(Transfer.FTP.close(conn));
    });

    test("get downloads uploaded file", $ => {
        $(Console.log("get downloads uploaded file"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([10, 20, 30, 40, 50]));

        const conn = $.let(Transfer.FTP.connect(config));

        // Upload file first
        $(Transfer.FTP.put(conn, "test-download.bin", testData));

        // Download it back
        const downloaded = $.let(Transfer.FTP.get(conn, "test-download.bin"));

        // Verify data matches
        $(Assert.equal(downloaded, testData));

        $(Transfer.FTP.close(conn));
    });

    test("delete removes uploaded file", $ => {
        $(Console.log("delete removes uploaded file"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([100, 101, 102]));

        const conn = $.let(Transfer.FTP.connect(config));

        // Upload file first
        $(Transfer.FTP.put(conn, "test-delete.bin", testData));

        // Delete it
        $(Transfer.FTP.delete(conn, "test-delete.bin"));

        $(Transfer.FTP.close(conn));
    });

    test("list returns uploaded files", $ => {
        $(Console.log("list returns uploaded files"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3]));

        const conn = $.let(Transfer.FTP.connect(config));

        // Upload test files
        $(Transfer.FTP.put(conn, "list-test-1.bin", testData));
        $(Transfer.FTP.put(conn, "list-test-2.bin", testData));

        // List files in root directory
        const files = $.let(Transfer.FTP.list(conn, "/"));

        // Should have at least 2 files
        $(Assert.greaterEqual(files.size(), East.value(2n)));

        // Clean up
        $(Transfer.FTP.delete(conn, "list-test-1.bin"));
        $(Transfer.FTP.delete(conn, "list-test-2.bin"));

        $(Transfer.FTP.close(conn));
    });

    test("put and get work with text data", $ => {
        $(Console.log("put and get work with text data"));

        const config = $.let(TEST_CONFIG);
        const textContent = $.let("Hello, FTP World!");

        const conn = $.let(Transfer.FTP.connect(config));

        // Encode text to blob
        const blob = $.let(textContent.encodeUtf8());

        // Upload text as blob
        $(Transfer.FTP.put(conn, "test-text.txt", blob));

        // Download blob
        const downloaded = $.let(Transfer.FTP.get(conn, "test-text.txt"));

        // Decode back to text
        const decodedText = $.let(downloaded.decodeUtf8());

        // Verify text matches
        $(Assert.equal(decodedText, textContent));

        // Clean up
        $(Transfer.FTP.delete(conn, "test-text.txt"));

        $(Transfer.FTP.close(conn));
    });

    test("list returns file metadata", $ => {
        $(Console.log("list returns file metadata"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])); // 10 bytes

        const conn = $.let(Transfer.FTP.connect(config));

        // Upload a file
        $(Transfer.FTP.put(conn, "metadata-test.bin", testData));

        // List to get metadata
        const files = $.let(Transfer.FTP.list(conn, "/"));

        // Find our file in the list
        const foundFile = $.let(files.findFirst("metadata-test.bin", ($, v) => v.name));

        // Verify file was found (option should be Some)
        $.match(foundFile, {
            some: ($, idx) => {
                const file = $.let(files.get(idx));
                // Verify size is 10 bytes
                $(Assert.equal(file.size, East.value(10n)));

                // Verify name matches
                $(Assert.equal(file.name, East.value("metadata-test.bin")));

                // Verify it's a file (not a directory)
                $(Assert.equal(file.isDirectory, East.value(false)));
            },
            none: ($) => $(Assert.fail("Expected to find file in listing")),
        });

        // Clean up
        $(Transfer.FTP.delete(conn, "metadata-test.bin"));

        $(Transfer.FTP.close(conn));
    });

    test("put overwrites existing files", $ => {
        $(Console.log("put overwrites existing files"));

        const config = $.let(TEST_CONFIG);
        const data1 = $.let(new Uint8Array([1, 2, 3]));
        const data2 = $.let(new Uint8Array([4, 5, 6, 7, 8]));

        const conn = $.let(Transfer.FTP.connect(config));

        // Upload first version
        $(Transfer.FTP.put(conn, "overwrite-test.bin", data1));

        // Upload second version (overwrite)
        $(Transfer.FTP.put(conn, "overwrite-test.bin", data2));

        // Download and verify it's the second version
        const downloaded = $.let(Transfer.FTP.get(conn, "overwrite-test.bin"));
        $(Assert.equal(downloaded, data2));

        // Clean up
        $(Transfer.FTP.delete(conn, "overwrite-test.bin"));

        $(Transfer.FTP.close(conn));
    });
}, {
    platformFns: [ ...Transfer.FTP.Implementation, ...NodePlatform],
    afterEach: $ => {
        // Close all connections after each test (even on failure)
        $(ftp_close_all());
    }
});
