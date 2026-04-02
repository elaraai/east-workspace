/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, NullType, BooleanType, ArrayType, BlobType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import {
    readFileSync,
    writeFileSync,
    appendFileSync,
    unlinkSync,
    existsSync,
    statSync,
    mkdirSync,
    readdirSync,
} from "node:fs";

/**
 * Reads a file as a UTF-8 string.
 *
 * Reads the entire contents of a file synchronously and decodes it as UTF-8 text.
 * Paths are resolved relative to the current working directory.
 *
 * This is a platform function for the East language, enabling file reading
 * in East programs running on Node.js.
 *
 * @param path - The file path to read (relative or absolute)
 * @returns The file contents as a UTF-8 string
 *
 * @throws {EastError} When file cannot be read:
 * - File doesn't exist: `ENOENT: no such file or directory`
 * - No read permission: `EACCES: permission denied`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const readConfig = East.function([], StringType, $ => {
 *     const content = $.let(FileSystem.readFile("config.txt"));
 *     return content;
 * });
 * ```
 */
export const fs_read_file = East.platform("fs_read_file", [StringType], StringType);

/**
 * Writes a string to a file (overwrites existing content).
 *
 * Writes string content to a file synchronously, creating the file if it doesn't exist
 * and overwriting it if it does. Content is encoded as UTF-8.
 *
 * This is a platform function for the East language, enabling file writing
 * in East programs running on Node.js.
 *
 * @param path - The file path to write (relative or absolute)
 * @param content - The string content to write (UTF-8 encoded)
 * @returns Null
 *
 * @throws {EastError} When file cannot be written:
 * - No write permission: `EACCES: permission denied`
 * - Parent directory doesn't exist: `ENOENT: no such file or directory`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const saveOutput = East.function([], NullType, $ => {
 *     $(FileSystem.writeFile("output.txt", "Hello, World!"));
 * });
 * ```
 */
export const fs_write_file = East.platform("fs_write_file", [StringType, StringType], NullType);

/**
 * Appends a string to a file.
 *
 * Appends string content to the end of a file synchronously, creating the file
 * if it doesn't exist. Content is encoded as UTF-8.
 *
 * This is a platform function for the East language, enabling file appending
 * in East programs running on Node.js.
 *
 * @param path - The file path to append to (relative or absolute)
 * @param content - The string content to append (UTF-8 encoded)
 * @returns Null
 *
 * @throws {EastError} When file cannot be appended:
 * - No write permission: `EACCES: permission denied`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const appendLog = East.function([], NullType, $ => {
 *     $(FileSystem.appendFile("log.txt", "New log entry\n"));
 * });
 * ```
 */
export const fs_append_file = East.platform("fs_append_file", [StringType, StringType], NullType);

/**
 * Deletes a file from the file system.
 *
 * Removes a file synchronously. If the file doesn't exist, an error is thrown.
 * This operation cannot be undone.
 *
 * This is a platform function for the East language, enabling file deletion
 * in East programs running on Node.js.
 *
 * @param path - The file path to delete (relative or absolute)
 * @returns Null
 *
 * @throws {EastError} When file cannot be deleted:
 * - File doesn't exist: `ENOENT: no such file or directory`
 * - No delete permission: `EACCES: permission denied`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const cleanup = East.function([], NullType, $ => {
 *     $(FileSystem.deleteFile("temp.txt"));
 * });
 * ```
 */
export const fs_delete_file = East.platform("fs_delete_file", [StringType], NullType);

/**
 * Checks if a file or directory exists at the given path.
 *
 * Tests whether a path exists in the file system, returning true if it exists
 * (whether file or directory) and false otherwise. This check is synchronous
 * and does not throw errors for permission issues.
 *
 * This is a platform function for the East language, enabling path existence checks
 * in East programs running on Node.js.
 *
 * @param path - The path to check (relative or absolute)
 * @returns True if the path exists, false otherwise
 *
 * @example
 * ```ts
 * const checkConfig = East.function([], BooleanType, $ => {
 *     return FileSystem.exists("config.txt");
 * });
 * ```
 */
