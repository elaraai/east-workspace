/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, ArrayType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
// Pure path-string ops use POSIX (forward-slash) semantics on every OS, so an
// East program produces identical paths on all platforms (matching east-c and
// east-py). `resolve` stays host-native — it resolves against the real working
// directory, so its result is inherently OS-specific.
import { resolve } from "node:path";
import { join, dirname, basename, extname } from "node:path/posix";

/**
 * Joins path segments into a single path.
 *
 * Combines an array of path segments with a forward-slash (`/`) separator on every platform.
 * Normalizes the resulting path by resolving `.` and `..` segments. Empty segments
 * are ignored.
 *
 * This is a platform function for the East language, enabling path joining
 * in East programs running on Node.js.
 *
 * @param segments - Array of path segments to join (e.g., ["dir", "subdir", "file.txt"])
 * @returns The joined path, using forward slashes (`/`) on every platform
 *
 * @example
 * ```ts
 * const buildPath = East.function([], StringType, $ => {
 *     const segments = East.value(["home", "user", "documents", "file.txt"]);
 *     return Path.join(segments);
 *     // Returns: "home/user/documents/file.txt" on every platform
 * });
 * ```
 */
export const path_join = East.platform("path_join", [ArrayType(StringType)], StringType);

/**
 * Resolves a path to an absolute path.
 *
 * Converts a relative path to an absolute path by resolving it against the current
 * working directory. If the path is already absolute, it is normalized and returned.
 * Resolves `.` and `..` segments to their actual locations.
 *
 * This is a platform function for the East language, enabling path resolution
 * in East programs running on Node.js.
 *
 * @param path - The path to resolve (relative or absolute)
 * @returns The absolute path
 *
 * @example
 * ```ts
 * const getAbsolutePath = East.function([], StringType, $ => {
 *     return Path.resolve("../documents/file.txt");
 *     // Returns: "/home/user/documents/file.txt" (example)
 * });
 * ```
 */
export const path_resolve = East.platform("path_resolve", [StringType], StringType);

/**
 * Gets the directory name from a path.
 *
 * Extracts the directory portion of a path by removing the last segment (file name).
 * Similar to the Unix `dirname` command. Trailing path separators are ignored.
 *
 * This is a platform function for the East language, enabling directory extraction
 * in East programs running on Node.js.
 *
 * @param path - The file path to extract directory from
 * @returns The directory portion of the path
 *
 * @example
 * ```ts
 * const getDir = East.function([], StringType, $ => {
 *     return Path.dirname("/home/user/documents/file.txt");
 *     // Returns: "/home/user/documents"
 * });
 * ```
 */
export const path_dirname = East.platform("path_dirname", [StringType], StringType);

/**
 * Gets the base name (file name) from a path.
 *
 * Extracts the last segment of a path, typically the file name. Similar to the Unix
 * `basename` command. Trailing path separators are ignored.
 *
 * This is a platform function for the East language, enabling filename extraction
 * in East programs running on Node.js.
 *
 * @param path - The file path to extract filename from
 * @returns The file name portion of the path (including extension)
 *
 * @example
 * ```ts
 * const getFilename = East.function([], StringType, $ => {
 *     return Path.basename("/home/user/documents/file.txt");
 *     // Returns: "file.txt"
 * });
 * ```
 */
export const path_basename = East.platform("path_basename", [StringType], StringType);

/**
 * Gets the file extension from a path.
 *
 * Extracts the file extension from a path, including the leading dot. If the path
 * has no extension or ends with a dot, returns an empty string. Only returns the
 * last extension if multiple dots are present.
 *
 * This is a platform function for the East language, enabling extension extraction
 * in East programs running on Node.js.
 *
 * @param path - The file path to extract extension from
 * @returns The file extension including the dot (e.g., ".txt"), or empty string if none
 *
 * @example
 * ```ts
 * const getExtension = East.function([], StringType, $ => {
 *     return Path.extname("/home/user/documents/file.txt");
 *     // Returns: ".txt"
 * });
 * ```
 */
export const path_extname = East.platform("path_extname", [StringType], StringType);

/**
 * Node.js implementation of path platform functions.
 *
 * Pass this array to {@link East.compile} to enable path operations.
 */
