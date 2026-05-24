/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SFTP platform functions for East Node IO.
 *
 * Provides SFTP (SSH File Transfer Protocol) operations for East programs,
 * including upload, download, list, and delete operations.
 *
 * @packageDocumentation
 */

import { East, BlobType, ArrayType, NullType } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import SftpClient from "ssh2-sftp-client";
import type { FileInfo as SftpFileInfo } from "ssh2-sftp-client";
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import { SftpConfigType, ConnectionHandleType, StringType, FileInfoType } from "./types.js";

/**
 * Connects to an SFTP server.
 *
 * Creates a connection to an SFTP server and returns an opaque handle
 * for use in file transfer operations.
 *
 * This is a platform function for the East language, enabling SFTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param config - SFTP connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails due to:
 * - Invalid hostname or port (location: "sftp_connect")
 * - Authentication failure (location: "sftp_connect")
 * - Network errors (location: "sftp_connect")
 * - SSH key errors (location: "sftp_connect")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const uploadToSftp = East.function([StringType, BlobType], NullType, ($, filename, data) => {
 *     const config = $.let({
 *         host: "sftp.example.com",
 *         port: 22n,
 *         username: "user",
 *         password: East.some("password"),
 *         privateKey: East.none(),
 *     });
 *
 *     const conn = $.let(Transfer.SFTP.connect(config));
 *     $(Transfer.SFTP.put(conn, filename, data));
 *     $(Transfer.SFTP.close(conn));
 * });
 *
 * const compiled = East.compileAsync(uploadToSftp.toIR(), Transfer.SFTP.Implementation);
 * await compiled("file.txt", fileData);
 * ```
 *
 * @remarks
 * - Supports password and private key authentication
 * - Connection is maintained until explicitly closed
 * - All operations are asynchronous (use East.compileAsync)
 */
export const sftp_connect = East.asyncPlatform("sftp_connect", [SftpConfigType], ConnectionHandleType);

/**
 * Uploads a file to an SFTP server.
 *
 * Uploads binary data to the SFTP server at the specified remote path.
 * Overwrites existing files with the same path.
 *
 * This is a platform function for the East language, enabling SFTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from sftp_connect()
 * @param remotePath - Remote file path on the SFTP server
 * @param data - Binary data to upload
 * @returns Null on success
 *
 * @throws {EastError} When upload fails due to:
 * - Invalid connection handle (location: "sftp_put")
 * - Permission denied (location: "sftp_put")
 * - Invalid remote path (location: "sftp_put")
 * - Network errors (location: "sftp_put")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType, NullType, variant } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const uploadFile = East.function([StringType, BlobType], NullType, ($, filename, data) => {
 *     const config = $.let({
 *         host: "sftp.example.com",
 *         port: 22n,
 *         username: "user",
 *         password: variant('some', "password"),
 *         privateKey: variant('none', null),
 *     });
 *     const conn = $.let(Transfer.SFTP.connect(config));
 *     $(Transfer.SFTP.put(conn, `/uploads/${filename}`, data));
 *     $(Transfer.SFTP.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(uploadFile.toIR(), Transfer.SFTP.Implementation);
 * await compiled("file.txt", fileData);
 * ```
 *
 * @remarks
 * - Creates parent directories if they don't exist
 * - Overwrites existing files
 * - Binary mode transfer
 */
export const sftp_put = East.asyncPlatform("sftp_put", [ConnectionHandleType, StringType, BlobType], NullType);

