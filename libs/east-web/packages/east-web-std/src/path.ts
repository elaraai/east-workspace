/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, ArrayType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

// Path strings use POSIX (forward-slash) semantics, as east-node-std's pure
// path ops do on every OS (`node:path/posix`). A browser has no `node:path`,
// so the functions below port Node.js's POSIX path functions (lib/path.js,
// MIT — see THIRD_PARTY_NOTICES.md); test/path.spec.ts holds them to
// `node:path/posix` over a generated corpus of paths.

/** `/` */
const SLASH = 47;
/** `.` */
const DOT = 46;

/**
 * The working directory {@link path_resolve} resolves against. A browser has
 * none, so a relative path resolves against the root.
 */
const WORKING_DIRECTORY = "/";

/**
 * Resolves the `.` and `..` segments of a path and drops empty ones. Node's
 * `normalizeString` for the POSIX separator.
 *
 * @param path - The path, without the root that makes it absolute
 * @param allowAboveRoot - Whether `..` segments that climb past the start stay
 */
function normalizeString(path: string, allowAboveRoot: boolean): string {
    let res = "";
    let lastSegmentLength = 0;
    let lastSlash = -1;
    let dots = 0;
    let code = 0;
    for (let i = 0; i <= path.length; ++i) {
        if (i < path.length) {
            code = path.charCodeAt(i);
        } else if (code === SLASH) {
            break;
        } else {
            code = SLASH;
        }

        if (code === SLASH) {
            if (lastSlash === i - 1 || dots === 1) {
                // NOOP
            } else if (dots === 2) {
                if (res.length < 2 || lastSegmentLength !== 2 ||
                    res.charCodeAt(res.length - 1) !== DOT ||
                    res.charCodeAt(res.length - 2) !== DOT) {
                    if (res.length > 2) {
                        const lastSlashIndex = res.lastIndexOf("/");
                        if (lastSlashIndex === -1) {
                            res = "";
                            lastSegmentLength = 0;
                        } else {
                            res = res.slice(0, lastSlashIndex);
                            lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (res.length !== 0) {
                        res = "";
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    res += res.length > 0 ? "/.." : "..";
                    lastSegmentLength = 2;
                }
            } else {
                if (res.length > 0) {
                    res += `/${path.slice(lastSlash + 1, i)}`;
                } else {
                    res = path.slice(lastSlash + 1, i);
                }
                lastSegmentLength = i - lastSlash - 1;
            }
            lastSlash = i;
            dots = 0;
        } else if (code === DOT && dots !== -1) {
            ++dots;
        } else {
            dots = -1;
        }
    }
    return res;
}

/** Node's `path.posix.normalize`. */
function normalize(path: string): string {
    if (path.length === 0) {
        return ".";
    }

    const isAbsolute = path.charCodeAt(0) === SLASH;
    const trailingSeparator = path.charCodeAt(path.length - 1) === SLASH;

    // Normalize the path
    let normalized = normalizeString(path, !isAbsolute);

    if (normalized.length === 0) {
        if (isAbsolute) {
            return "/";
        }
        return trailingSeparator ? "./" : ".";
    }
    if (trailingSeparator) {
        normalized += "/";
    }

    return isAbsolute ? `/${normalized}` : normalized;
}

/** Node's `path.posix.join`. */
function join(segments: readonly string[]): string {
    if (segments.length === 0) {
        return ".";
    }
    let joined: string | undefined;
    for (const segment of segments) {
        if (segment.length > 0) {
            joined = joined === undefined ? segment : `${joined}/${segment}`;
        }
    }
    if (joined === undefined) {
        return ".";
    }
    return normalize(joined);
}

/**
 * Node's `path.posix.resolve(path)`, with {@link WORKING_DIRECTORY} where
 * Node reads `process.cwd()`.
 */
function resolve(path: string): string {
    let resolvedPath = "";
    let resolvedAbsolute = false;

    // The path, then the working directory, until one of them is absolute
    for (const segment of [path, WORKING_DIRECTORY]) {
        if (resolvedAbsolute) {
            break;
        }
        // Skip empty entries
        if (segment.length === 0) {
            continue;
        }
        resolvedPath = `${segment}/${resolvedPath}`;
        resolvedAbsolute = segment.charCodeAt(0) === SLASH;
    }

    // Normalize the path
    resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute);

    if (resolvedAbsolute) {
        return `/${resolvedPath}`;
    }
    return resolvedPath.length > 0 ? resolvedPath : ".";
}

/** Node's `path.posix.dirname`. */
function dirname(path: string): string {
    if (path.length === 0) {
        return ".";
    }
    const hasRoot = path.charCodeAt(0) === SLASH;
    let end = -1;
    let matchedSlash = true;
    for (let i = path.length - 1; i >= 1; --i) {
        if (path.charCodeAt(i) === SLASH) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            // We saw the first non-path separator
            matchedSlash = false;
        }
    }

    if (end === -1) {
        return hasRoot ? "/" : ".";
    }
    if (hasRoot && end === 1) {
        return "//";
    }
    return path.slice(0, end);
}

/** Node's `path.posix.basename`, without a suffix to strip. */
function basename(path: string): string {
    let start = 0;
    let end = -1;
    let matchedSlash = true;

    for (let i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                start = i + 1;
                break;
            }
        } else if (end === -1) {
            // We saw the first non-path separator, mark this as the end of our
            // path component
            matchedSlash = false;
            end = i + 1;
        }
    }

    if (end === -1) {
        return "";
    }
    return path.slice(start, end);
}

