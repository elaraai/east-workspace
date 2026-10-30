/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One entry's three-way merge: what a session drafted, against what its source
 * holds now, both from the value they began from — East's own patch merge
 * (`detectConflictsFor`, `mergeWithResolutionsFor`), at the draft's type, so a
 * draft not yet complete merges as one that is.
 *
 * - Changes of different parts, or the same change on both sides, combine:
 *   the draft carried over is the source's value with every change of the
 *   draft's.
 * - A part both changed to different values is a conflict, at its patch path.
 *   The draft carried over keeps the draft's value there until someone
 *   chooses, and the entry keeps what both began from — the source's value,
 *   rewound at each conflict alone — so the conflicts read again from the
 *   three values are the same ones, and a later change of the source's to
 *   another part is no conflict.
 * - Taking the source's value at a conflict writes it into the draft; keeping
 *   the draft's moves what both began from to the source's value there.
 *   Either way that conflict reads no more.
 *
 * @packageDocumentation
 */
import {
    IntegerType, OptionType, StringType, applyFor, detectConflictsFor, diffFor, equalFor, mergeWithResolutionsFor, pathFromString,
    prunePatchFor, toEastTypeValue, type EastType, type PatchPath, type PatchPathSegment, type Resolution, type option,
} from "@elaraai/east";

/** What a conflict is: both sides changed a part of the entry; one side removed it while the other changed it; or both added it. */
export type ConflictKind = "changed" | "removed-by-source" | "removed-by-draft" | "added-by-both";

/** One conflict of an entry. */
export interface ConflictPoint {
    /** Where, as East's patch path: what a choice is keyed by. */
    readonly path: string;
    /** Where, as steps from the entry: the entry's own presence left out. */
    readonly at: PatchPath;
    /** What it is. */
    readonly kind: ConflictKind;
}

/** An entry's draft carried over to the value its source holds now. */
export interface MergedEntry {
    /** The draft carried over: the source's value with every change of the draft's — at a conflict, the draft's value until someone chooses. */
    readonly draft: option<unknown>;
    /** What both began from, where a change conflicts: the source's value, rewound at each conflict; `undefined` where none does. */
    readonly ancestor: option<unknown> | undefined;
    /** Each conflict, in the order East's merge meets them. */
    readonly points: readonly ConflictPoint[];
}

/** One step from an entry to a conflict, as a person reads it: the draft's own wrappers left out. */
export type ConflictStep =
    | { readonly kind: "field"; readonly name: string }
    | { readonly kind: "item"; readonly index: bigint }
    | { readonly kind: "key"; readonly key: string }
    | { readonly kind: "case"; readonly tag: string };

const KEEP_DRAFT: Resolution = { type: "keepA" };
const textEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** Whether two path steps name the same place. */
function sameSegment(a: PatchPathSegment, b: PatchPathSegment): boolean {
    switch (a.kind) {
        case "field": return b.kind === "field" && textEqual(a.name, b.name);
        case "index": return b.kind === "index" && integerEqual(a.index, b.index);
        case "key": return b.kind === "key" && textEqual(a.key, b.key);
        case "variant": return b.kind === "variant" && textEqual(a.tag, b.tag);
    }
}

/** Whether one path holds the other: a patch's part at or above a place, or below it. */
function related(a: PatchPath, b: PatchPath): boolean {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (!sameSegment(a[i]!, b[i]!)) return false;
    return true;
}

/**
 * Whether a type is a draft's own field: missing, a value, or text that could
 * not be read — a wrapper of the draft's, no step of the entry's.
 *
 * @param type - The type
 * @returns Whether it is a draft's field
 */
export function isDraftField(type: EastType): boolean {
    return type.type === "Variant" && Object.keys(type.cases).length === 3 && "missing" in type.cases && "value" in type.cases && "invalid" in type.cases;
}

/**
 * The three-way merge of one entry type's drafts — see the module docs.
 */
export class EntryMerger {
    private readonly diff: (before: option<unknown>, after: option<unknown>) => unknown;
    private readonly apply: (base: option<unknown>, patch: unknown) => option<unknown>;
    private readonly detect: (a: unknown, b: unknown) => readonly { path: string }[];
    private readonly mergeWith: (a: unknown, b: unknown, resolutions: Map<string, Resolution>) => unknown;
    private readonly prune: (patch: never, keep: (path: PatchPath) => boolean) => unknown;
    /** Whether two of the entry's draft values — each present or absent — are equal. */
    readonly equal: (a: option<unknown>, b: option<unknown>) => boolean;

    /**
     * @param draftType - The entry's draft type
     */
    constructor(draftType: EastType) {
        const type = toEastTypeValue(OptionType(draftType));
        this.diff = diffFor(type);
        this.apply = applyFor(type);
        this.detect = detectConflictsFor(type);
        this.mergeWith = mergeWithResolutionsFor(type);
        this.prune = prunePatchFor(type) as unknown as EntryMerger["prune"];
        this.equal = equalFor(type);
    }

