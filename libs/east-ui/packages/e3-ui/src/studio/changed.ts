/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an edit changed from what is saved (#1672, EDT-10): the parts of a
 * placement's content the Configure tab tints until the page is saved
 * ({@link changedParts}), and what a view's kind held saved of each field it
 * has now ({@link savedKindFields}).
 *
 * @packageDocumentation
 */

import { equalFor, isTypeEqual, type EastType } from "@elaraai/east";
import { StudioTextType, StudioVisualType, type StudioContent, type StudioView } from "./content.js";
import { kindFieldTypes, kindStruct } from "./kind.js";

/** Adds to `into` each field of `fields` whose value differs between two structs: every field where there is none before. */
function differing(fields: Readonly<Record<string, EastType>>, was: Readonly<Record<string, unknown>> | undefined,
    now: Readonly<Record<string, unknown>>, into: Set<string>): void {
    for (const [field, type] of Object.entries(fields)) {
        if (was === undefined || !equalFor(type)(was[field], now[field])) into.add(field);
    }
}

/** A visual's own fields, beside its view. */
const VISUAL_FIELDS: Readonly<Record<string, EastType>> = Object.fromEntries(
    Object.entries(StudioVisualType.fields).filter(([name]) => name !== "view"));

/**
 * What a view held saved of each field its kind has now: the saved kind's
 * value of each field of the same name at the same East type — every well
 * and option a change of kind within a view carried over — and nothing of
 * any other. What the Configure tab tints a kind's wells and options against
 * until the page is saved (EDT-10): a column switched from a bar is its kind
 * changed, never every well it kept.
 *
 * @param saved - The view as saved; `undefined` for a visual not saved yet
 * @param now - The view now
 * @returns The saved values, by field of the kind now
 */
export function savedKindFields(saved: StudioView | undefined, now: StudioView): Readonly<Record<string, unknown>> {
    const at = kindStruct(now);
    const was = saved === undefined ? undefined : kindStruct(saved);
    if (at === undefined || was === undefined) return {};
    const wasTypes = kindFieldTypes(was.kind);
    return Object.fromEntries(Object.entries(kindFieldTypes(at.kind)).filter(([field, type]) => {
        const before = wasTypes[field];
        return before !== undefined && isTypeEqual(before, type);
    }).map(([field]) => [field, was.struct[field]]));
}

/**
 * The parts of a placement's content that differ from what it holds saved —
 * what the Configure tab tints until the page is saved (EDT-10): a visual's
 * `source`, `where`, `click` and `follow`; `view` and `kind` when it is
 * another; and, by its kind's struct, each well and option that differs from
 * what the saved kind held of it ({@link savedKindFields}) — one the saved
 * kind has not, at its type, differs. A text block's `heading` and `body`.
 * Every part of content not saved, or saved as another case, differs; a
 * component's content has no parts.
 *
 * @param saved - What the placement holds saved; `undefined` for one not saved yet
 * @param now - What it holds now
 * @returns The differing parts' names
 */
export function changedParts(saved: StudioContent | undefined, now: StudioContent): ReadonlySet<string> {
    const changed = new Set<string>();
    if (now.type === "text") {
        differing(StudioTextType.fields, saved?.type === "text" ? saved.value : undefined, now.value, changed);
    } else if (now.type === "visual") {
        const was = saved?.type === "visual" ? saved.value : undefined;
        differing(VISUAL_FIELDS, was, now.value, changed);
        const at = kindStruct(now.value.view);
        const before = was === undefined ? undefined : kindStruct(was.view);
        if (was === undefined || was.view.type !== now.value.view.type) changed.add("view");
        if (before?.kind !== at?.kind) changed.add("kind");
        if (at !== undefined) {
            const kept = savedKindFields(was?.view, now.value.view);
            for (const [field, type] of Object.entries(kindFieldTypes(at.kind))) {
                if (!Object.hasOwn(kept, field) || !equalFor(type)(kept[field], at.struct[field])) changed.add(field);
            }
        }
    }
    return changed;
}
