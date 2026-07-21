/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @remarks
 */
export type Location = {
  /** The source file path */
  filename: string,
  /** The 1-based line number */
  line: bigint,
  /** The 1-based column number */
  column: bigint,
}

/**
 * Formats a single location as a human-readable string.
 *
 * @param location - The source location to format
 * @returns A string in the format `"<filename> <line>:<column>"`
 *
 * @example
 * ```ts
 * const loc = { filename: "main.ts", line: 42n, column: 15n };
 * printLocation(loc); // "main.ts 42:15"
 * ```
 */
export function printLocation(location: Location): string {
  return `${location.filename} ${location.line}:${location.column}`;
}

/**
 * Formats an array of locations as a stack trace string.
 *
 * @param locations - The source locations to format
 * @returns A stack trace string with each location on a new line
 *
 * @example
 * ```ts
 * const locs = [
 *   { filename: "main.ts", line: 42n, column: 15n },
 *   { filename: "lib.ts", line: 10n, column: 5n }
 * ];
 * printLocations(locs);
 * // "main.ts 42:15
 * //   at lib.ts 10:5"
 * ```
 */
export function printLocations(locations: Location[]): string {
  if (locations.length === 0) return '<unknown>';
  const [first, ...rest] = locations;
  const header = printLocation(first!);
  if (rest.length === 0) return header;
  return header + '\n' + rest.map(loc => `  at ${printLocation(loc)}`).join('\n');
}

/**
 * Determines if a stack frame should be included in location captures.
 * Filters out internal frames (Node.js internals, node_modules) to show
 * only user code in error stack traces.
 *
 * @param filename - The file path from the stack frame
 * @returns true if the frame should be included, false to filter it out
 */
/**
 * Directories holding East's own modules, given the URL of this module.
 *
 * Both the compiled and the original tree are returned, because `stack`
 * reports the compiled path normally and the original one under
 * `--enable-source-maps` — a frame is East's either way.
 *
 * @param moduleUrl - `import.meta.url` of this module, or undefined where the
 *   bundler does not provide one (a CJS or browser bundle, which has no East
 *   tree to point at)
 * @returns Directory prefixes to treat as East's own, empty when unknowable
 *
 * @remarks
 * Exported for testing. An empty result means frame filtering falls back to
 * the `node_modules` rule, which is the correct answer for a bundle: East's
 * code shares a file with its caller there, so no path can separate them.
 */
export function eastOwnDirs(moduleUrl: string | undefined): readonly string[] {
  if (moduleUrl === undefined || moduleUrl === '') return [];
  const path = normalizeSeparators(stripFileUrl(moduleUrl));
  const slash = path.lastIndexOf('/');
  if (slash === -1) return [];
  const dir = path.slice(0, slash);
  const root = dir.endsWith('/dist/src') ? dir.slice(0, -'/dist/src'.length)
    : dir.endsWith('/src') ? dir.slice(0, -'/src'.length)
      : null;
  return root === null ? [`${dir}/`] : [`${root}/src/`, `${root}/dist/src/`];
}

/** East's own module directories in this environment (see {@link eastOwnDirs}). */
const EAST_OWN_DIRS: readonly string[] = eastOwnDirs(import.meta.url as string | undefined);

function shouldIncludeFrame(filename: string): boolean {
  // Skip Node.js internal modules (e.g., node:internal/modules/...)
  if (filename.startsWith('node:')) return false;

  // Skip node_modules - filters out third-party packages including East
  // when installed as a dependency. Handles both Unix and Windows paths.
  if (filename.includes('/node_modules/') || filename.includes('\\node_modules\\')) return false;

  // Skip East's own modules however they were loaded. The node_modules rule
  // covers an installed East but not a linked or in-repo one, which would
  // otherwise head every trace with East internals instead of user code — and
  // bake East's own line numbers into serialized source maps. East's specs sit
  // in the same tree but are callers of the library, not part of it.
  const path = normalizeSeparators(stripFileUrl(filename));
  if (!/\.spec\.[cm]?[jt]s$/.test(path) && EAST_OWN_DIRS.some(dir => path.startsWith(dir))) return false;

  return true;
}

