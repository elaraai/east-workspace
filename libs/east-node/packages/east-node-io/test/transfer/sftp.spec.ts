/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SFTP platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require SFTP server running on localhost:2222.
 * Run `npm run dev:services` to start Docker containers.
 */
import { East, variant } from "@elaraai/east";
import { Console, describeEast, NodePlatform, Assert } from "@elaraai/east-node-std";
import { Transfer, sftp_close_all } from "@elaraai/east-node-io";
import * as ex from "./sftp.examples.js";

// SFTP test configuration
const TEST_CONFIG = {
    host: "localhost",
    port: 2222n,
    username: "testuser",
    password: variant('some', "testpass"),
    privateKey: variant('none', null),
};

await describeEast("SFTP platform functions", (test) => {
    Assert.examples(test, { sftpConnect: ex.sftpConnect, sftpClose: ex.sftpClose, sftpPut: ex.sftpPut, sftpGet: ex.sftpGet, sftpDelete: ex.sftpDelete, sftpList: ex.sftpList });

    test("connect and close SFTP connection", $ => {
        $(Console.log("connect and close SFTP connection"));

        const config = $.let(TEST_CONFIG);
        const handle = $.let(Transfer.SFTP.connect(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Close connection
        $(Transfer.SFTP.close(handle));
    });

    test("put uploads file successfully", $ => {
        $(Console.log("put uploads file successfully"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3, 4, 5]));

        const conn = $.let(Transfer.SFTP.connect(config));
        $(Transfer.SFTP.put(conn, "/upload/test-upload.bin", testData));
        $(Transfer.SFTP.close(conn));
    });

    test("get downloads uploaded file", $ => {
        $(Console.log("get downloads uploaded file"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([10, 20, 30, 40, 50]));

        const conn = $.let(Transfer.SFTP.connect(config));

        // Upload file first
        $(Transfer.SFTP.put(conn, "/upload/test-download.bin", testData));

        // Download it back
        const downloaded = $.let(Transfer.SFTP.get(conn, "/upload/test-download.bin"));

        // Verify data matches
        $(Assert.equal(downloaded, testData));

        $(Transfer.SFTP.close(conn));
    });

    test("delete removes uploaded file", $ => {
        $(Console.log("delete removes uploaded file"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([100, 101, 102]));

        const conn = $.let(Transfer.SFTP.connect(config));

        // Upload file first
        $(Transfer.SFTP.put(conn, "/upload/test-delete.bin", testData));

        // Delete it
        $(Transfer.SFTP.delete(conn, "/upload/test-delete.bin"));

        $(Transfer.SFTP.close(conn));
    });

    test("list returns uploaded files", $ => {
        $(Console.log("list returns uploaded files"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3]));

        const conn = $.let(Transfer.SFTP.connect(config));

        // Upload test files
        $(Transfer.SFTP.put(conn, "/upload/list-test-1.bin", testData));
        $(Transfer.SFTP.put(conn, "/upload/list-test-2.bin", testData));

        // List files in upload directory
        const files = $.let(Transfer.SFTP.list(conn, "/upload"));

        // Should have at least 2 files
        $(Assert.greaterEqual(files.size(), East.value(2n)));

        // Clean up
        $(Transfer.SFTP.delete(conn, "/upload/list-test-1.bin"));
        $(Transfer.SFTP.delete(conn, "/upload/list-test-2.bin"));

        $(Transfer.SFTP.close(conn));
    });

    test("put and get work with text data", $ => {
        $(Console.log("put and get work with text data"));

        const config = $.let(TEST_CONFIG);
        const textContent = $.let("Hello, SFTP World!");

        const conn = $.let(Transfer.SFTP.connect(config));

        // Encode text to blob
        const blob = $.let(textContent.encodeUtf8());

        // Upload text as blob
        $(Transfer.SFTP.put(conn, "/upload/test-text.txt", blob));

        // Download blob
        const downloaded = $.let(Transfer.SFTP.get(conn, "/upload/test-text.txt"));

        // Decode back to text
        const decodedText = $.let(downloaded.decodeUtf8());

        // Verify text matches
        $(Assert.equal(decodedText, textContent));

        // Clean up
        $(Transfer.SFTP.delete(conn, "/upload/test-text.txt"));

        $(Transfer.SFTP.close(conn));
    });

    test("list returns file metadata", $ => {
        $(Console.log("list returns file metadata"));

        const config = $.let(TEST_CONFIG);
        const testData = $.let(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])); // 10 bytes

        const conn = $.let(Transfer.SFTP.connect(config));

        // Upload a file
        $(Transfer.SFTP.put(conn, "/upload/metadata-test.bin", testData));

        // List to get metadata
        const files = $.let(Transfer.SFTP.list(conn, "/upload"));

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
        $(Transfer.SFTP.delete(conn, "/upload/metadata-test.bin"));

        $(Transfer.SFTP.close(conn));
    });

    test("put overwrites existing files", $ => {
        $(Console.log("put overwrites existing files"));

        const config = $.let(TEST_CONFIG);
        const data1 = $.let(new Uint8Array([1, 2, 3]));
        const data2 = $.let(new Uint8Array([4, 5, 6, 7, 8]));

        const conn = $.let(Transfer.SFTP.connect(config));

        // Upload first version
        $(Transfer.SFTP.put(conn, "/upload/overwrite-test.bin", data1));

        // Upload second version (overwrite)
        $(Transfer.SFTP.put(conn, "/upload/overwrite-test.bin", data2));

        // Download and verify it's the second version
        const downloaded = $.let(Transfer.SFTP.get(conn, "/upload/overwrite-test.bin"));
        $(Assert.equal(downloaded, data2));

        // Clean up
        $(Transfer.SFTP.delete(conn, "/upload/overwrite-test.bin"));

        $(Transfer.SFTP.close(conn));
    });
}, {
    platformFns: [ ...Transfer.SFTP.Implementation, ...NodePlatform],
    afterEach: $ => {
        // Close all connections after each test (even on failure)
        $(sftp_close_all());
    }
});