const PathImpl: PlatformFunction[] = [
    path_join.implement((segments: string[]) => {
        try {
            return join(...segments);
        } catch (err: any) {
            throw new EastError(`Failed to join path segments: ${err.message}`, {
                location: [{ filename: "path_join", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    path_resolve.implement((path: string) => {
        try {
            return resolve(path);
        } catch (err: any) {
            throw new EastError(`Failed to resolve path: ${err.message}`, {
                location: [{ filename: "path_resolve", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    path_dirname.implement((path: string) => {
        try {
            return dirname(path);
        } catch (err: any) {
            throw new EastError(`Failed to get dirname: ${err.message}`, {
                location: [{ filename: "path_dirname", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    path_basename.implement((path: string) => {
        try {
            return basename(path);
        } catch (err: any) {
            throw new EastError(`Failed to get basename: ${err.message}`, {
                location: [{ filename: "path_basename", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    path_extname.implement((path: string) => {
        try {
            return extname(path);
        } catch (err: any) {
            throw new EastError(`Failed to get extname: ${err.message}`, {
                location: [{ filename: "path_extname", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped path manipulation platform functions.
 *
 * Provides path utilities for East programs.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Path } from "@elaraai/east-node-std";
 *
 * const buildPath = East.function([], StringType, $ => {
 *     const segments = East.value(["dir", "subdir", "file.txt"]);
 *     const fullPath = $.let(Path.join(segments));
 *     const ext = $.let(Path.extname(fullPath));
 *     return fullPath;
 * });
 *
 * const compiled = East.compile(buildPath.toIR(), Path.Implementation);
 * await compiled();  // Returns: "dir/subdir/file.txt"
 * ```
 */
export const Path = {
    /**
     * Joins path segments into a single path.
     *
     * Combines an array of path segments with a forward-slash (`/`) separator on every platform.
     * Normalizes the resulting path and ignores empty segments.
     *
     * @param segments - Array of path segments to join
     * @returns The joined path, using forward slashes (`/`) on every platform
     *
     * @example
     * ```ts
     * const buildPath = East.function([], StringType, $ => {
     *     const segments = East.value(["home", "user", "file.txt"]);
     *     return Path.join(segments);
     * });
     * ```
     */
    join: path_join,

    /**
     * Resolves a path to an absolute path.
     *
     * Converts a relative path to an absolute path by resolving it against the
     * current working directory. Normalizes the path and resolves `.` and `..` segments.
     *
     * @param path - The path to resolve (relative or absolute)
     * @returns The absolute path
     *
     * @example
     * ```ts
     * const getAbsolutePath = East.function([], StringType, $ => {
     *     return Path.resolve("../documents/file.txt");
     * });
     * ```
     */
    resolve: path_resolve,

    /**
     * Gets the directory name from a path.
     *
     * Extracts the directory portion of a path by removing the last segment (file name).
     * Trailing path separators are ignored.
     *
     * @param path - The file path to extract directory from
     * @returns The directory portion of the path
     *
     * @example
     * ```ts
     * const getDir = East.function([], StringType, $ => {
     *     return Path.dirname("/home/user/documents/file.txt");
     * });
     * ```
     */
    dirname: path_dirname,

    /**
     * Gets the base name (file name) from a path.
     *
     * Extracts the last segment of a path, typically the file name.
     * Trailing path separators are ignored.
     *
     * @param path - The file path to extract filename from
     * @returns The file name portion of the path (including extension)
     *
     * @example
     * ```ts
     * const getFilename = East.function([], StringType, $ => {
     *     return Path.basename("/home/user/documents/file.txt");
     * });
     * ```
     */
    basename: path_basename,

    /**
     * Gets the file extension from a path.
     *
     * Extracts the file extension from a path, including the leading dot.
     * Returns empty string if no extension exists.
     *
     * @param path - The file path to extract extension from
     * @returns The file extension including the dot (e.g., ".txt"), or empty string
     *
     * @example
     * ```ts
     * const getExtension = East.function([], StringType, $ => {
     *     return Path.extname("file.txt");
     * });
     *
     * const compiled = East.compile(getExtension.toIR(), Path.Implementation);
     * await compiled();  // Returns: ".txt"
     * ```
     */
    extname: path_extname,

    /**
     * Node.js implementation of path platform functions.
     *
     * Pass this to {@link East.compile} to enable path operations.
     */
    Implementation: PathImpl,
} as const;

// Export for backwards compatibility
export { PathImpl };
