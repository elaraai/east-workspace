/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * File transfer platform functions.
 *
 * Provides FTP and SFTP file transfer operations for East programs,
 * supporting upload, download, list, and delete operations.
 *
 * @packageDocumentation
 */

// Export individual modules
export * from "./ftp.js";
export * from "./sftp.js";

// Export public types (not ConnectionHandleType to avoid conflict with SQL module)
export { FtpConfigType, SftpConfigType, FileInfoType } from "./types.js";

// Import for grouped exports
import {
    ftp_connect,
    ftp_put,
    ftp_get,
    ftp_list,
    ftp_delete,
    ftp_close,
    FtpImpl
} from "./ftp.js";
import {
    sftp_connect,
    sftp_put,
    sftp_get,
    sftp_list,
    sftp_delete,
    sftp_close,
    SftpImpl
} from "./sftp.js";
import {
    FtpConfigType,
    SftpConfigType,
    FileInfoType
} from "./types.js";

/**
 * File transfer platform functions.
 *
 * Provides FTP and SFTP file transfer operations for East programs,
 * including upload, download, list, and delete operations.
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType, NullType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const uploadFile = East.function([StringType, BlobType], NullType, ($, filename, data) => {
 *     const config = $.let({
 *         host: "ftp.example.com",
 *         port: 21n,
 *         user: "username",
 *         password: "password",
 *         secure: false,
 *     });
 *
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     $(Transfer.FTP.put(conn, `/uploads/${filename}`, data));
 *     $(Transfer.FTP.close(conn));
 * });
 *
 * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.FTP.Implementation);
 * await compiled("document.pdf", pdfData);
 * ```
 */