    /**
     * Carry an entry's draft over to the value its source holds now.
     *
     * @param was - The value both began from
     * @param draft - The draft
     * @param source - The value the source holds now
     * @returns The draft carried over, what both began from where a change conflicts, and each conflict
     */
    merge(was: option<unknown>, draft: option<unknown>, source: option<unknown>): MergedEntry {
        const ours = this.diff(was, draft);
        const theirs = this.diff(was, source);
        const found = this.detect(ours, theirs);
        const keep = new Map(found.map((conflict) => [conflict.path, KEEP_DRAFT] as const));
        const carried = this.apply(was, this.mergeWith(ours, theirs, keep));
        if (found.length === 0) return { draft: carried, ancestor: undefined, points: [] };
        const at = found.map((conflict) => pathFromString(conflict.path));
        // The source's value, put back at each conflict to what both began from.
        const back = this.prune(this.diff(source, was) as never, (leaf) => at.some((place) => related(leaf, place)));
        return {
            draft: carried,
            ancestor: this.apply(source, back),
            points: found.map((conflict, i) => pointOf(conflict.path, at[i]!, was, draft, source)),
        };
    }

    /**
     * An entry's conflicts, read from its three values.
     *
     * @param was - What both began from
     * @param draft - The draft
     * @param source - The value its source holds
     * @returns Each conflict
     */
    conflicts(was: option<unknown>, draft: option<unknown>, source: option<unknown>): ConflictPoint[] {
        return this.detect(this.diff(was, draft), this.diff(was, source))
            .map((conflict) => pointOf(conflict.path, pathFromString(conflict.path), was, draft, source));
    }

    /**
     * The draft with the source's value taken at a conflict.
     *
     * @param draft - The draft
     * @param source - The value its source holds
     * @param path - The conflict's patch path
     * @returns The draft
     */
    takeSource(draft: option<unknown>, source: option<unknown>, path: string): option<unknown> {
        const at = pathFromString(path);
        return this.apply(draft, this.prune(this.diff(draft, source) as never, (leaf) => related(leaf, at)));
    }

    /**
     * What both began from, moved to the source's value at a conflict: the
     * draft's value kept there, as a change of the source's.
     *
     * @param was - What both began from
     * @param source - The value its source holds
     * @param path - The conflict's patch path
     * @returns What both began from
     */
    keepDraft(was: option<unknown>, source: option<unknown>, path: string): option<unknown> {
        const at = pathFromString(path);
        return this.apply(was, this.prune(this.diff(was, source) as never, (leaf) => related(leaf, at)));
    }
}

/** A conflict, read: what it is, and its steps from the entry. */
function pointOf(path: string, segments: PatchPath, was: option<unknown>, draft: option<unknown>, source: option<unknown>): ConflictPoint {
    // A conflict at the entry itself is about whether it is there.
    let kind: ConflictKind = "changed";
    if (segments.length === 0) {
        if (was.type === "none") kind = "added-by-both";
        else if (draft.type === "none") kind = "removed-by-draft";
        else if (source.type === "none") kind = "removed-by-source";
    }
    const first = segments[0];
    const at = first !== undefined && first.kind === "variant" && textEqual(first.tag, "some") ? segments.slice(1) : segments;
    return { path, at, kind };
}

/**
 * A conflict's steps from its entry, as a person reads them: each field, list
 * item, key and choice it is under, the draft's own field wrappers (missing,
 * a value, text that could not be read) left out.
 *
 * @param draftType - The entry's draft type
 * @param at - The conflict's steps ({@link ConflictPoint.at})
 * @returns The steps
 */
export function conflictSteps(draftType: EastType, at: PatchPath): ConflictStep[] {
    const steps: ConflictStep[] = [];
    let type: EastType | undefined = draftType;
    for (const segment of at) {
        switch (segment.kind) {
            case "field":
                steps.push({ kind: "field", name: segment.name });
                type = type?.type === "Struct" ? type.fields[segment.name] : undefined;
                break;
            case "index":
                steps.push({ kind: "item", index: segment.index });
                type = type?.type === "Array" ? type.value : undefined;
                break;
            case "key":
                steps.push({ kind: "key", key: segment.key });
                type = type?.type === "Dict" ? type.value : undefined;
                break;
            case "variant":
                // The draft's own field, or an option's value: no step of the entry's.
                if (type !== undefined && (isDraftField(type) || (type.type === "Variant" && Object.keys(type.cases).length === 2 && "none" in type.cases && "some" in type.cases))) {
                    type = type.type === "Variant" ? type.cases[segment.tag] : undefined;
                    break;
                }
                steps.push({ kind: "case", tag: segment.tag });
                type = type?.type === "Variant" ? type.cases[segment.tag] : undefined;
                break;
        }
    }
    return steps;
}
