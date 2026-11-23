/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key, as its kind makes one (#1549, east-workspace#1709) — the
 * one rule the Flowchart's kinds and the Schematic's follow, each over a
 * record of the app's keyed by any type a Dict takes (`kind-keys.ts`):
 *
 * - **built** from the row by the kind's `rowKey`, refused where a row stands
 *   under it or building it fails;
 * - its **session**'s to make — by the app's own rule, the kind's `newKey`,
 *   given the keys taken, or, keyed by Integer, one past the largest — refused
 *   where the app's rule gives a key a row holds, or fails;
 * - keyed by String, a **text** the builder makes up;
 * - keyed by any other type the form types, a **placeholder** — a text made up
 *   that no key prints as — until the viewer types its key;
 * - keyed by any other, **none**: the kind adds no row.
 *
 * @packageDocumentation
 */

import type { EastTypeValue, option } from "@elaraai/east";
import type { ScheduleChange, ScheduleEditing } from "./editing.js";
import { kindKeys } from "./kind-keys.js";

/** A kind, as a new row of it is keyed: its name, its record's key type, and the app's rule for a new key, where it gives one. */
export interface NewRowKeyKind {
    /** Its name. */
    readonly name: string;
    /** Its record's key type. */
    readonly keyType: EastTypeValue;
    /** The app's rule for a new row's key (`newKey`). */
    readonly newKey: option<unknown>;
}

/** How a kind keys the rows it adds (see the module docs). */
export type NewRowKeyRule = "built" | "session" | "text" | "placeholder" | "none";

/** A new row's key, as its kind makes it. */
export type NewRowKey =
    /** Its key: built from its row, its session's, made up, or a placeholder until the viewer types its key. */
    | { readonly key: string }
    /** None: the key its row builds, or the one the app's rule gave, is held already, by the row of that key. */
    | { readonly taken: string }
    /** None: its kind's keys are of a type the form can't type — by the type's name — and its kind makes none. */
    | { readonly untyped: string }
    /** None: no key could be made — its kind's `rowKey` failed as it built one from the row, or the app's `newKey` failed. */
    | { readonly failed: true };

/**
 * How a kind keys the rows it adds (see the module docs).
 *
 * @param kind - The kind
 * @param builds - Whether it builds a row's key from the row: its `rowKey`
 * @returns The rule
 */
export function newRowKeyRule(kind: Pick<NewRowKeyKind, "keyType" | "newKey">, builds: boolean): NewRowKeyRule {
    if (builds) return "built";
    if (kind.newKey.type === "some" || kind.keyType.type === "Integer") return "session";
    const keys = kindKeys(kind.keyType);
    return keys.text ? "text" : keys.typed ? "placeholder" : "none";
}

/** What a new row's key is made from. */
export interface NewRowKeyArgs {
    /** The builder, as the console names it: `Flowchart`. */
    readonly builder: string;
    /** The row's kind. */
    readonly kind: NewRowKeyKind;
    /** The kind's slot, or its record's key, in the shared editing. */
    readonly slot: string;
    /** The function the kind builds a row's key from its row with (`rowKey`); `undefined` for a kind that builds none. */
    readonly build: ((row: Uint8Array) => string) | undefined;
    /** The shared editing: its session makes a key by the app's rule, or one past the largest, and says why it made none. */
    readonly editing: Pick<ScheduleEditing, "mint" | "keyRefusal">;
    /** The change making the row, under any key: the row its kind's `rowKey` builds a key from. Asked only of a kind that builds one. */
    readonly made: () => ScheduleChange | undefined;
    /** The keys the gesture has made already. */
    readonly minted: ReadonlySet<string>;
    /**
     * Whether the builder holds a key of the kind already: read, or drafted.
     *
     * @param key - The key's text
     */
    readonly taken: (key: string) => boolean;
    /**
     * Whether a row of the kind stands under a key: drafted, else read — a key whose row a draft deletes stands free.
     *
     * @param key - The key's text
     */
    readonly stands: (key: string) => boolean;
    /**
     * The text the builder makes up for a key, unique by what it is told is held.
     *
     * @param held - Whether a text is held already
     */
    readonly madeUp: (held: (key: string) => boolean) => string;
}

/**
 * A new row's key, as its kind makes one (see the module docs).
 *
 * @param args - The kind, the edit making the row, and what the builder holds
 * @returns The key, or why there is none; `undefined` while a kind read by key asks its record for its largest, or
 *   where the kind makes no row of the edit
 */
export function newRowKey({ builder, kind, slot, build, editing, made, minted, taken, stands, madeUp }: NewRowKeyArgs): NewRowKey | undefined {
    const holds = (key: string): boolean => minted.has(key) || taken(key);
    switch (newRowKeyRule(kind, build !== undefined)) {
        case "built": {
            const change = made();
            const row = change !== undefined && "row" in change ? change.row : undefined;
            if (build === undefined || row === undefined) return undefined;
            let key: string;
            try {
                key = build(row);
            } catch (err) {
                console.error(`[${builder}] ${kind.name}'s key could not be built from a new row:`, err);
                return { failed: true };
            }
            return minted.has(key) || stands(key) ? { taken: key } : { key };
        }
        case "session": {
            // Where the app's rule gives a key a row holds, or fails, no row is added, and the gesture says which.
            const key = editing.mint(slot, "", minted);
            if (key !== undefined) return { key };
            const why = editing.keyRefusal()?.why;
            return why === undefined ? undefined : "taken" in why ? { taken: why.taken } : { failed: true };
        }
        case "text": return { key: madeUp(holds) };
        case "placeholder": {
            const keys = kindKeys(kind.keyType);
            return { key: madeUp((key) => keys.isKey(key) || holds(key)) };
        }
        case "none": return { untyped: kind.keyType.type };
    }
}
