/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patch paths — typed segment representation of a location inside a value.
 *
 * @remarks
 * Patch operations identify *where* a change sits using a path string. The
 * format is documented at {@link Conflict.path} and used unchanged by
 * {@link mergeFor} / {@link detectConflictsFor} / {@link mergeWithResolutionsFor}:
 *
 * | Container | Segment shape | Example     |
 * |-----------|---------------|-------------|
 * | Struct    | `.name`       | `policy.maxWeeklyHours` |
 * | Array     | `[index]`     | `roster[2]` |
 * | Set/Dict  | `{key}`       | `prices{Cabernet}` |
 * | Variant   | `@tag`        | `status@active` |
 * | Root      | `""`          | (empty)     |
 *
 * This module exposes:
 *
 * - {@link PatchPathSegment} — a tagged-union of the four kinds of segment
 * - {@link PatchPath}        — `ReadonlyArray<PatchPathSegment>`
 * - {@link field} / {@link index} / {@link dictKey} / {@link variantTag} —
 *   constructors
 * - {@link pathToString} / {@link pathFromString} — bidirectional conversion
 *   to/from the documented format. Round-trip stable for all valid paths.
 * - {@link pathDisplay}   — short display label for one segment (UI use)
 *
 * The string format is **byte-identical** to what {@link mergeFor} emits, so
 * `Resolution` maps keyed off `Conflict.path` continue to interoperate with
 * paths produced via {@link pathToString}.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * One segment of a {@link PatchPath}. Tag matches the kind of container the
 * segment indexes into.
 *
 * @property kind - Discriminator: `"field"` (struct), `"index"` (array),
 *   `"key"` (dict / set), or `"variant"` (variant case).
 */
export type PatchPathSegment =
    | { readonly kind: "field"  ; readonly name:  string }
    | { readonly kind: "index"  ; readonly index: bigint }
    | { readonly kind: "key"    ; readonly key:   string }
    | { readonly kind: "variant"; readonly tag:   string };

/** A path: ordered sequence of segments from the root of a value. */
export type PatchPath = ReadonlyArray<PatchPathSegment>;

// ============================================================================
// Segment constructors
// ============================================================================

/** Build a struct-field segment. */
export function field(name: string): PatchPathSegment {
    return { kind: "field", name };
}

/** Build an array-index segment. Accepts `bigint` (canonical) or `number`
 *  (convenience). */
export function index(i: bigint | number): PatchPathSegment {
    return { kind: "index", index: typeof i === "bigint" ? i : BigInt(i) };
}

/** Build a dict-key (or set-element) segment. */
export function dictKey(key: string): PatchPathSegment {
    return { kind: "key", key };
}

/** Build a variant-case segment. */
export function variantTag(tag: string): PatchPathSegment {
    return { kind: "variant", tag };
}

// ============================================================================
// String conversion — must stay byte-identical with merge.ts and the
// `Conflict.path` format documented at types.ts:99-108.
// ============================================================================

/**
 * Encode a {@link PatchPath} as a string in the documented `Conflict.path`
 * format. The output is consumable by {@link pathFromString} for a lossless
 * round-trip.
 *
 * @param path - Segments from root to leaf.
 * @returns The encoded string. Empty string for the root path.
 */
export function pathToString(path: PatchPath): string {
    let out = "";
    for (const seg of path) {
        switch (seg.kind) {
            case "field":   out = out === "" ? seg.name : out + "." + seg.name; break;
            case "index":   out = out + "[" + seg.index.toString() + "]";       break;
            case "key":     out = out + "{" + seg.key + "}";                     break;
            case "variant": out = out + "@" + seg.tag;                            break;
        }
    }
    return out;
}

/**
 * Parse a {@link Conflict.path}-format string back into typed segments.
 *
 * @param s - The encoded path. Empty string yields an empty path.
 * @returns The parsed path.
 *
 * @throws If the string is not in the documented format (e.g. unbalanced
 *   brackets, or `index` not parseable as bigint).
 *
 * @remarks
 * Dict keys may contain any character except `}`; a literal `}` inside a key
 * cannot be represented in the format and is therefore rejected at encode
 * time too. Field names may not contain `.`, `[`, `{`, or `@` for the same
 * reason.
 */
