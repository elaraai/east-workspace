/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cells of the kinds only a Record draws (`Record - DX Proposal.md`
 * C1–C10), each from its row's cells and its column's payload, its look a
 * data attribute on the record recipe's slots:
 *
 * - **title** (C1) — the title, its neutral initials before it with `avatar`;
 * - **person** (C2) — the member's initials and label, or a dashed ring and the
 *   words for no one;
 * - **boolean** (C3) — a checkbox;
 * - **cycle** and **toggle** (C4–C6) — a chip as wide as its column's widest
 *   label, a scale's member up the heat ramp and any other in its tone's
 *   wash; or the mark look, a scale's pips — a toggle's one — or a valence's
 *   dot and word;
 * - **age** (C7) — whole units to the Record's clock, a dot once it is stale;
 * - **audit** (C8, C9) — the date, and in blame mode the verb and who; while
 *   the row's drafts change its fields, PENDING and how many;
 * - **an absent value** (C10) — in the column's words, else a dash.
 *
 * A row the record does not hold yet has no age and no audit to show. Every
 * other kind draws as the Sheet's cell content draws it (C11).
 *
 * @packageDocumentation
 */

import type { CSSProperties, ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { IntegerType, StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { formatDatePattern, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { SheetRowChanges } from "../sheet/index.js";
import { resolveMember, type SheetColumnIndex, type SheetColumnMeta, type SheetRegisterIndex } from "../sheet/model.js";
import type { SheetCellValue, SheetRowValue } from "../sheet/values.js";
import type { SheetWords } from "../sheet/words.js";
import { ageOf } from "./clock.js";
import { recordMessages as m } from "./messages.js";

const stringEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** What a cell of a Record's own kind draws, and what it says on hover. */
export interface RecordCellView {
    /** What the cell holds. */
    content: ReactNode;
    /** Its hover; `undefined` where it says nothing beyond its value. */
    title: string | undefined;
}

/** What a cell of a Record's own kind is drawn from. */
export interface RecordCellInput {
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The cell's column. */
    meta: SheetColumnMeta;
    /** The cell's row: its key, and the rule cells an audit reads. */
    row: SheetRowValue;
    /** The cell. */
    cell: SheetCellValue | undefined;
    /** The registers, by name. */
    registers: SheetRegisterIndex;
    /** What the row's drafts changed; `undefined` for a row no gesture has touched. */
    changes: SheetRowChanges | undefined;
    /** The Record's now: what an age counts to. */
    now: Date;
    /** The Sheet's words: the counts in the viewer's language. */
    words: SheetWords;
    /** A cycle's or a toggle's chip's least width in characters: its column's widest label. */
    chip: number | undefined;
}

/**
 * A name's initials (C1): the first letters of its first and last words, its
 * dots left out — `A. Morgan` is `AM`; a single word, its first letter.
 *
 * @param name - The name
 * @returns The initials, as written: the recipe sets their case
 */
function initialsOf(name: string): string {
    const parts = name.replace(/\./g, "").split(/\s+/).filter((part) => part !== "");
    if (parts.length === 0) return "";
    const first = [...parts[0]!][0] ?? "";
    return parts.length === 1 ? first : first + ([...parts[parts.length - 1]!][0] ?? "");
}

/**
 * A scale's member's look (C5): the first empty, the rest up the heat ramp
 * to its fourth step, evenly — of three members, the second's the second step
 * and the third's the fourth. The footer's legend draws its chips so (FT2).
 *
 * @param at - The member's place in the register; `-1` for a key no member has
 * @param n - How many members the register has
 * @returns The look
 */
export function heatOf(at: number, n: number): string {
    return at <= 0 || n < 2 ? "none" : `heat-${Math.max(1, Math.round((4 * at) / (n - 1)))}`;
}

/**
 * The label a register's member shows for the key a cell holds, as the
 * Sheet's cells show it: the key itself where no member has it.
 *
 * @param registers - The registers
 * @param register - The column's register
 * @param key - The key
 * @returns The label
 */
function labelFor(registers: SheetRegisterIndex, register: string | undefined, key: string): string {
    const member = resolveMember(registers, register, key);
    return member !== undefined && stringEqual(member.key, key) && member.label !== "" ? member.label : key;
}

/**
 * Each cycle's and toggle's chip's least width in characters, by column key
 * (C4): its widest label, one width a column, so its states line up.
 *
 * @param columns - The columns drawn
 * @param registers - The registers
 * @returns The widths
 */
export function chipWidths(columns: SheetColumnIndex, registers: SheetRegisterIndex): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    for (const meta of columns.list) {
        const kind = meta.raw.kind;
        const labels = kind.type === "toggle" ? [kind.value.on, kind.value.off]
            : kind.type === "cycle" ? (registers.byName.get(kind.value.register) ?? []).map((member) => (member.label !== "" ? member.label : member.key))
                : undefined;
        if (labels !== undefined) out.set(meta.key, labels.reduce((n, label) => Math.max(n, [...label].length), 0));
    }
    return out;
}

/**
 * A cell of one of the kinds only a Record draws — see the module docs.
 *
 * @param input - The cell, its row and its column, and what they are read against
 * @returns What the cell draws and says on hover; `undefined` for a Sheet kind, which the Sheet's cell content draws
 */
export function recordCell(input: RecordCellInput): RecordCellView | undefined {
    const { styles, meta, row, cell, registers, changes, now, words, chip } = input;
    const kind = meta.raw.kind;
    // A chip's least width: its column's widest label, at the chip's own face.
    const chipStyle = { "--record-chip-ch": chip ?? 0 } as CSSProperties;
    switch (kind.type) {
        case "title": {
            const title = cell?.type === "String" ? cell.value : "";
            if (title === "") return { content: null, title: undefined };
            return {
                content: (
                    <>
                        {kind.value.avatar && <Box as="span" css={styles.avatar} data-slot="avatar" aria-hidden="true">{initialsOf(title)}</Box>}
                        <Box as="span" css={styles.titleCell} data-slot="titleCell">{title}</Box>
                    </>
                ),
                title: m.titleTitle({ title, id: row.id }),
            };
        }
        case "person": {
            const key = cell?.type === "String" ? cell.value : "";
            if (key === "") {
                const nobody = getSomeorUndefined(kind.value.unassigned) ?? m.unassigned();
                return {
                    content: (
                        <>
                            <Box as="span" css={styles.nobody} data-slot="nobody" role="img" aria-label={nobody} />
                            <Box as="span" css={styles.personLabel} data-slot="personLabel" data-nobody="" aria-hidden="true">{nobody}</Box>
                        </>
                    ),
                    title: undefined,
                };
            }
            const label = labelFor(registers, kind.value.register, key);
            return {
                content: (
                    <>
                        <Box as="span" css={styles.avatar} data-slot="avatar" aria-hidden="true">{initialsOf(label)}</Box>
                        <Box as="span" css={styles.personLabel} data-slot="personLabel">{label}</Box>
                    </>
                ),
                title: label,
            };
        }
        case "boolean": {
            const on = cell?.type === "Boolean" && cell.value;
            return {
                content: (
                    <Box as="span" css={styles.box} data-slot="box" data-on={on ? "" : undefined} role="checkbox" aria-checked={on} aria-label={meta.header}>
                        {on && <FontAwesomeIcon icon={faCheck} />}
                    </Box>
                ),
                title: undefined,
            };
        }
        case "toggle": {
            if (cell?.type !== "Boolean") return { content: <Box as="span" css={styles.absent} data-slot="absent">{m.absent()}</Box>, title: undefined };
            const state = cell.value ? kind.value.on : kind.value.off;
            // What the record holds, while a draft changed it.
            const held = changes !== undefined && changes.dirty.has(meta.key) ? changes.held?.get(meta.key) : undefined;
            return {
                content: kind.value.look.type === "mark"
                    ? (
                        <Box as="span" css={styles.pips} data-slot="pips" role="img" aria-label={state}>
                            <Box as="span" css={styles.pip} data-slot="pip" data-on={cell.value ? "" : undefined} />
                        </Box>
                    )
                    : <Box as="span" css={styles.chip} data-slot="chip" data-look={cell.value ? "heat-4" : "none"} style={chipStyle}>{state}</Box>,
                title: m.stateTitle({ header: meta.header, state, was: held?.type === "Boolean" ? (held.value ? kind.value.on : kind.value.off) : undefined }),
            };
        }
        case "cycle": {
            const key = cell?.type === "String" ? cell.value : "";
            if (key === "") return { content: <Box as="span" css={styles.absent} data-slot="absent">{m.absent()}</Box>, title: undefined };
            const members = registers.byName.get(kind.value.register) ?? [];
            const at = members.findIndex((member) => stringEqual(member.key, key));
            const member = members[at];
            const label = member === undefined ? key : member.label !== "" ? member.label : member.key;
            const tone = member === undefined ? undefined : getSomeorUndefined(member.tone)?.type;
            const held = changes !== undefined && changes.dirty.has(meta.key) ? changes.held?.get(meta.key) : undefined;
            const content = kind.value.look.type === "chip"
                ? (
                    <Box as="span" css={styles.chip} data-slot="chip" style={chipStyle}
                        data-look={kind.value.scale ? heatOf(at, members.length) : tone === undefined || tone === "neutral" ? "none" : tone}>
                        {label}
                    </Box>
                )
                : kind.value.scale
                    // A scale's pips: one for each member after the first, filled up to the cell's.
                    ? (
                        <Box as="span" css={styles.pips} data-slot="pips" role="img" aria-label={label}>
                            {members.slice(1).map((_member, j) => <Box key={j} as="span" css={styles.pip} data-slot="pip" data-on={j < at ? "" : undefined} />)}
                        </Box>
                    )
                    : (
                        <Box as="span" css={styles.mark} data-slot="mark" data-tone={tone ?? "neutral"}>
                            <Box as="span" css={styles.markDot} data-slot="markDot" aria-hidden="true" />
                            <Box as="span" css={styles.markWord} data-slot="markWord">{label}</Box>
                        </Box>
                    );
            return {
                content,
                // A member's hover is its name, its `meta`, where it has one.
                title: m.stateTitle({
                    header: meta.header,
                    state: member === undefined ? label : getSomeorUndefined(member.meta) ?? label,
                    was: held?.type === "String" ? labelFor(registers, kind.value.register, held.value) : undefined,
                }),
            };
        }
        case "age": {
            const age = changes?.added === true ? undefined : ageOf(meta, cell, now);
            // The column's own words for no moment say themselves on hover too, where a narrow column ends them in an ellipsis.
            const absent = getSomeorUndefined(kind.value.absent);
            if (age === undefined) return { content: <Box as="span" css={styles.absent} data-slot="absent">{absent ?? m.absent()}</Box>, title: absent };
            const count = words.number(age.n);
            return {
                content: (
                    <>
                        {age.stale && <Box as="span" css={styles.staleDot} data-slot="staleDot" role="img" aria-label={m.stale()} />}
                        <Box as="span" css={styles.age} data-slot="age" data-stale={age.stale ? "" : undefined}>{count}</Box>
                    </>
                ),
                title: m.ageTitle({
                    count, one: integerEqual(age.n, 1n), unit: age.unit, stale: age.stale,
                    threshold: age.threshold === undefined ? undefined : words.number(age.threshold),
                }),
            };
        }
        case "audit": {
            const blame = kind.value.mode.type === "blame";
            // While the row's drafts change its fields: how many, in either mode (C9).
            if (changes !== undefined && !changes.added && changes.fields > 0) {
                const count = words.number(changes.fields);
                return {
                    content: (
                        <>
                            <Box as="span" css={styles.pending} data-slot="pending"><Box as="span" css={styles.pendingDot} data-slot="pendingDot" aria-hidden="true" />{m.pending()}</Box>
                            <Box as="span" css={styles.pendingMeta} data-slot="pendingMeta">{m.pendingMeta({ count, one: changes.fields === 1, blame })}</Box>
                        </>
                    ),
                    title: m.pendingTitle({ count }),
                };
            }
            if (changes?.added === true || cell?.type !== "DateTime") {
                const absent = getSomeorUndefined(kind.value.absent);
                return { content: <Box as="span" css={styles.absent} data-slot="absent">{absent ?? m.absent()}</Box>, title: absent };
            }
            // Who and what: the rule cells the column names, each a String, or none.
            const verbCell = row.cells.get(kind.value.verb);
            const byCell = row.cells.get(kind.value.by);
            const verb = verbCell?.type === "String" ? verbCell.value : "";
            const by = byCell?.type === "String" ? byCell.value : "";
            const said = m.auditMeta({ verb, by });
            return {
                content: (
                    <>
                        <Box as="span" css={styles.auditDate} data-slot="auditDate">{formatDatePattern("YYYY-MM-DD", cell.value)}</Box>
                        {blame && said !== "" && <Box as="span" css={styles.auditMeta} data-slot="auditMeta">{said}</Box>}
                    </>
                ),
                title: m.auditTitle({ when: formatDatePattern("YYYY-MM-DD HH:mm", cell.value), verb, by }),
            };
        }
        default:
            return undefined;
    }
}
