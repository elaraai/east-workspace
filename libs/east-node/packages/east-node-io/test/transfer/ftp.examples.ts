/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, StringType, example } from "@elaraai/east";
import { Transfer } from "@elaraai/east-node-io";

const ftpConfig = {
    host: "localhost",
    port: 21n,
    user: "testuser",
    password: "testpass",
    secure: false,
};

export const ftpConnect = example({
    keywords: ["ftp", "FTP", "connect", "connection"],
    description: "Connect to an FTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(ftpConfig);
        const handle = $.let(Transfer.FTP.connect(config));
        $(Transfer.FTP.close(handle));
    }),
    inputs: [],
});

export const ftpClose = example({
    keywords: ["ftp", "FTP", "close", "disconnect"],
    description: "Close an FTP connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(ftpConfig);
        const handle = $.let(Transfer.FTP.connect(config));
        $(Transfer.FTP.close(handle));
    }),
    inputs: [],
});

export const ftpPut = example({
    keywords: ["ftp", "FTP", "put", "upload", "write"],
    description: "Upload a file to an FTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(ftpConfig);
        const conn = $.let(Transfer.FTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3, 4, 5]));
        $(Transfer.FTP.put(conn, "example-upload.bin", data));
        $(Transfer.FTP.delete(conn, "example-upload.bin"));
        $(Transfer.FTP.close(conn));
    }),
    inputs: [],
});

export const ftpGet = example({
    keywords: ["ftp", "FTP", "get", "download", "read"],
    description: "Download a file from an FTP server",
    fn: East.asyncFunction([], StringType, ($) => {
        const config = $.let(ftpConfig);
        const conn = $.let(Transfer.FTP.connect(config));
        const blob = $.let(East.value("Hello, FTP!").encodeUtf8());
        $(Transfer.FTP.put(conn, "example-download.txt", blob));
        const downloaded = $.let(Transfer.FTP.get(conn, "example-download.txt"));
        $(Transfer.FTP.delete(conn, "example-download.txt"));
        $(Transfer.FTP.close(conn));
        return downloaded.decodeUtf8();
    }),
    inputs: [],
    returns: "Hello, FTP!",
});

export const ftpDelete = example({
    keywords: ["ftp", "FTP", "delete", "remove"],
    description: "Delete a file from an FTP server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(ftpConfig);
        const conn = $.let(Transfer.FTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Transfer.FTP.put(conn, "example-delete.bin", data));
        $(Transfer.FTP.delete(conn, "example-delete.bin"));
        $(Transfer.FTP.close(conn));
    }),
    inputs: [],
});

export const ftpList = example({
    keywords: ["ftp", "FTP", "list", "directory", "browse"],
    description: "List files in an FTP directory",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(ftpConfig);
        const conn = $.let(Transfer.FTP.connect(config));
        const data = $.let(new Uint8Array([1, 2, 3]));
        $(Transfer.FTP.put(conn, "example-list.bin", data));
        const files = $.let(Transfer.FTP.list(conn, "/"));
        $(Transfer.FTP.delete(conn, "example-list.bin"));
        $(Transfer.FTP.close(conn));
        return files.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});