/** Node's `path.posix.extname`. */
function extname(path: string): string {
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;
    for (let i = path.length - 1; i >= 0; --i) {
        const code = path.charCodeAt(i);
        if (code === SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if (code === DOT) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot === -1) {
                startDot = i;
            } else if (preDotState !== 1) {
                preDotState = 1;
            }
        } else if (startDot !== -1) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = -1;
        }
    }

    if (startDot === -1 ||
        end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 &&
            startDot === end - 1 &&
            startDot === startPart + 1)) {
        return "";
    }
    return path.slice(startDot, end);
}

/**
 * Joins path segments into a single path.
 *
 * Combines an array of path segments with a forward-slash (`/`) separator on every platform.
 * Normalizes the resulting path by resolving `.` and `..` segments. Empty segments
 * are ignored.
 *
 * This is a platform function for the East language, enabling path joining
 * in East programs running in a browser.
 *
 * @param segments - Array of path segments to join (e.g., ["dir", "subdir", "file.txt"])
 * @returns The joined path, using forward slashes (`/`) on every platform
 *
 * @example
 * ```ts
 * const buildPath = East.function([], StringType, $ => {
 *     const segments = $.let(["home", "user", "documents", "file.txt"], ArrayType(StringType));
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
 * in East programs running in a browser. A browser has no working directory,
 * so a relative path resolves against the root, `/`.
 *
 * @param path - The path to resolve (relative or absolute)
 * @returns The absolute path
 *
 * @example
 * ```ts
 * const getAbsolutePath = East.function([], StringType, $ => {
 *     return Path.resolve("documents/../file.txt");
 *     // Returns: "/file.txt"
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
 * in East programs running in a browser.
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
 * in East programs running in a browser.
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
 * in East programs running in a browser.
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
 * Browser implementation of path platform functions.
 *
 * Pass this array to {@link East.compile} to enable path operations.
 */
const PathImpl: PlatformFunction[] = [
    path_join.implement((segments: string[]) => {
        try {
            return join(segments);
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
 * import { East, StringType, ArrayType } from "@elaraai/east";
 * import { Path } from "@elaraai/east-web-std";
 *
 * const buildPath = East.function([], StringType, $ => {
 *     const segments = $.let(["dir", "subdir", "file.txt"], ArrayType(StringType));
 *     const fullPath = $.let(Path.join(segments));
 *     const ext = $.let(Path.extname(fullPath));
 *     return fullPath;
 * });
 *
 * const compiled = East.compile(buildPath, Path.Implementation);
 * compiled();  // Returns: "dir/subdir/file.txt"
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
     *     const segments = $.let(["home", "user", "file.txt"], ArrayType(StringType));
     *     return Path.join(segments);
     * });
     * ```
     */
    join: path_join,

    /**
     * Resolves a path to an absolute path.
     *
     * Converts a relative path to an absolute path by resolving it against the
     * working directory, which in a browser is the root, `/`. Normalizes the
     * path and resolves `.` and `..` segments.
     *
     * @param path - The path to resolve (relative or absolute)
     * @returns The absolute path
     *
     * @example
     * ```ts
     * const getAbsolutePath = East.function([], StringType, $ => {
     *     return Path.resolve("documents/../file.txt");  // "/file.txt"
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
     * const compiled = East.compile(getExtension, Path.Implementation);
     * compiled();  // Returns: ".txt"
     * ```
     */
    extname: path_extname,

    /**
     * Browser implementation of path platform functions.
     *
     * Pass this to {@link East.compile} to enable path operations.
     */
    Implementation: PathImpl,
} as const;

// Exported beside `Path.Implementation`, as east-node-std exports it
export { PathImpl };
