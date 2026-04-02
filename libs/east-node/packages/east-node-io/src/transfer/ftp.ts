/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * FTP platform functions for East Node IO.
 *
 * Provides FTP and FTPS file transfer operations for East programs,
 * including upload, download, list, and delete operations.
 *
 * @packageDocumentation
 */

import { East, BlobType, ArrayType, NullType } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { Client as FtpClient, type FileInfo } from "basic-ftp";
import { Readable } from "node:stream";
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import { FtpConfigType, ConnectionHandleType, StringType, FileInfoType } from "./types.js";

/**
 * Connects to an FTP server.
 *
 * Creates a connection to an FTP or FTPS server and returns an opaque handle
 * for use in file transfer operations.
 *
 * This is a platform function for the East language, enabling FTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param config - FTP connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails due to:
 * - Invalid hostname or port (location: "ftp_connect")
 * - Authentication failure (location: "ftp_connect")
 * - Network errors (location: "ftp_connect")
 * - SSL/TLS errors for FTPS (location: "ftp_connect")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const uploadToFtp = East.function([StringType, BlobType], NullType, ($, filename, data) => {
 *     const config = $.let({
 *         host: "ftp.example.com",
 *         port: 21n,
 *         user: "username",
 *         password: "password",
 *         secure: false,
 *     });
 *
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     $(Transfer.FTP.put(conn, filename, data));
 *     $(Transfer.FTP.close(conn));
 * });
 *
 * const compiled = East.compileAsync(uploadToFtp.toIR(), Transfer.FTP.Implementation);
 * await compiled("file.txt", fileData);
 * ```
 *
 * @remarks
 * - Supports both FTP and FTPS (FTP over SSL/TLS)
 * - Connection is maintained until explicitly closed
 * - All operations are asynchronous (use East.compileAsync)
 */
export const ftp_connect = East.asyncPlatform("ftp_connect", [FtpConfigType], ConnectionHandleType);

/**
 * Uploads a file to an FTP server.
 *
 * Uploads binary data to the FTP server at the specified remote path.
 * Overwrites existing files with the same path.
 *
 * This is a platform function for the East language, enabling FTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from ftp_connect()
 * @param remotePath - Remote file path on the FTP server
 * @param data - Binary data to upload
 * @returns Null on success
 *
 * @throws {EastError} When upload fails due to:
 * - Invalid connection handle (location: "ftp_put")
 * - Permission denied (location: "ftp_put")
 * - Invalid remote path (location: "ftp_put")
 * - Network errors (location: "ftp_put")
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
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     $(Transfer.FTP.put(conn, `/uploads/${filename}`, data));
 *     $(Transfer.FTP.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.FTP.Implementation);
 * await compiled("file.txt", fileData);
 * ```
 *
 * @remarks
 * - Creates parent directories if they don't exist
 * - Overwrites existing files
 * - Binary mode transfer
 */
export const ftp_put = East.asyncPlatform("ftp_put", [ConnectionHandleType, StringType, BlobType], NullType);

/**
 * Downloads a file from an FTP server.
 *
 * Retrieves binary data from the FTP server at the specified remote path.
 * Returns the file data as a Blob (Uint8Array).
 *
 * This is a platform function for the East language, enabling FTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from ftp_connect()
 * @param remotePath - Remote file path on the FTP server
 * @returns Binary data as Blob
 *
 * @throws {EastError} When download fails due to:
 * - Invalid connection handle (location: "ftp_get")
 * - File not found (location: "ftp_get")
 * - Permission denied (location: "ftp_get")
 * - Network errors (location: "ftp_get")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const downloadFile = East.function([StringType], BlobType, ($, filename) => {
 *     const config = $.let({
 *         host: "ftp.example.com",
 *         port: 21n,
 *         user: "username",
 *         password: "password",
 *         secure: false,
 *     });
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     const data = $.let(Transfer.FTP.get(conn, `/downloads/${filename}`));
 *     $(Transfer.FTP.close(conn));
 *     return $.return(data);
 * });
 *
 * const compiled = East.compileAsync(downloadFile.toIR(), Transfer.FTP.Implementation);
 * const fileData = await compiled("file.txt");  // Returns Uint8Array
 * ```
 *
 * @remarks
 * - Binary mode transfer
 * - Entire file is loaded into memory
 */
export const ftp_get = East.asyncPlatform("ftp_get", [ConnectionHandleType, StringType], BlobType);

/**
 * Lists files in an FTP directory.
 *
 * Retrieves a list of files and directories at the specified remote path.
 * Returns metadata for each file including name, size, and modification time.
 *
 * This is a platform function for the East language, enabling FTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from ftp_connect()
 * @param remotePath - Remote directory path on the FTP server
 * @returns Array of file information metadata
 *
 * @throws {EastError} When listing fails due to:
 * - Invalid connection handle (location: "ftp_list")
 * - Directory not found (location: "ftp_list")
 * - Permission denied (location: "ftp_list")
 * - Network errors (location: "ftp_list")
 *
 * @example
 * ```ts
 * import { East, StringType, ArrayType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const listFiles = East.function([StringType], ArrayType(Transfer.FTP.Types.FileInfo), ($, remotePath) => {
 *     const config = $.let({
 *         host: "ftp.example.com",
 *         port: 21n,
 *         user: "username",
 *         password: "password",
 *         secure: false,
 *     });
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     const files = $.let(Transfer.FTP.list(conn, remotePath));
 *     $(Transfer.FTP.close(conn));
 *     return $.return(files);
 * });
 *
 * const compiled = East.compileAsync(listFiles.toIR(), Transfer.FTP.Implementation);
 * const uploads = await compiled("/uploads");  // [{name: "file.txt", size: 1024n, ...}, ...]
 * ```
 *
 * @remarks
 * - Returns both files and directories
 * - Use isDirectory field to distinguish between files and directories
 */