/**
 * Captures the call stack as an array of source locations, filtered to
 * show only user code.
 *
 * @returns An array of {@link Location} objects representing the call stack,
 *          from innermost (most recent) to outermost frame
 *
 * @remarks
 * This function uses JavaScript's Error stack traces to capture the call
 * stack. Internal frames (Node.js internals, node_modules packages) are
 * filtered out to provide clean stack traces showing only user code.
 * Returns an empty array if the stack trace cannot be parsed.
 *
 * @example
 * ```ts
 * function myFunction() {
 *   const stack = get_location(); // Gets call stack of user code
 *   console.log(printLocations(stack));
 * }
 * ```
 */


// ── Frame path normalization ───────────────────────────────────────────
//
// Stack-trace paths are absolute and environment-specific (and `file://` URLs
// under ESM). Baking them into serialized IR leaks the author's filesystem
// layout and makes the IR non-reproducible across machines and build modes. We
// normalize each frame path to a portable form: strip the `file://` scheme,
// normalize separators, and relativize to a base directory. The base defaults
// to the working directory when one is available (Node) and can be set with
// `setLocationBasePath` (e.g. for deterministic fixtures). Browser / no-cwd
// environments keep the cleaned path. This stays free of `node:` imports
// (browser-safe) and never throws.

let explicitBaseSet = false;
let explicitBase: string | undefined;
let autoBase: string | undefined;
let autoBaseComputed = false;

function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function stripFileUrl(p: string): string {
  if (!p.startsWith('file://')) return p;
  try {
    // `URL` is a universal (WHATWG) global — present in Node and browsers, no
    // `node:url` import. `.pathname` is percent-encoded; decode it.
    const pathname = decodeURIComponent(new URL(p).pathname);
    return pathname.replace(/^\/([A-Za-z]:)/, '$1'); // Windows: "/C:/x" → "C:/x"
  } catch {
    return p;
  }
}

function computeAutoBase(): string | undefined {
  if (!autoBaseComputed) {
    autoBaseComputed = true;
    // Guarded global access (not a `node:` import) — `process` is undefined in
    // the browser, where we simply skip relativization.
    const proc = (globalThis as { process?: { cwd?: () => string } }).process;
    if (proc !== undefined && typeof proc.cwd === 'function') {
      try {
        autoBase = stripTrailingSlash(normalizeSeparators(String(proc.cwd())));
      } catch {
        autoBase = undefined;
      }
    }
  }
  return autoBase;
}

function currentBase(): string | undefined {
  return explicitBaseSet ? explicitBase : computeAutoBase();
}

/**
 * Set the base directory that captured locations are relativized against.
 * Pass a path to relativize against it (paths outside it stay absolute); pass
 * `undefined` to reset to the automatic default (the working directory in
 * Node, none in the browser).
 */
export function setLocationBasePath(base: string | undefined): void {
  if (base === undefined) {
    explicitBaseSet = false;
    explicitBase = undefined;
  } else {
    explicitBaseSet = true;
    explicitBase = stripTrailingSlash(normalizeSeparators(stripFileUrl(base)));
  }
}

/**
 * Normalize a stack-frame path to a portable, deterministic form: `file://`
 * stripped, separators as `/`, and relativized to the current base when the
 * path is under it. Exported for testing. Never throws.
 */
export function normalizeFramePath(raw: string): string {
  try {
    const cleaned = normalizeSeparators(stripFileUrl(raw));
    const base = currentBase();
    if (base !== undefined && base !== '') {
      if (cleaned === base) return '.';
      if (cleaned.startsWith(base + '/')) return cleaned.slice(base.length + 1);
    }
    return cleaned;
  } catch {
    return raw;
  }
}

function capture_stack_frames(): Location[] {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return [];

  const lines = stack.split('\n').slice(1); // Skip "Error" line
  const frames: Location[] = [];

  for (const line of lines) {
    // Take the path before :line:col (allows spaces and a Windows drive colon).
    const match = line.match(/\((.+):(\d+):(\d+)\)\s*$/) ?? line.match(/\bat\s+(.+):(\d+):(\d+)\s*$/);
    if (match) {
      const [, filename, lineNum, column] = match;
      // `shouldIncludeFrame` runs on the raw path so its node_modules/internal
      // filters see absolute paths; the stored path is normalized.
      if (filename && filename !== '' && shouldIncludeFrame(filename)) {
        frames.push({ filename: normalizeFramePath(filename), line: BigInt(lineNum!), column: BigInt(column!) });
      }
    }
  }

  return frames;
}

