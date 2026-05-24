/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared transfer protocol type definitions for East Node IO.
 *
 * Provides East type definitions for FTP and SFTP file transfer operations
 * including configurations and file metadata.
 *
 * @packageDocumentation
 */

import {
    StructType,
    OptionType,
    StringType,
    IntegerType,
    BooleanType,
} from "@elaraai/east";

// Re-export StringType for use in other transfer modules
export { StringType } from "@elaraai/east";

/**
 * FTP connection configuration.
 *
 * Configures connection to an FTP or FTPS (FTP over SSL/TLS) server.
 */
export const FtpConfigType = StructType({
    /**
     * FTP server hostname or IP address.
     */
    host: StringType,

    /**
     * FTP server port (typically 21 for FTP, 990 for FTPS).
     */
    port: IntegerType,

    /**
     * Username for authentication.
     */
    user: StringType,

    /**
     * Password for authentication.
     */
    password: StringType,

    /**
     * Use secure FTP (FTPS - FTP over SSL/TLS).
     */
    secure: BooleanType,
});

/**
 * SFTP connection configuration.
 *
 * Configures connection to an SFTP (SSH File Transfer Protocol) server.
 */
export const SftpConfigType = StructType({
    /**
     * SFTP server hostname or IP address.
     */
    host: StringType,

    /**
     * SFTP server port (typically 22).
     */
    port: IntegerType,

    /**
     * Username for authentication.
     */
    username: StringType,

    /**
     * Password for authentication.
     * Optional if using private key authentication.
     */
    password: OptionType(StringType),

    /**
     * SSH private key for authentication.
     * Optional if using password authentication.
     */
    privateKey: OptionType(StringType),
});

/**
 * File information metadata.
 *
 * Represents metadata about a file or directory on an FTP/SFTP server.
 */
export const FileInfoType = StructType({
    /**
     * File or directory name.
     */
    name: StringType,

    /**
     * Full path to the file or directory.
     */
    path: StringType,

    /**
     * File size in bytes (0 for directories).
     */
    size: IntegerType,

    /**
     * Whether this is a directory (true) or file (false).
     */
    isDirectory: BooleanType,

    /**
     * Last modified timestamp (ISO 8601 format).
     */
    modifiedTime: StringType,
});

/**
 * Opaque connection handle type.
 *
 * Represents an active FTP or SFTP connection.
 * Handles are created by connect() functions and used in transfer operations.
 *
 * @internal
 */
const ConnectionHandleType = StringType;

// Export for internal use within transfer module only
export { ConnectionHandleType };