/**
 * Downloads a file from an SFTP server.
 *
 * Retrieves binary data from the SFTP server at the specified remote path.
 * Returns the file data as a Blob (Uint8Array).
 *
 * This is a platform function for the East language, enabling SFTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from sftp_connect()
 * @param remotePath - Remote file path on the SFTP server
 * @returns Binary data as Blob
 *
 * @throws {EastError} When download fails due to:
 * - Invalid connection handle (location: "sftp_get")
 * - File not found (location: "sftp_get")
 * - Permission denied (location: "sftp_get")
 * - Network errors (location: "sftp_get")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType, variant } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const downloadFile = East.function([StringType], BlobType, ($, filename) => {
 *     const config = $.let({
 *         host: "sftp.example.com",
 *         port: 22n,
 *         username: "user",
 *         password: variant('some', "password"),
 *         privateKey: variant('none', null),
 *     });
 *     const conn = $.let(Transfer.SFTP.connect(config));
 *     const data = $.let(Transfer.SFTP.get(conn, `/downloads/${filename}`));
 *     $(Transfer.SFTP.close(conn));
 *     return $.return(data);
 * });
 *
 * const compiled = East.compileAsync(downloadFile.toIR(), Transfer.SFTP.Implementation);
 * const fileData = await compiled("file.txt");  // Returns Uint8Array
 * ```
 *
 * @remarks
 * - Binary mode transfer
 * - Entire file is loaded into memory
 */
export const sftp_get = East.asyncPlatform("sftp_get", [ConnectionHandleType, StringType], BlobType);

/**
 * Lists files in an SFTP directory.
 *
 * Retrieves a list of files and directories at the specified remote path.
 * Returns metadata for each file including name, size, and modification time.
 *
 * This is a platform function for the East language, enabling SFTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from sftp_connect()
 * @param remotePath - Remote directory path on the SFTP server
 * @returns Array of file information metadata
 *
 * @throws {EastError} When listing fails due to:
 * - Invalid connection handle (location: "sftp_list")
 * - Directory not found (location: "sftp_list")
 * - Permission denied (location: "sftp_list")
 * - Network errors (location: "sftp_list")
 *
 * @example
 * ```ts
 * import { East, StringType, ArrayType, variant } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const listFiles = East.function([StringType], ArrayType(Transfer.SFTP.Types.FileInfo), ($, remotePath) => {
 *     const config = $.let({
 *         host: "sftp.example.com",
 *         port: 22n,
 *         username: "user",
 *         password: variant('some', "password"),
 *         privateKey: variant('none', null),
 *     });
 *     const conn = $.let(Transfer.SFTP.connect(config));
 *     const files = $.let(Transfer.SFTP.list(conn, remotePath));
 *     $(Transfer.SFTP.close(conn));
 *     return $.return(files);
 * });
 *
 * const compiled = East.compileAsync(listFiles.toIR(), Transfer.SFTP.Implementation);
 * const uploads = await compiled("/uploads");  // [{name: "file.txt", size: 1024n, ...}, ...]
 * ```
 *
 * @remarks
 * - Returns both files and directories
 * - Use isDirectory field to distinguish between files and directories
 */
export const sftp_list = East.asyncPlatform("sftp_list", [ConnectionHandleType, StringType], ArrayType(FileInfoType));

/**
 * Deletes a file from an SFTP server.
 *
 * Removes a file from the SFTP server at the specified remote path.
 * Does not delete directories.
 *
 * This is a platform function for the East language, enabling SFTP file transfer
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from sftp_connect()
 * @param remotePath - Remote file path to delete
 * @returns Null on success
 *
 * @throws {EastError} When deletion fails due to:
 * - Invalid connection handle (location: "sftp_delete")
 * - File not found (location: "sftp_delete")
 * - Permission denied (location: "sftp_delete")
 * - Network errors (location: "sftp_delete")
 *
 * @example
 * ```ts
 * import { East, StringType, NullType, variant } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
 * const deleteFile = East.function([StringType], NullType, ($, filename) => {
 *     const config = $.let({
 *         host: "sftp.example.com",
 *         port: 22n,
 *         username: "user",
 *         password: variant('some', "password"),
 *         privateKey: variant('none', null),
 *     });
 *     const conn = $.let(Transfer.SFTP.connect(config));
 *     $(Transfer.SFTP.delete(conn, `/uploads/${filename}`));
 *     $(Transfer.SFTP.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(deleteFile.toIR(), Transfer.SFTP.Implementation);
 * await compiled("old-file.txt");
 * ```
 *
 * @remarks
 * - Only deletes files, not directories
 * - Throws error if file doesn't exist
 */
