/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A sheet's numbers its inspector's fields' bounds don't hold (#1585) — a
 * row's, a line's and a group's own — by the cell each is drawn in: its
 * column's, else the field's own key, which Details names it by. Two things
 * read them: the session's readiness, for each entry a draft changed, so its
 * Save waits (`use-editing.ts`); and each row's presentation, any row's — a
 * stored one nobody changed among them — so its cells wear the warn wash a
 * field still missing wears (`use-session.ts`). The check and its words are
 * the form's own (`fieldBreaches`).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, isVariant, type ValueTypeOf } from "@elaraai/east";
import type { SheetFormsType } from "@elaraai/e3-ui/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreaches, getSomeorUndefined, type FieldBreach } from "@elaraai/east-ui-components";
import { isBounded } from "../shared/bounds.js";

/** The inspector's forms, as the payload carries them. */
export type SheetForms = ValueTypeOf<typeof SheetFormsType>;
type Form = SheetForms["row"];

const stringEqual = equalFor(StringType);

/** A form's numbers held to a least or a most, and the cell each is drawn in. */
interface BoundedForm {
    /** Their specs. */
    readonly specs: readonly FieldSpecValue[];
    /** Each one's cell, by its key: its column's key, else its own. */
    readonly cells: ReadonlyMap<string, string>;
}

/** A sheet's bounded numbers: a row's — a grouped sheet's line's — and a group's own. */
export interface SheetBounds {
    /** A row's, or a line's. */
    readonly row: BoundedForm | undefined;
    /** A group's own fields'. */
    readonly group: BoundedForm | undefined;
}

/** One number of an entry its bounds don't hold: its line, the cell it is drawn in, and the bound broken. */
export interface SheetBreach {
    /** Its line's place in its group; `undefined` for the row's own, or the group's. */
    readonly line: number | undefined;
    /** The cell it is drawn in: its column's key, else its field's. */
    readonly at: string;
    /** The bound broken. */
    readonly breach: FieldBreach;
}

/** A form's numbers held to a least or a most; `undefined` where it holds none. */
function boundedOf(form: Form | undefined): BoundedForm | undefined {
    const fields = form?.fields.filter((field) => isBounded(field.spec)) ?? [];
    if (fields.length === 0) return undefined;
    return {
        specs: fields.map((field) => field.spec),
        cells: new Map(fields.map((field) => [field.spec.path.join("."), getSomeorUndefined(field.column) ?? field.spec.path.join(".")])),
    };
}

/**
 * A sheet's bounded numbers, from its inspector's forms.
 *
 * @param forms - The forms; `undefined` for a sheet with no inspector, whose fields have no bounds
 * @returns Them; `undefined` where no form holds a number to a bound, and nothing is checked
 */
export function sheetBoundsOf(forms: SheetForms | undefined): SheetBounds | undefined {
    const row = boundedOf(forms?.row);
    const group = boundedOf(getSomeorUndefined(forms?.group));
    return row === undefined && group === undefined ? undefined : { row, group };
}

/**
 * An entry's numbers its bounds don't hold, from the value its draft holds as
 * far as it holds one: a flat sheet's row; a group's own fields, then each of
 * its lines'; beside the groups, a loose row's — an entry a variant of the
 * two.
 *
 * @param bounds - The sheet's bounded numbers
 * @param held - The value the entry's draft holds
 * @param lines - A group's lines field; `undefined` for a flat sheet
 * @returns Each breach, its line's first
 */
export function entryBreaches(bounds: SheetBounds, held: unknown, lines: string | undefined): SheetBreach[] {
    const out: SheetBreach[] = [];
    const take = (form: BoundedForm | undefined, value: unknown, line: number | undefined) => {
        if (form === undefined || value === undefined) return;
        for (const breach of fieldBreaches(form.specs, value)) out.push({ line, at: form.cells.get(breach.key) ?? breach.key, breach });
    };
    const arm = isVariant(held) ? held : undefined;
    const value = arm === undefined ? held : arm.value;
    if (lines === undefined || (arm !== undefined && !stringEqual(arm.type, "group"))) {
        take(bounds.row, value, undefined);
        return out;
    }
    take(bounds.group, value, undefined);
    ((value as Record<string, readonly unknown[] | undefined> | undefined)?.[lines] ?? []).forEach((line, i) => take(bounds.row, line, i));
    return out;
}
