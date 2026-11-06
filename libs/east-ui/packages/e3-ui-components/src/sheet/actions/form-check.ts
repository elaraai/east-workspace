/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an action's form holds, as its three places hold it — the grid's
 * popover, the inspector's inline form and a phone's bar (#1476, #1478,
 * #1479): a field's value along its path, and which required field is left
 * empty. A field emptied as it is typed in is empty whatever value it last
 * told: a number field that is cleared tells nothing (the hand test's F3), so
 * its own text is read too.
 *
 * @packageDocumentation
 */

import type { FieldSpecValue } from "@elaraai/east-ui/internal";

/**
 * A value with one field along a path set.
 *
 * @param value - The form's value
 * @param path - The field's path
 * @param to - Its new value
 * @returns The value with it set
 */
export function setAt(value: unknown, path: readonly string[], to: unknown): unknown {
    if (path.length === 0) return to;
    const [head, ...rest] = path;
    const at = (value ?? {}) as Record<string, unknown>;
    return { ...at, [head!]: setAt(at[head!], rest, to) };
}

/**
 * A field's value along a path.
 *
 * @param value - The form's value
 * @param path - The field's path
 * @returns Its value, `undefined` for none
 */
export function getAt(value: unknown, path: readonly string[]): unknown {
    let at = value;
    for (const name of path) at = at === undefined || at === null ? undefined : (at as Record<string, unknown>)[name];
    return at;
}

/**
 * The first required field left empty: one holding no value, or a text input the viewer has emptied.
 *
 * @param specs - The form's fields
 * @param value - The form's value as it stands
 * @param root - The element the form is drawn in, whose inputs are read
 * @returns The field, or `undefined` while every required one holds a value
 */
export function emptyRequired(specs: readonly FieldSpecValue[], value: unknown, root: HTMLElement | null): FieldSpecValue | undefined {
    return specs.find((spec) => {
        if (spec.optional) return false;
        if (getAt(value, spec.path) === undefined) return true;
        const input = root?.querySelector<HTMLInputElement>(`[data-field="${spec.path.join(".")}"] input:not([type=radio]):not([type=checkbox])`);
        return input !== null && input !== undefined && input.value.trim() === "";
    });
}

/** The first control of a form: a text box, a choice's radio or a date's segment (K5; the hand test's F1 for a date field). */
export const FIRST_CONTROL = "input:not([type=hidden]), textarea, [role=radio], [role=spinbutton]";