export const Transfer = {
    /**
     * FTP and FTPS file transfer operations.
     *
     * Provides platform functions for FTP (File Transfer Protocol) and
     * FTPS (FTP over SSL/TLS) servers.
     */
    FTP: {
        /**
         * Connects to an FTP server.
         *
         * Creates a connection to an FTP or FTPS server and returns an
         * opaque handle for use in file transfer operations.
         *
         * @example
         * ```ts
         * const uploadFile = East.function([StringType, BlobType], NullType, ($, path, data) => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     $(Transfer.FTP.put(conn, path, data));
         *     $(Transfer.FTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.FTP.Implementation);
         * await compiled("/uploads/report.pdf", pdfData);
         * ```
         */
        connect: ftp_connect,

        /**
         * Uploads a file to an FTP server.
         *
         * Uploads binary data to the FTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const uploadFile = East.function([StringType, BlobType], NullType, ($, path, data) => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     $(Transfer.FTP.put(conn, path, data));
         *     $(Transfer.FTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.FTP.Implementation);
         * await compiled("/uploads/file.txt", fileData);
         * ```
         */
        put: ftp_put,

        /**
         * Downloads a file from an FTP server.
         *
         * Retrieves binary data from the FTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const downloadFile = East.function([StringType], BlobType, ($, path) => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     const data = $.let(Transfer.FTP.get(conn, path));
         *     $(Transfer.FTP.close(conn));
         *     $.return(data);
         * });
         *
         * const compiled = East.compileAsync(downloadFile.toIR(), Transfer.FTP.Implementation);
         * await compiled("/downloads/file.txt");  // Uint8Array
         * ```
         */
        get: ftp_get,

        /**
         * Lists files in an FTP directory.
         *
         * Retrieves metadata for all files and directories in the specified path.
         *
         * @example
         * ```ts
         * const listFiles = East.function([StringType], ArrayType(FileInfoType), ($, path) => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     const files = $.let(Transfer.FTP.list(conn, path));
         *     $(Transfer.FTP.close(conn));
         *     $.return(files);
         * });
         *
         * const compiled = East.compileAsync(listFiles.toIR(), Transfer.FTP.Implementation);
         * await compiled("/uploads");  // [{name: "file.txt", size: 1024n, ...}, ...]
         * ```
         */
        list: ftp_list,

        /**
         * Deletes a file from an FTP server.
         *
         * Removes a file from the FTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const deleteFile = East.function([StringType], NullType, ($, path) => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     $(Transfer.FTP.delete(conn, path));
         *     $(Transfer.FTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(deleteFile.toIR(), Transfer.FTP.Implementation);
         * await compiled("/uploads/old-file.txt");
         * ```
         */
        delete: ftp_delete,

        /**
         * Closes the FTP connection.
         *
         * Closes the connection and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         host: "ftp.example.com",
         *         port: 21n,
         *         user: "username",
         *         password: "password",
         *         secure: false,
         *     });
         *     const conn = $.let(Transfer.FTP.connect(config));
         *     // ... do work ...
         *     $(Transfer.FTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), Transfer.FTP.Implementation);
         * await compiled();
         * ```
         */
        close: ftp_close,

        /**
         * Node.js implementation of FTP platform functions.
         *
         * Pass this to East.compileAsync() to enable FTP operations.
         */
        Implementation: FtpImpl,

        /**
         * Type definitions for FTP operations.
         */
        Types: {
            /**
             * FTP connection configuration type.
             */
            Config: FtpConfigType,

            /**
             * File information metadata type.
             */
            FileInfo: FileInfoType,
        },
    },

    /**
     * SFTP file transfer operations.
     *
     * Provides platform functions for SFTP (SSH File Transfer Protocol) servers.
     */
    SFTP: {
        /**
         * Connects to an SFTP server.
         *
         * Creates a connection to an SFTP server and returns an
         * opaque handle for use in file transfer operations.
         *
         * @example
         * ```ts
         * const uploadFile = East.function([StringType, BlobType], NullType, ($, path, data) => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: East.some("password"),
         *         privateKey: variant('none', null),
         *     });
         *
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     $(Transfer.SFTP.put(conn, path, data));
         *     $(Transfer.SFTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.SFTP.Implementation);
         * await compiled("/uploads/report.pdf", pdfData);
         * ```
         */
        connect: sftp_connect,

        /**
         * Uploads a file to an SFTP server.
         *
         * Uploads binary data to the SFTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const uploadFile = East.function([StringType, BlobType], NullType, ($, path, data) => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: variant('some', "password"),
         *         privateKey: variant('none', null),
         *     });
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     $(Transfer.SFTP.put(conn, path, data));
         *     $(Transfer.SFTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.SFTP.Implementation);
         * await compiled("/uploads/file.txt", fileData);
         * ```
         */
        put: sftp_put,

        /**
         * Downloads a file from an SFTP server.
         *
         * Retrieves binary data from the SFTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const downloadFile = East.function([StringType], BlobType, ($, path) => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: variant('some', "password"),
         *         privateKey: variant('none', null),
         *     });
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     const data = $.let(Transfer.SFTP.get(conn, path));
         *     $(Transfer.SFTP.close(conn));
         *     $.return(data);
         * });
         *
         * const compiled = East.compileAsync(downloadFile.toIR(), Transfer.SFTP.Implementation);
         * await compiled("/downloads/file.txt");  // Uint8Array
         * ```
         */
        get: sftp_get,

        /**
         * Lists files in an SFTP directory.
         *
         * Retrieves metadata for all files and directories in the specified path.
         *
         * @example
         * ```ts
         * const listFiles = East.function([StringType], ArrayType(FileInfoType), ($, path) => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: variant('some', "password"),
         *         privateKey: variant('none', null),
         *     });
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     const files = $.let(Transfer.SFTP.list(conn, path));
         *     $(Transfer.SFTP.close(conn));
         *     $.return(files);
         * });
         *
         * const compiled = East.compileAsync(listFiles.toIR(), Transfer.SFTP.Implementation);
         * await compiled("/uploads");  // [{name: "file.txt", size: 1024n, ...}, ...]
         * ```
         */
        list: sftp_list,

        /**
         * Deletes a file from an SFTP server.
         *
         * Removes a file from the SFTP server at the specified remote path.
         *
         * @example
         * ```ts
         * const deleteFile = East.function([StringType], NullType, ($, path) => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: variant('some', "password"),
         *         privateKey: variant('none', null),
         *     });
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     $(Transfer.SFTP.delete(conn, path));
         *     $(Transfer.SFTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(deleteFile.toIR(), Transfer.SFTP.Implementation);
         * await compiled("/uploads/old-file.txt");
         * ```
         */
        delete: sftp_delete,

        /**
         * Closes the SFTP connection.
         *
         * Closes the connection and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         host: "sftp.example.com",
         *         port: 22n,
         *         username: "user",
         *         password: variant('some', "password"),
         *         privateKey: variant('none', null),
         *     });
         *     const conn = $.let(Transfer.SFTP.connect(config));
         *     // ... do work ...
         *     $(Transfer.SFTP.close(conn));
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), Transfer.SFTP.Implementation);
         * await compiled();
         * ```
         */
        close: sftp_close,

        /**
         * Node.js implementation of SFTP platform functions.
         *
         * Pass this to East.compileAsync() to enable SFTP operations.
         */
        Implementation: SftpImpl,

        /**
         * Type definitions for SFTP operations.
         */
        Types: {
            /**
             * SFTP connection configuration type.
             */
            Config: SftpConfigType,

            /**
             * File information metadata type.
             */
            FileInfo: FileInfoType,
        },
    },
} as const;