export const fs_exists = East.platform("fs_exists", [StringType], BooleanType);

/**
 * Checks if a path exists and is a regular file.
 *
 * Tests whether a path exists and is a regular file (not a directory, symlink, etc.).
 * Returns false if the path doesn't exist or is not a file. Does not throw errors
 * for permission issues.
 *
 * This is a platform function for the East language, enabling file type checks
 * in East programs running on Node.js.
 *
 * @param path - The path to check (relative or absolute)
 * @returns True if the path exists and is a file, false otherwise
 *
 * @example
 * ```ts
 * const checkIsFile = East.function([], BooleanType, $ => {
 *     return FileSystem.isFile("data.json");
 * });
 * ```
 */
export const fs_is_file = East.platform("fs_is_file", [StringType], BooleanType);

/**
 * Checks if a path exists and is a directory.
 *
 * Tests whether a path exists and is a directory (not a regular file).
 * Returns false if the path doesn't exist or is not a directory. Does not throw
 * errors for permission issues.
 *
 * This is a platform function for the East language, enabling directory type checks
 * in East programs running on Node.js.
 *
 * @param path - The path to check (relative or absolute)
 * @returns True if the path exists and is a directory, false otherwise
 *
 * @example
 * ```ts
 * const checkIsDir = East.function([], BooleanType, $ => {
 *     return FileSystem.isDirectory("src");
 * });
 * ```
 */
export const fs_is_directory = East.platform("fs_is_directory", [StringType], BooleanType);

/**
 * Creates a directory, including any necessary parent directories.
 *
 * Creates a directory synchronously with recursive creation enabled, meaning
 * all necessary parent directories will be created if they don't exist.
 * If the directory already exists, no error is thrown.
 *
 * This is a platform function for the East language, enabling directory creation
 * in East programs running on Node.js.
 *
 * @param path - The directory path to create (relative or absolute)
 * @returns Null
 *
 * @throws {EastError} When directory cannot be created:
 * - No write permission: `EACCES: permission denied`
 * - Path exists as a file: `EEXIST: file already exists`
 *
 * @example
 * ```ts
 * const setupDirs = East.function([], NullType, $ => {
 *     $(FileSystem.createDirectory("output/reports/2024"));
 * });
 * ```
 */
export const fs_create_directory = East.platform("fs_create_directory", [StringType], NullType);

/**
 * Lists the names of all files and directories within a directory.
 *
 * Reads the contents of a directory synchronously and returns an array of entry names
 * (not full paths). The entries include both files and subdirectories. Special entries
 * like "." and ".." are not included. The order is not guaranteed.
 *
 * This is a platform function for the East language, enabling directory listing
 * in East programs running on Node.js.
 *
 * @param path - The directory path to read (relative or absolute)
 * @returns Array of file and directory names within the directory
 *
 * @throws {EastError} When directory cannot be read:
 * - Directory doesn't exist: `ENOENT: no such file or directory`
 * - No read permission: `EACCES: permission denied`
 * - Path is not a directory: `ENOTDIR: not a directory`
 *
 * @example
 * ```ts
 * const listFiles = East.function([], ArrayType(StringType), $ => {
 *     return FileSystem.readDirectory("src");
 *     // Returns: ["index.ts", "utils", "types.ts"]
 * });
 * ```
 */
export const fs_read_directory = East.platform("fs_read_directory", [StringType], ArrayType(StringType));

/**
 * Reads a file as binary data without any encoding.
 *
 * Reads the entire contents of a file synchronously as raw bytes, returning
 * a Blob (Uint8Array) without any text decoding. Useful for reading non-text
 * files like images, PDFs, or binary data formats.
 *
 * This is a platform function for the East language, enabling binary file reading
 * in East programs running on Node.js.
 *
 * @param path - The file path to read (relative or absolute)
 * @returns The file contents as a Blob (binary data)
 *
 * @throws {EastError} When file cannot be read:
 * - File doesn't exist: `ENOENT: no such file or directory`
 * - No read permission: `EACCES: permission denied`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const loadImage = East.function([], BlobType, $ => {
 *     return FileSystem.readFileBytes("logo.png");
 * });
 * ```
 */
