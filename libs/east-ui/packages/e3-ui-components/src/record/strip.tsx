/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's strip (`Record - DX Proposal.md` SP1–SP7), docked under its
 * rows in the Sheet's place (#1533): the Record's words for the cell under
 * the pointer, else the ring's —
 *
 * - **nothing** (SP1) — the title, and what a click on a cell and on a row does;
 * - **a cycle** (SP2) — its column and state; the row, the state's name, what
 *   the record holds while a draft changed it, and where a click and a
 *   ⇧-click take it; Space, the members' one-key labels and ⌫ in its keys —
 *   and a toggle and a boolean as two states a click flips;
 * - **a title** (SP3) — the Record's word for a row and its key; the title, a
 *   word of the row's, and where its details are;
 * - **an age** (SP4) — its column and count; what it counts and its
 *   threshold, or for how long the row is stale;
 * - **an audit** (SP5) — when, its verb and who, or how many drafts wait;
 * - **a new row's empty field** (SP6) — that Apply waits for it, and how it is
 *   set: a click on a cycle, a toggle or a boolean, else the inspector;
 * - **any other kind** (SP7) — its column and its value, and ⏎ where it edits.
 *
 * Where a cell steps nothing — an owned row, a Record read only, a cell a
 * mark locks — it says where it is and no more; a cell's mark's words follow
 * what it says (#1560). While the Sheet's strip speaks of what is in hand —
 * an open editor, a range, an action — it is the strip; so it is over a cell
 * whose column gives a `detail` of its own, a base field every column takes:
 * the column's words for the cell, of any kind.
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { IntegerType, StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import type { SheetHostStripCell, SheetHostStripProps } from "../sheet/index.js";
import { cellIsBlank, cellText, cellWritable, markOf, resolveMember, type SheetColumnIndex, type SheetColumnMeta, type SheetRegisterIndex } from "../sheet/model.js";
import { namesMember } from "../sheet/Rows.js";
import { SheetStrip } from "../sheet/Strip.js";
import { stepCell, stepsInPlace } from "../sheet/steps.js";
import type { SheetCellValue } from "../sheet/values.js";
import { useSheetWords, type SheetWords } from "../sheet/words.js";
import { ageOf, useRecordNow } from "./clock.js";
import { nameOf, useRecordGrid } from "./grid.js";
import { recordMessages as m } from "./messages.js";
import type { RecordNoun } from "./status.js";

const stringEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** What the Record's strip says: its label, its words and its keys. */
export interface RecordStripText {
    label: string;
    text: string;
    keys: string;
}

/** What the Record's strip is read from. */
export interface RecordStripInput {
    /** The cell it speaks of; `undefined` for none. */
    at: SheetHostStripCell | undefined;
    /** The columns the grid draws. */
    columns: SheetColumnIndex;
    /** The registers, by name. */
    registers: SheetRegisterIndex;
    /** Whether a gesture may be made now. */
    writable: boolean;
    /** The Record's title. */
    title: string | undefined;
    /** The Record's word for its rows. */
    noun: RecordNoun;
    /** Whether the Record has an inspector. */
    inspector: boolean;
    /** The Sheet's words. */
    words: SheetWords;
    /** The Record's now: what an age counts to. */
    now: Date;
}

/** A cell's value in words: a register's member by the label it shows, anything else as its column prints it — none, a dash. */
function valueText(meta: SheetColumnMeta, cell: SheetCellValue | undefined, registers: SheetRegisterIndex, words: SheetWords): string {
    if (cell === undefined || cellIsBlank(cell)) return m.absent();
    const member = namesMember(meta) && cell.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
    return member !== undefined && stringEqual(member.key, cell.type === "String" ? cell.value : "") && member.label !== "" ? member.label : cellText(cell, meta, words);
}

/**
 * The Record's words for the strip — see the module docs.
 *
 * @param input - The cell, and what its words are read against
 * @returns The words; `undefined` for any other kind (SP7)
 */
export function recordStripOf(input: RecordStripInput): RecordStripText | undefined {
    const { at, columns, registers, writable, title, noun, inspector, words, now } = input;
    if (at === undefined) {
        const steps = writable && columns.list.some((meta) => meta.editable && stepsInPlace(meta));
        return { label: title ?? "", text: m.stripRest({ steps, inspector }), keys: m.stripMove() };
    }
    const { row, column: meta, changes } = at;
    const cell = row.cells.get(meta.key);
    const kind = meta.raw.kind;
    // Where the cell steps: a gesture may be made, the cell takes an edit — its column writes, and no mark locks it — and no
    // system owns the row.
    const steps = writable && cellWritable(meta, row.cells) && !row.owned;
    if (changes?.added === true && cellWritable(meta, row.cells) && meta.kind !== "stamped" && meta.kind !== "action" && cellIsBlank(cell)) {
        const first = kind.type === "cycle" ? registers.byName.get(kind.value.register)?.[0] : undefined;
        const how = kind.type === "cycle" ? (first === undefined ? undefined : { cycle: first.label !== "" ? first.label : first.key })
            : kind.type === "toggle" || kind.type === "boolean" ? "click" as const : inspector ? "inspector" as const : undefined;
        return { label: meta.header, text: m.stripRequired({ noun: noun.singular, how }), keys: m.stripRemoveRow() };
    }
    const name = nameOf(row, columns);
    // What the record holds while a draft changed the cell.
    const held = changes !== undefined && changes.dirty.has(meta.key) ? changes.held?.get(meta.key) : undefined;
    switch (kind.type) {
        case "cycle": {
            const members = registers.byName.get(kind.value.register) ?? [];
            const labelOf = (key: string): string => {
                const member = members.find((candidate) => stringEqual(candidate.key, key));
                return member === undefined ? key : member.label !== "" ? member.label : member.key;
            };
            const key = cell?.type === "String" ? cell.value : "";
            const member = members.find((candidate) => stringEqual(candidate.key, key));
            // Where a click and a ⇧-click take it: the shared machine's own steps.
            const towards = (step: 1 | -1): string | undefined => {
                const next = steps ? stepCell(meta, cell, registers, step) : undefined;
                return next?.type === "String" ? labelOf(next.value) : undefined;
            };
            // The members a key sets at once (K4): each by its first spelling one key long — `0–2`, the aliases `1–3`.
            const singles = members.flatMap((candidate) => [candidate.label, ...candidate.aliases].filter((spelling) => [...spelling].length === 1).slice(0, 1));
            const set = singles.length === 0 ? undefined : singles.length === 1 ? singles[0] : `${singles[0]}–${singles[singles.length - 1]}`;
            return {
                label: m.stripState({ header: meta.header, state: key === "" ? m.absent() : labelOf(key) }),
                text: m.stripCycle({
                    name, meta: member === undefined ? "" : getSomeorUndefined(member.meta) ?? "",
                    was: held?.type === "String" ? labelOf(held.value) : undefined, next: towards(1), previous: towards(-1),
                }),
                keys: steps && members[0] !== undefined ? m.stripCycleKeys({ set, first: labelOf(members[0].key) }) : m.stripMove(),
            };
        }
        case "toggle":
        case "boolean": {
            const said = (on: boolean) => (kind.type === "toggle" ? (on ? kind.value.on : kind.value.off) : m.booleanWord({ on }));
            const on = cell?.type === "Boolean" && cell.value;
            return {
                label: m.stripState({ header: meta.header, state: said(on) }),
                text: m.stripFlip({ name, was: held?.type === "Boolean" ? said(held.value) : undefined, next: steps ? said(!on) : undefined }),
                keys: steps ? m.stripFlipKeys() : m.stripMove(),
            };
        }
        case "title": {
            // A word of the row's: the first column after the title that reads as words and holds some.
            let detail: string | undefined;
            for (const other of columns.list.slice(columns.list.indexOf(meta) + 1)) {
                if (other.kind !== "text" && other.kind !== "reference" && other.kind !== "enum" && other.kind !== "person") continue;
                const value = row.cells.get(other.key);
                if (value?.type !== "String" || value.value.trim() === "") continue;
                detail = valueText(other, value, registers, words);
                break;
            }
            return { label: m.stripTitle({ noun: noun.singular, id: row.id }), text: m.stripTitleText({ title: name, detail, inspector }), keys: m.stripMove() };
        }
        case "age": {
            const age = changes?.added === true ? undefined : ageOf(meta, cell, now);
            const threshold = getSomeorUndefined(kind.value.stale);
            if (age === undefined) {
                // No moment to count from: the column's words for none, and what it counts.
                return {
                    label: m.stripState({ header: meta.header, state: getSomeorUndefined(kind.value.absent) ?? m.absent() }),
                    text: m.stripAge({ unit: kind.value.unit.type, count: "", one: false, stale: false, threshold: threshold === undefined ? undefined : words.number(threshold) }),
                    keys: m.stripMove(),
                };
            }
            const count = words.number(age.n);
            return {
                label: m.stripState({ header: meta.header, state: count }),
                text: m.stripAge({ unit: age.unit, count, one: integerEqual(age.n, 1n), stale: age.stale, threshold: age.threshold === undefined ? undefined : words.number(age.threshold) }),
                keys: m.stripMove(),
            };
        }
        case "audit": {
            if (changes !== undefined && !changes.added && changes.fields > 0) return { label: meta.header, text: m.stripPending({ count: words.number(changes.fields) }), keys: m.stripMove() };
            if (changes?.added === true || cell?.type !== "DateTime") return { label: meta.header, text: getSomeorUndefined(kind.value.absent) ?? m.absent(), keys: m.stripMove() };
            const verbCell = row.cells.get(kind.value.verb);
            const byCell = row.cells.get(kind.value.by);
            const verb = verbCell?.type === "String" ? verbCell.value : "";
            const by = byCell?.type === "String" ? byCell.value : "";
            return { label: meta.header, text: m.auditTitle({ when: formatDatePattern("YYYY-MM-DD HH:mm", cell.value), verb, by }), keys: m.stripMove() };
        }
        default:
            return undefined;
    }
}

/** Renders the Record's strip — see the module docs. */
export const RecordStrip = memo(function RecordStrip({ styles: sheetStyles, model, onAction, own, at, columns, registers, writable }: SheetHostStripProps) {
    const { styles, title, noun, inspector } = useRecordGrid();
    const words = useSheetWords();
    const now = useRecordNow();
    // What is in hand, or the column's own detail of the cell: the Sheet's strip.
    if (own || model.on) return <SheetStrip styles={sheetStyles} model={model} onAction={onAction} />;
    const said = recordStripOf({ at, columns, registers, writable, title, noun, inspector, words, now });
    // Any other kind (SP7): its column and its value, so the band stays.
    const line = said ?? (at === undefined ? undefined : {
        label: at.column.header, text: valueText(at.column, at.row.cells.get(at.column.key), registers, words),
        keys: m.stripEdit({ editable: writable && cellWritable(at.column, at.row.cells) && !at.row.owned }),
    });
    if (line === undefined) return null;
    // The cell's mark, after what the strip says of it (#1560).
    const mark = at === undefined ? undefined : markOf(at.column, at.row.cells);
    const text = mark === undefined ? line.text : m.marked({ text: line.text, words: mark.words, lock: mark.lock });
    return (
        <Box css={styles.strip} data-slot="strip" data-record-strip="">
            <Box as="span" css={styles.stripLabel} data-slot="stripLabel">{line.label}</Box>
            <Box as="span" css={styles.stripText} data-slot="stripText" title={text === "" ? undefined : text}>{text}</Box>
            {line.keys !== "" && <Box as="span" css={styles.stripKeys} data-slot="stripKeys">{line.keys}</Box>}
        </Box>
    );
});