export function get_location(): Location[] {
  return capture_stack_frames();
}

// ── SourceMap ──────────────────────────────────────────────────────────

/** Reserved sentinel: resolve(0n) returns [], the "no/unknown location" id. */
export const UNKNOWN_LOC_ID: bigint = 0n;

export class SourceMap {
  /** Location stacks, indexed by Number(loc_id). stacks[0] is always []. */
  private readonly stacks: Location[][] = [[]];
  /** Content key → loc_id for dedup during construction. */
  private readonly intern = new Map<string, bigint>();

  /** Intern a location stack. Returns a stable loc_id (bigint).
   *  Equal content returns the same id. Empty stack → UNKNOWN_LOC_ID. */
  intern_stack(stack: Location[]): bigint {
    if (stack.length === 0) return UNKNOWN_LOC_ID;
    const key = stack.map(l => `${l.filename}|${l.line}|${l.column}`).join('\n');
    const existing = this.intern.get(key);
    if (existing !== undefined) return existing;
    const id = BigInt(this.stacks.length);
    this.stacks.push(stack);
    this.intern.set(key, id);
    return id;
  }

  /** Resolve a loc_id to its stack. Returns [] for UNKNOWN_LOC_ID or out-of-range. */
  resolve(loc_id: bigint): readonly Location[] {
    return this.stacks[Number(loc_id)] ?? [];
  }

  /** Total number of entries, including the reserved empty entry at index 0. */
  get size(): bigint { return BigInt(this.stacks.length); }

  /** All entries in loc_id order (for serialization). Entry 0 is always []. */
  entries(): readonly Location[][] { return this.stacks; }
}

// ── Scoped context ─────────────────────────────────────────────────────

let _currentMap: SourceMap | null = null;

/**
 * Matches the `loc_id <n>` that compile-time error messages embed.
 *
 * Errors raised while building or lowering IR name the offending node by its
 * loc_id, because an id is all the IR carries. Any message that does so must
 * use exactly this form so {@link resolveLocIds} can give it meaning.
 */
const LOC_ID_IN_MESSAGE = /\bloc_id (\d+)\b/g;

/**
 * Replace every `loc_id <n>` in an error message with the source location it
 * names.
 *
 * @param message - Error message that may embed loc_ids
 * @param map - Source map to resolve them against
 * @returns The message with each id replaced by `file:line:column`, or by
 *   `an unknown location` where the map has no entry for it
 *
 * @remarks
 * An id the map cannot resolve still names nothing the reader can act on, so
 * it is described rather than printed.
 */
export function resolveLocIds(message: string, map: SourceMap): string {
  return message.replace(LOC_ID_IN_MESSAGE, (_whole, id: string) => {
    const [location] = map.resolve(BigInt(id));
    return location ? `${location.filename}:${location.line}:${location.column}` : 'an unknown location';
  });
}

/** Run `fn` with `map` as the current scope's source map. Re-entrant safe. */
export function with_source_map<T>(map: SourceMap, fn: () => T): T {
  const prev = _currentMap;
  _currentMap = map;
  try {
    return fn();
  } catch (e: unknown) {
    // The map that gives a loc_id meaning is only in scope here, so this is the
    // last point at which an error carrying one can be made readable.
    if (e instanceof Error) e.message = resolveLocIds(e.message, map);
    throw e;
  } finally {
    _currentMap = prev;
  }
}

/** Wraps `fn` in a new `with_source_map` only if no map is currently active.
 *  Nested calls inherit the existing map. */
export function ensure_source_map<T>(fn: () => T): T {
  if (_currentMap) return fn();
  return with_source_map(new SourceMap(), fn);
}

/** Returns the current SourceMap, or null if outside any with_source_map scope. */
export function get_current_source_map(): SourceMap | null {
  return _currentMap;
}

/** Capture current stack and intern into the active SourceMap.
 *  Returns UNKNOWN_LOC_ID (0n) if no map is active. */
export function get_location_id(): bigint {
  if (!_currentMap) return UNKNOWN_LOC_ID;
  const stack = capture_stack_frames();
  return _currentMap.intern_stack(stack);
}