export function pathFromString(s: string): PatchPath {
    const out: PatchPathSegment[] = [];
    let i = 0;
    const n = s.length;

    while (i < n) {
        const ch = s[i]!;
        if (ch === ".") {
            // A leading `.` is invalid — root field has no leading dot per
            // the format spec.
            if (out.length === 0) throw new Error(`Leading "." at position 0 of "${s}"`);
            i++;
            const start = i;
            while (i < n && !"[.{@".includes(s[i]!)) i++;
            if (i === start) throw new Error(`Empty field segment at position ${start} of "${s}"`);
            out.push({ kind: "field", name: s.slice(start, i) });
        } else if (ch === "[") {
            const end = s.indexOf("]", i + 1);
            if (end === -1) throw new Error(`Unbalanced "[" at position ${i} of "${s}"`);
            const numStr = s.slice(i + 1, end);
            // Validate semantically: the format requires a non-empty,
            // unsigned, decimal integer between `[` and `]`. `BigInt("")`
            // silently returns 0n; `BigInt("+1")` returns 1n; `BigInt("-1")`
            // returns -1n — all unsafe acceptances if not screened.
            if (numStr.length === 0) {
                throw new Error(`Empty array index at position ${i} of "${s}"`);
            }
            if (!/^[0-9]+$/.test(numStr)) {
                throw new Error(`Invalid array index "${numStr}" at position ${i} of "${s}" (must be a non-negative decimal integer)`);
            }
            let idx: bigint;
            try { idx = BigInt(numStr); }
            catch { throw new Error(`Invalid array index "${numStr}" at position ${i} of "${s}"`); }
            out.push({ kind: "index", index: idx });
            i = end + 1;
        } else if (ch === "{") {
            const end = s.indexOf("}", i + 1);
            if (end === -1) throw new Error(`Unbalanced "{" at position ${i} of "${s}"`);
            const key = s.slice(i + 1, end);
            // Reject `{}` — keys must be non-empty per the format spec.
            if (key.length === 0) {
                throw new Error(`Empty dict key at position ${i} of "${s}"`);
            }
            out.push({ kind: "key", key });
            i = end + 1;
        } else if (ch === "@") {
            i++;
            const start = i;
            while (i < n && !"[.{@".includes(s[i]!)) i++;
            if (i === start) throw new Error(`Empty variant tag at position ${start} of "${s}"`);
            out.push({ kind: "variant", tag: s.slice(start, i) });
        } else {
            // First field segment may be unprefixed (e.g. `policy.maxHours`).
            // Only valid at position 0.
            if (out.length > 0) throw new Error(`Unexpected character "${ch}" at position ${i} of "${s}"`);
            const start = i;
            while (i < n && !"[.{@".includes(s[i]!)) i++;
            out.push({ kind: "field", name: s.slice(start, i) });
        }
    }
    return out;
}

/**
 * Short, user-friendly display label for a single segment. For UI rendering;
 * the renderer typically wants the *terminal* segment of a path as the row
 * label.
 *
 * - field    → `name`
 * - index    → `[N]`
 * - key      → `key` (no braces)
 * - variant  → `@tag`
 *
 * For root-level (empty path) callers use their own placeholder ("(root)" or
 * the binding name).
 */
export function pathDisplay(seg: PatchPathSegment): string {
    switch (seg.kind) {
        case "field":   return seg.name;
        case "index":   return "[" + seg.index.toString() + "]";
        case "key":     return seg.key;
        case "variant": return "@" + seg.tag;
    }
}

// ============================================================================
// Internal: prefix-string helpers used by merge / walk / prune to extend a
// running string-encoded path. Re-exported so existing call sites in
// `merge.ts` keep working without re-implementing the format.
// ============================================================================

/** @internal Append a struct field to a running path string. */
export function joinField(prefix: string, name: string): string {
    return prefix === "" ? name : prefix + "." + name;
}

/** @internal Append an array index to a running path string. */
export function joinIndex(prefix: string, idx: bigint | number): string {
    return prefix + "[" + String(idx) + "]";
}

/** @internal Append a dict / set key to a running path string. */
export function joinKey(prefix: string, keyStr: string): string {
    return prefix + "{" + keyStr + "}";
}

/** @internal Append a variant tag to a running path string. */
export function joinVariant(prefix: string, tag: string): string {
    return prefix + "@" + tag;
}