export const ftp_list = East.asyncPlatform("ftp_list", [ConnectionHandleType, StringType], ArrayType(FileInfoType));

/**
 * Deletes a file from an FTP server.
 *
 * Removes a file from the FTP server at the specified remote path.
 * Does not delete directories.
 *
 * This is a platform function for the East language, enabling FTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from ftp_connect()
 * @param remotePath - Remote file path to delete
 * @returns Null on success
 *
 * @throws {EastError} When deletion fails due to:
 * - Invalid connection handle (location: "ftp_delete")
 * - File not found (location: "ftp_delete")
 * - Permission denied (location: "ftp_delete")
 * - Network errors (location: "ftp_delete")
 *
 * @example
 * ```ts
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const deleteFile = East.function([StringType], NullType, ($, filename) => {
 *     const config = $.let({
 *         host: "ftp.example.com",
 *         port: 21n,
 *         user: "username",
 *         password: "password",
 *         secure: false,
 *     });
 *     const conn = $.let(Transfer.FTP.connect(config));
 *     $(Transfer.FTP.delete(conn, `/uploads/${filename}`));
 *     $(Transfer.FTP.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(deleteFile.toIR(), Transfer.FTP.Implementation);
 * await compiled("old-file.txt");
 * ```
 *
 * @remarks
 * - Only deletes files, not directories
 * - Throws error if file doesn't exist
 */
export const ftp_delete = East.asyncPlatform("ftp_delete", [ConnectionHandleType, StringType], NullType);

/**
 * Closes an FTP connection.
 *
 * Closes the FTP connection and releases all resources.
 * The handle becomes invalid after this operation.
 *
 * @param handle - Connection handle from ftp_connect()
 * @returns Null on success
 *
 * @throws {EastError} When handle is invalid (location: "ftp_close")
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), Transfer.FTP.Implementation);
 * await compiled();
 * ```
 */
export const ftp_close = East.platform("ftp_close", [ConnectionHandleType], NullType);

/**
 * Closes all FTP connections.
 *
 * Closes all active FTP connections and releases all resources.
 * Useful for test cleanup to ensure all connections are closed.
 *
 * @returns Null on success
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const cleanupAll = East.function([], NullType, $ => {
 *     // ... test code that may have left connections open ...
 *     $(Transfer.FTP.closeAll());
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanupAll.toIR(), Transfer.FTP.Implementation);
 * await compiled();
 * ```
 *
 * @internal
 */
export const ftp_close_all = East.asyncPlatform("ftp_close_all", [], NullType);

/**
 * Node.js implementation of FTP platform functions.
 *
 * Provides the runtime implementations for FTP operations using basic-ftp.
 * Pass this to East.compileAsync() to enable FTP functionality.
 */
export const FtpImpl: PlatformFunction[] = [
    ftp_connect.implement(async (config: ValueTypeOf<typeof FtpConfigType>): Promise<string> => {
        try {
            const client = new FtpClient();
            client.ftp.verbose = false;

            await client.access({
                host: config.host,
                port: Number(config.port),
                user: config.user,
                password: config.password,
                secure: config.secure ? "implicit" : false,
            });

            return createHandle(client, async () => {
                await Promise.resolve(client.close());
            });
        } catch (err: any) {
            throw new EastError(`FTP connection failed: ${err.message}`, {
                location: [{ filename: "ftp_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    ftp_put.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>,
        data: ValueTypeOf<typeof BlobType>
    ): Promise<null> => {
        try {
            const client = getConnection<FtpClient>(handle);

            // Convert Uint8Array to readable stream
            const stream = Readable.from(Buffer.from(data));

            await client.uploadFrom(stream, remotePath);
            return null;
        } catch (err: any) {
            throw new EastError(`FTP upload failed: ${err.message}`, {
                location: [{ filename: "ftp_put", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    ftp_get.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<Uint8Array> => {
        try {
            const client = getConnection<FtpClient>(handle);

            // Download to buffer
            const chunks: Buffer[] = [];
            const writable = new (await import('stream')).Writable({
                write(chunk: Buffer, _encoding, callback) {
                    chunks.push(chunk);
                    callback();
                }
            });

            await client.downloadTo(writable, remotePath);

            // Concatenate all chunks
            const buffer = Buffer.concat(chunks);
            return new Uint8Array(buffer);
        } catch (err: any) {
            throw new EastError(`FTP download failed: ${err.message}`, {
                location: [{ filename: "ftp_get", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    ftp_list.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<ValueTypeOf<ReturnType<typeof ArrayType>>> => {
        try {
            const client = getConnection<FtpClient>(handle);

            const files: FileInfo[] = await client.list(remotePath);

            // Convert to East FileInfoType format
            return files.map((file: FileInfo) => ({
                name: file.name,
                path: remotePath + (remotePath.endsWith('/') ? '' : '/') + file.name,
                size: BigInt(file.size),
                isDirectory: file.isDirectory,
                modifiedTime: file.modifiedAt?.toISOString() || new Date().toISOString(),
            }));
        } catch (err: any) {
            throw new EastError(`FTP list failed: ${err.message}`, {
                location: [{ filename: "ftp_list", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    ftp_delete.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<null> => {
        try {
            const client = getConnection<FtpClient>(handle);
            await client.remove(remotePath);
            return null;
        } catch (err: any) {
            throw new EastError(`FTP delete failed: ${err.message}`, {
                location: [{ filename: "ftp_delete", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    // note: this one doesn't produce a Promise
    ftp_close.implement((handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const client = getConnection<FtpClient>(handle);
            client.close();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`FTP close failed: ${err.message}`, {
                location: [{ filename: "ftp_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    ftp_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
