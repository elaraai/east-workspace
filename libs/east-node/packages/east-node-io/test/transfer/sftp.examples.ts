/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, StringType, variant, example } from "@elaraai/east";
import { Transfer } from "@elaraai/east-node-io";

const sftpConfig = {
    host: "localhost",
    port: 2222n,
    username: "testuser",
    password: variant('some', "testpass"),
    privateKey: variant('none', null),
};

export const sftpConnect = example({
    keywords: ["sftp", "SFTP", "connect", "connection"],
    description: "Connect to an SFTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(sftpConfig);
        const handle = $.let(Transfer.SFTP.connect(config));
        $(Transfer.SFTP.close(handle));
    }),
    inputs: [],
});

export const sftpClose = example({
    keywords: ["sftp", "SFTP", "close", "disconnect"],
    description: "Close an SFTP connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(sftpConfig);
        const handle = $.let(Transfer.SFTP.connect(config));
        $(Transfer.SFTP.close(handle));
    }),
    inputs: [],
});

export const sftpPut = example({
    keywords: ["sftp", "SFTP", "put", "upload", "write"],
    description: "Upload a file to an SFTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(sftpConfig);
        const conn = $.let(Transfer.SFTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3, 4, 5]));
        $(Transfer.SFTP.put(conn, "/upload/example-upload.bin", data));
        $(Transfer.SFTP.delete(conn, "/upload/example-upload.bin"));
        $(Transfer.SFTP.close(conn));
    }),
    inputs: [],
});

export const sftpGet = example({
    keywords: ["sftp", "SFTP", "get", "download", "read"],
    description: "Download a file from an SFTP server",
    fn: East.asyncFunction([], StringType, ($) => {
        const config = $.let(sftpConfig);
        const conn = $.let(Transfer.SFTP.connect(config));
        const blob = $.let(East.value("Hello, SFTP!").encodeUtf8());
        $(Transfer.SFTP.put(conn, "/upload/example-download.txt", blob));
        const downloaded = $.let(Transfer.SFTP.get(conn, "/upload/example-download.txt"));
        $(Transfer.SFTP.delete(conn, "/upload/example-download.txt"));
        $(Transfer.SFTP.close(conn));
        return downloaded.decodeUtf8();
    }),
    inputs: [],
    returns: "Hello, SFTP!",
});

export const sftpDelete = example({
    keywords: ["sftp", "SFTP", "delete", "remove"],
    description: "Delete a file from an SFTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(sftpConfig);
        const conn = $.let(Transfer.SFTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Transfer.SFTP.put(conn, "/upload/example-delete.bin", data));
        $(Transfer.SFTP.delete(conn, "/upload/example-delete.bin"));
        $(Transfer.SFTP.close(conn));
    }),
    inputs: [],
});

export const sftpList = example({
    keywords: ["sftp", "SFTP", "list", "directory", "browse"],
    description: "List files in an SFTP directory",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(sftpConfig);
        const conn = $.let(Transfer.SFTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Transfer.SFTP.put(conn, "/upload/example-list.bin", data));
        const files = $.let(Transfer.SFTP.list(conn, "/upload"));
        $(Transfer.SFTP.delete(conn, "/upload/example-list.bin"));
        $(Transfer.SFTP.close(conn));
        return files.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});