export const sftp_delete = East.asyncPlatform("sftp_delete", [ConnectionHandleType, StringType], NullType);

/**
 * Closes an SFTP connection.
 *
 * Closes the SFTP connection and releases all resources.
 * The handle becomes invalid after this operation.
 *
 * @param handle - Connection handle from sftp_connect()
 * @returns Null on success
 *
 * @throws {EastError} When handle is invalid (location: "sftp_close")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { Transfer } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), Transfer.SFTP.Implementation);
 * await compiled();
 * ```
 */
export const sftp_close = East.asyncPlatform("sftp_close", [ConnectionHandleType], NullType);

/**
 * Closes all SFTP connections.
 *
 * Closes all active SFTP connections and releases all resources.
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
 *     $(Transfer.SFTP.closeAll());
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanupAll.toIR(), Transfer.SFTP.Implementation);
 * await compiled();
 * ```
 *
 * @internal
 */
export const sftp_close_all = East.asyncPlatform("sftp_close_all", [], NullType);

/**
 * Node.js implementation of SFTP platform functions.
 *
 * Provides the runtime implementations for SFTP operations using ssh2-sftp-client.
 * Pass this to East.compileAsync() to enable SFTP functionality.
 */
export const SftpImpl: PlatformFunction[] = [
    sftp_connect.implement(async (config: ValueTypeOf<typeof SftpConfigType>): Promise<string> => {
        try {
            const client = new SftpClient();

            const connectConfig: any = {
                host: config.host,
                port: Number(config.port),
                username: config.username,
            };

            // Add password if provided
            if (config.password?.type === 'some') {
                connectConfig.password = config.password.value;
            }

            // Add private key if provided
            if (config.privateKey?.type === 'some') {
                connectConfig.privateKey = config.privateKey.value;
            }

            await client.connect(connectConfig);

            return createHandle(client, async () => {
                await client.end();
            });
        } catch (err: any) {
            throw new EastError(`SFTP connection failed: ${err.message}`, {
                location: [{ filename: "sftp_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_put.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>,
        data: ValueTypeOf<typeof BlobType>
    ): Promise<null> => {
        try {
            const client = getConnection<SftpClient>(handle);

            // Upload from buffer
            await client.put(Buffer.from(data), remotePath);
            return null;
        } catch (err: any) {
            throw new EastError(`SFTP upload failed: ${err.message}`, {
                location: [{ filename: "sftp_put", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_get.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<Uint8Array> => {
        try {
            const client = getConnection<SftpClient>(handle);

            // Download to buffer
            const buffer = await client.get(remotePath);

            if (Buffer.isBuffer(buffer)) {
                return new Uint8Array(buffer);
            } else {
                throw new Error('Expected buffer, got stream or other type');
            }
        } catch (err: any) {
            throw new EastError(`SFTP download failed: ${err.message}`, {
                location: [{ filename: "sftp_get", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_list.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<ValueTypeOf<ReturnType<typeof ArrayType<typeof FileInfoType>>>> => {
        try {
            const client = getConnection<SftpClient>(handle);

            const files: SftpFileInfo[] = await client.list(remotePath);

            // Convert to East FileInfoType format
            return files.map((file: SftpFileInfo) => ({
                name: file.name,
                path: remotePath + (remotePath.endsWith('/') ? '' : '/') + file.name,
                size: BigInt(file.size),
                isDirectory: file.type === 'd',
                modifiedTime: new Date(file.modifyTime).toISOString(),
            }));
        } catch (err: any) {
            throw new EastError(`SFTP list failed: ${err.message}`, {
                location: [{ filename: "sftp_list", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_delete.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        remotePath: ValueTypeOf<typeof StringType>
    ): Promise<null> => {
        try {
            const client = getConnection<SftpClient>(handle);
            await client.delete(remotePath);
            return null;
        } catch (err: any) {
            throw new EastError(`SFTP delete failed: ${err.message}`, {
                location: [{ filename: "sftp_delete", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const client = getConnection<SftpClient>(handle);
            await client.end();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`SFTP close failed: ${err.message}`, {
                location: [{ filename: "sftp_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    sftp_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
