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
function shouldIncludeFrame(filename: string): boolean {
  // Skip Node.js internal modules (e.g., node:internal/modules/...)
  if (filename.startsWith('node:')) return false;

  // Skip node_modules - filters out third-party packages including East
  // when installed as a dependency. Handles both Unix and Windows paths.
  if (filename.includes('/node_modules/') || filename.includes('\\node_modules\\')) return false;

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


function capture_stack_frames(): Location[] {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return [];

  const lines = stack.split('\n').slice(1); // Skip "Error" line
  const frames: Location[] = [];

  for (const line of lines) {
    // Simple regex that matches file:line:col at end of line
    const match = line.match(/\(?([^()\s]+):(\d+):(\d+)\)?$/);
    if (match) {
      const [, filename, lineNum, column] = match;
      if (filename && filename !== '' && shouldIncludeFrame(filename)) {
        let loc: Location = { filename, line: BigInt(lineNum!), column: BigInt(column!) };
        frames.push(loc);
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

/** Run `fn` with `map` as the current scope's source map. Re-entrant safe. */
export function with_source_map<T>(map: SourceMap, fn: () => T): T {
  const prev = _currentMap;
  _currentMap = map;
  try { return fn(); }
  finally { _currentMap = prev; }
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