export const fs_read_file_bytes = East.platform("fs_read_file_bytes", [StringType], BlobType);

/**
 * Writes binary data to a file (overwrites existing content).
 *
 * Writes raw binary data to a file synchronously without any text encoding,
 * creating the file if it doesn't exist and overwriting it if it does.
 * Useful for writing non-text files like images, PDFs, or binary data formats.
 *
 * This is a platform function for the East language, enabling binary file writing
 * in East programs running on Node.js.
 *
 * @param path - The file path to write (relative or absolute)
 * @param content - The binary content to write (Blob/Uint8Array)
 * @returns Null
 *
 * @throws {EastError} When file cannot be written:
 * - No write permission: `EACCES: permission denied`
 * - Parent directory doesn't exist: `ENOENT: no such file or directory`
 * - Path is a directory: `EISDIR: illegal operation on a directory`
 *
 * @example
 * ```ts
 * const saveBinary = East.function([BlobType], NullType, ($, data) => {
 *     $(FileSystem.writeFileBytes("output.bin", data));
 * });
 * ```
 */
export const fs_write_file_bytes = East.platform("fs_write_file_bytes", [StringType, BlobType], NullType);

/**
 * Node.js implementation of file system platform functions.
 *
 * Pass this array to {@link East.compile} to enable file system operations.
 */
