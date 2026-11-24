/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A set cell's editor in a phone's bottom container (east-workspace#1741, `Mobile Sheet Spec.md` SH10, R9): the shared
 * field form's tags editor over the cell's members — each a chip with its ×, an input, and the register's members the
 * row is offered and the cell does not hold suggested as they are typed. What its tags make is the set's link grammar's
 * to say (`link/tags.ts`); each edit is written as the grid writes the cell, and its edits while it stays open are one
 * step of the history (SH10.1). Tinted where the cell differs from what the record holds, as any field is.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { chakra, type SystemStyleObject } from "@chakra-ui/react";
import { ArrayType, StringType, none, toEastTypeValue, variant } from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { FieldForm } from "@elaraai/east-ui-components";
import { NULL_CELL } from "../model.js";
import { setCellOf, setMembers, setSuggestions, setTags } from "../link/tags.js";
import type { SheetInspect } from "../parts.js";
import type { SheetWords } from "../words.js";

type Styles = Record<string, SystemStyleObject>;

/** The field's type: the tags, in order. */
const TAGS = toEastTypeValue(ArrayType(StringType));

/** Props of {@link SetTagsEditor}. */
export interface SetTagsEditorProps {
    /** What the editor reads of the sheet, and how it writes the cell. */
    inspect: SheetInspect;
    /** The sheet's words. */
    words: SheetWords;
    /** The `sheetAction` recipe's slot styles: the bottom container's. */
    bar: Styles;
    /** The cell's row-space row. */
    r: number;
    /** The cell's column, by key. */
    columnKey: string;
    /** The column's header: the field's label. */
    header: string;
    /** The key the editor's edits join under, as one step. */
    joins: string | undefined;
    /** The tone a bound the row breaks is said in, as the form says it. */
    breaches: "warn" | "error";
}

/** Renders a set cell's editor in a phone's bottom container — see the module docs. */
export const SetTagsEditor = memo(function SetTagsEditor({ inspect, words, bar, r, columnKey, header, joins, breaches }: SetTagsEditorProps) {
    const { m } = words;
    const cell = inspect.cellAt(r, columnKey);
    const ctx = useMemo(() => inspect.linkAt(r, columnKey), [inspect, r, columnKey]);
    const held = setMembers(cell);
    // What the record holds of the cell, as a member's line reads it: as it stands on a row no gesture has touched, and
    // none on a new row, whose every value is a change.
    const changes = inspect.changesAt(r);
    const was = changes === undefined ? cell : changes.added ? undefined : changes.held?.get(columnKey);
    const specs = useMemo((): FieldSpecValue[] => [{
        path: [columnKey], label: header, help: none, group: none, type: TAGS, optional: false,
        editor: variant("tags", { options: ctx === undefined ? [] : setSuggestions(ctx, held) }),
    }], [columnKey, header, ctx, held]);
    const value = useMemo(() => ({ [columnKey]: setTags(held) }), [columnKey, held]);
    const baseline = useMemo(() => ({ [columnKey]: setTags(setMembers(was)) }), [columnKey, was]);
    const onChange = useCallback((_path: readonly string[], next: unknown): string | undefined => {
        if (ctx === undefined) return undefined;
        const written = setCellOf(next as readonly string[], cell, ctx);
        const refused = inspect.write([{ r, cells: new Map([[columnKey, written ?? NULL_CELL]]) }], joins);
        return refused === undefined ? undefined : m.cellRefused(refused);
    }, [ctx, cell, inspect, r, columnKey, joins, m]);
    return (
        <chakra.div css={bar.cellForm} data-cell-form="" data-cell-tags="">
            <FieldForm specs={specs} value={value} baseline={baseline} onChange={onChange} readOnly={!inspect.writable || ctx === undefined} live breaches={breaches} />
        </chakra.div>
    );
});