const FileSystemImpl: PlatformFunction[] = [
    fs_read_file.implement((path: string) => {
        try {
            return readFileSync(path, 'utf-8');
        } catch (err: any) {
            throw new EastError(`Failed to read file ${path}: ${err.message}`, {
                location: [{ filename: "fs_read_file", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_write_file.implement((path: string, content: string) => {
        try {
            writeFileSync(path, content, 'utf-8');
        } catch (err: any) {
            throw new EastError(`Failed to write file ${path}: ${err.message}`, {
                location: [{ filename: "fs_write_file", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_append_file.implement((path: string, content: string) => {
        try {
            appendFileSync(path, content, 'utf-8');
        } catch (err: any) {
            throw new EastError(`Failed to append to file ${path}: ${err.message}`, {
                location: [{ filename: "fs_append_file", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_delete_file.implement((path: string) => {
        try {
            unlinkSync(path);
        } catch (err: any) {
            throw new EastError(`Failed to delete file ${path}: ${err.message}`, {
                location: [{ filename: "fs_delete_file", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_exists.implement((path: string) => {
        return existsSync(path);
    }),
    fs_is_file.implement((path: string) => {
        try {
            return existsSync(path) && statSync(path).isFile();
        } catch {
            return false;
        }
    }),
    fs_is_directory.implement((path: string) => {
        try {
            return existsSync(path) && statSync(path).isDirectory();
        } catch {
            return false;
        }
    }),
    fs_create_directory.implement((path: string) => {
        try {
            mkdirSync(path, { recursive: true });
        } catch (err: any) {
            throw new EastError(`Failed to create directory ${path}: ${err.message}`, {
                location: [{ filename: "fs_create_directory", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_read_directory.implement((path: string) => {
        try {
            return readdirSync(path);
        } catch (err: any) {
            throw new EastError(`Failed to read directory ${path}: ${err.message}`, {
                location: [{ filename: "fs_read_directory", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_read_file_bytes.implement((path: string) => {
        try {
            const buffer = readFileSync(path);
            return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } catch (err: any) {
            throw new EastError(`Failed to read file bytes ${path}: ${err.message}`, {
                location: [{ filename: "fs_read_file_bytes", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fs_write_file_bytes.implement((path: string, content: Uint8Array) => {
        try {
            writeFileSync(path, content);
        } catch (err: any) {
            throw new EastError(`Failed to write file bytes ${path}: ${err.message}`, {
                location: [{ filename: "fs_write_file_bytes", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped file system platform functions.
 *
 * Provides file system operations for East programs.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { FileSystem } from "@elaraai/east-node-std";
 *
 * const processFile = East.function([], NullType, $ => {
 *     const content = $.let(FileSystem.readFile("input.txt"));
 *     $(FileSystem.writeFile("output.txt", content));
 * });
 *
 * const compiled = East.compile(processFile.toIR(), FileSystem.Implementation);
 * await compiled();
 * ```
 */
export const FileSystem = {
    /**
     * Reads a file as a UTF-8 string.
     *
     * Reads the entire contents of a file synchronously and decodes it as UTF-8 text.
     * Paths are resolved relative to the current working directory.
     *
     * @param path - The file path to read (relative or absolute)
     * @returns The file contents as a UTF-8 string
     * @throws {EastError} When file cannot be read (ENOENT, EACCES, EISDIR)
     *
     * @example
     * ```ts
     * const readConfig = East.function([], StringType, $ => {
     *     const content = $.let(FileSystem.readFile("config.txt"));
     *     return content;
     * });
     *
     * const compiled = East.compile(readConfig.toIR(), FileSystem.Implementation);
     * await compiled();  // Returns file content as string
     * ```
     */
    readFile: fs_read_file,

    /**
     * Writes a string to a file (overwrites existing content).
     *
     * Writes string content to a file synchronously, creating the file if it doesn't exist
     * and overwriting it if it does. Content is encoded as UTF-8.
     *
     * @param path - The file path to write (relative or absolute)
     * @param content - The string content to write (UTF-8 encoded)
     * @returns Null
     * @throws {EastError} When file cannot be written (EACCES, ENOENT, EISDIR)
     *
     * @example
     * ```ts
     * const saveOutput = East.function([], NullType, $ => {
     *     $(FileSystem.writeFile("output.txt", "Hello, World!"));
     * });
     *
     * const compiled = East.compile(saveOutput.toIR(), FileSystem.Implementation);
     * await compiled();  // File written successfully
     * ```
     */
    writeFile: fs_write_file,

    /**
     * Appends a string to a file.
     *
     * Appends string content to the end of a file synchronously, creating the file
     * if it doesn't exist. Content is encoded as UTF-8.
     *
     * @param path - The file path to append to (relative or absolute)
     * @param content - The string content to append (UTF-8 encoded)
     * @returns Null
     * @throws {EastError} When file cannot be appended (EACCES, EISDIR)
     *
     * @example
     * ```ts
     * const appendLog = East.function([], NullType, $ => {
     *     $(FileSystem.appendFile("log.txt", "New log entry\n"));
     * });
     * ```
     */
    appendFile: fs_append_file,

    /**
     * Deletes a file from the file system.
     *
     * Removes a file synchronously. If the file doesn't exist, an error is thrown.
     * This operation cannot be undone.
     *
     * @param path - The file path to delete (relative or absolute)
     * @returns Null
     * @throws {EastError} When file cannot be deleted (ENOENT, EACCES, EISDIR)
     *
     * @example
     * ```ts
     * const cleanup = East.function([], NullType, $ => {
     *     $(FileSystem.deleteFile("temp.txt"));
     * });
     * ```
     */
    deleteFile: fs_delete_file,

    /**
     * Checks if a file or directory exists at the given path.
     *
     * Tests whether a path exists in the file system, returning true if it exists
     * (whether file or directory) and false otherwise.
     *
     * @param path - The path to check (relative or absolute)
     * @returns True if the path exists, false otherwise
     *
     * @example
     * ```ts
     * const checkConfig = East.function([], BooleanType, $ => {
     *     return FileSystem.exists("config.txt");
     * });
     * ```
     */
    exists: fs_exists,

    /**
     * Checks if a path exists and is a regular file.
     *
     * Tests whether a path exists and is a regular file (not a directory, symlink, etc.).
     * Returns false if the path doesn't exist or is not a file.
     *
     * @param path - The path to check (relative or absolute)
     * @returns True if the path exists and is a file, false otherwise
     *
     * @example
     * ```ts
     * const checkIsFile = East.function([], BooleanType, $ => {
     *     return FileSystem.isFile("data.json");
     * });
     * ```
     */
    isFile: fs_is_file,

    /**
     * Checks if a path exists and is a directory.
     *
     * Tests whether a path exists and is a directory (not a regular file).
     * Returns false if the path doesn't exist or is not a directory.
     *
     * @param path - The path to check (relative or absolute)
     * @returns True if the path exists and is a directory, false otherwise
     *
     * @example
     * ```ts
     * const checkIsDir = East.function([], BooleanType, $ => {
     *     return FileSystem.isDirectory("src");
     * });
     * ```
     */
    isDirectory: fs_is_directory,

    /**
     * Creates a directory, including any necessary parent directories.
     *
     * Creates a directory synchronously with recursive creation enabled, meaning
     * all necessary parent directories will be created if they don't exist.
     *
     * @param path - The directory path to create (relative or absolute)
     * @returns Null
     * @throws {EastError} When directory cannot be created (EACCES, EEXIST)
     *
     * @example
     * ```ts
     * const setupDirs = East.function([], NullType, $ => {
     *     $(FileSystem.createDirectory("output/reports/2024"));
     * });
     * ```
     */
    createDirectory: fs_create_directory,

    /**
     * Lists the names of all files and directories within a directory.
     *
     * Reads the contents of a directory synchronously and returns an array of entry names
     * (not full paths). The entries include both files and subdirectories.
     *
     * @param path - The directory path to read (relative or absolute)
     * @returns Array of file and directory names within the directory
     * @throws {EastError} When directory cannot be read (ENOENT, EACCES, ENOTDIR)
     *
     * @example
     * ```ts
     * const listFiles = East.function([], ArrayType(StringType), $ => {
     *     return FileSystem.readDirectory("src");
     * });
     * ```
     */
    readDirectory: fs_read_directory,

    /**
     * Reads a file as binary data without any encoding.
     *
     * Reads the entire contents of a file synchronously as raw bytes, returning
     * a Blob (Uint8Array) without any text decoding.
     *
     * @param path - The file path to read (relative or absolute)
     * @returns The file contents as a Blob (binary data)
     * @throws {EastError} When file cannot be read (ENOENT, EACCES, EISDIR)
     *
     * @example
     * ```ts
     * const loadImage = East.function([], BlobType, $ => {
     *     return FileSystem.readFileBytes("logo.png");
     * });
     * ```
     */
    readFileBytes: fs_read_file_bytes,

    /**
     * Writes binary data to a file (overwrites existing content).
     *
     * Writes raw binary data to a file synchronously without any text encoding,
     * creating the file if it doesn't exist and overwriting it if it does.
     *
     * @param path - The file path to write (relative or absolute)
     * @param content - The binary content to write (Blob/Uint8Array)
     * @returns Null
     * @throws {EastError} When file cannot be written (EACCES, ENOENT, EISDIR)
     *
     * @example
     * ```ts
     * const saveBinary = East.function([BlobType], NullType, ($, data) => {
     *     $(FileSystem.writeFileBytes("output.bin", data));
     * });
     *
     * const compiled = East.compile(saveBinary.toIR(), FileSystem.Implementation);
     * const binaryData = new Uint8Array([1, 2, 3, 4]);
     * await compiled(binaryData);  // Binary data written to file
     * ```
     */
    writeFileBytes: fs_write_file_bytes,

    /**
     * Node.js implementation of file system platform functions.
     *
     * Pass this to {@link East.compile} to enable file system operations.
     */
    Implementation: FileSystemImpl,
} as const;

// Export for backwards compatibility
export { FileSystemImpl };
