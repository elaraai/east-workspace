/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The docked strip (B§9) — the only surface for candidates, previews and
 * provenance; nothing ever floats over the sheet. Six states: editing with
 * an empty buffer (what the field ACCEPTS, nothing armed), editing with
 * candidates (the armed chip in brand tint), the link's prediction and
 * no-candidate lines (P3), the date / quantity preview, and the pending
 * suggestions (P4). `buildStrip` is pure; `SheetStrip` draws it.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined } from "../../utils.js";
import { candidateList, candidateAt, type CandidateContext } from "./candidates.js";
import { cellText, formatQuantity, memberLabel, type SheetColumnMeta } from "./model.js";
import type { LinkCandidate } from "./link/predict.js";
import { parseDate, formatDateLong, daysBetween } from "./parse/date.js";
import { parseQuantity } from "./parse/quantity.js";
import type { EditBuffer } from "./sheet-state.js";
import type { SheetCellValue, SheetMemberValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;

/** One strip chip. */
export interface StripChip {
    key: string;
    label: string;
    /** Armed (brand tint). */
    on: boolean;
    /** A preview-only entry — not an action. */
    flat: boolean;
    /** Pending — an async provider in flight (P4). */
    pending?: boolean;
    title: string;
    /** The candidate index a click picks. */
    pick?: number | undefined;
    /** The members a click adds (a link chip). */
    members?: SheetMemberValue[] | undefined;
}

/** The strip model. */
export interface StripModel {
    on: boolean;
    label: string;
    chips: StripChip[];
    meta: string;
    keys: string;
}

const OFF: StripModel = { on: false, label: "", chips: [], meta: "", keys: "" };

/** What the strip reads beside the edit buffer. */
export interface StripInput {
    edit: EditBuffer | null;
    meta: SheetColumnMeta | undefined;
    candidates: CandidateContext | undefined;
    today: Date;
    /** The base column's date for a date column with `base`. */
    baseDate: Date | undefined;
    /** The unit for a quantity column (from the driver). */
    unit: string | undefined;
    /** A custom kind's parse of the buffer, for its preview. */
    customPreview: SheetCellValue | null | undefined;
    /** The link editor's facts, on a link / set column. */
    link?: StripLinkInput | undefined;
}

/** What the link strip states read (B§9). */
export interface StripLinkInput {
    side: 0 | 1;
    /** The candidates for the buffer, members already in the cell excluded. */
    candidates: LinkCandidate[];
    /** The armed candidate. */
    armed: LinkCandidate | undefined;
    /** The entry menu — the countable abstractions. */
    entry: LinkCandidate[];
    /** The predicted members of the active half (P4), with an enumerate alternative and their provenance. */
    predicted: readonly SheetMemberValue[];
    enumerate: LinkCandidate | undefined;
    predictedMeta: string;
    /** The arity meta while the arity half is edited. */
    arity: string;
    /** The grammar in one line. */
    grammar: string;
}

const flat = (label: string): StripChip[] => [{ key: "v", label, on: false, flat: true, title: "" }];

/** The strip for the current state (pure). */
export function buildStrip(input: StripInput): StripModel {
    const { edit, meta } = input;
    if (edit === null || meta === undefined) return OFF;
    const empty = edit.val.trim() === "";
    const header = meta.header.toUpperCase();
    if ((meta.kind === "link" || meta.kind === "set") && input.link !== undefined) return buildLinkStrip(header, edit.val, input.link, meta.kind === "set");
    switch (meta.kind) {
        case "lookup":
        case "reference":
        case "enum": {
            if (input.candidates === undefined) return OFF;
            const list = candidateList(meta, edit.val, input.candidates);
            if (list.length === 0) {
                return empty ? OFF : { on: true, label: header, chips: flat("no register match — kept as typed"), meta: "", keys: "⏎ commit as typed" };
            }
            const armed = candidateAt(meta, edit.val, edit.hi, input.candidates);
            const hi = armed === undefined ? -1 : Math.max(0, list.indexOf(armed));
            const chips: StripChip[] = list.slice(0, 6).map((label, i) => ({
                key: `a${i}`,
                label: label.length > 34 ? `${label.slice(0, 33)}…` : label,
                on: i === hi,
                flat: false,
                title: label,
                pick: i,
            }));
            const member = hi >= 0 ? input.candidates.registers.byName.get(meta.register ?? "")?.find((m) => m.key === list[hi]) : undefined;
            const memberMeta = member !== undefined ? getSomeorUndefined(member.meta) ?? "" : "";
            if (hi < 0) {
                return { on: true, label: `${header} · accepts`, chips, meta: memberMeta, keys: "type to filter · ⌥↓ to pick · click any" };
            }
            return {
                on: true,
                label: `${list.length > 1 ? "⌥] " : ""}${header}`,
                chips,
                meta: memberMeta,
                keys: `${list.length > 1 ? `${hi + 1} of ${list.length} · ` : ""}⇥ take`,
            };
        }
        case "date": {
            if (empty) {
                return { on: true, label: `${header} · accepts`, chips: flat("a date"), meta: `d/m · weekday · +3d${meta.base !== undefined ? ` · 4d from ${meta.base}` : ""}`, keys: "type to parse" };
            }
            const d = parseDate(edit.val, { today: input.today, base: input.baseDate });
            if (d === null || d === undefined) {
                return { on: true, label: header, chips: flat("unrecognised"), meta: "", keys: "12/4 · fri · +3d · 17 nov" };
            }
            const span = input.baseDate !== undefined ? `${daysBetween(input.baseDate, d)} days` : "";
            return { on: true, label: header, chips: flat(formatDateLong(d)), meta: span, keys: "12/4 · fri · +3d" };
        }
        case "quantity":
        case "integer": {
            if (empty) {
                return { on: true, label: `${header} · accepts`, chips: flat(meta.kind === "quantity" ? "number + unit" : "number"), meta: "560000 · 560k · 1.2m3", keys: "type to parse" };
            }
            const n = parseQuantity(edit.val);
            if (n === null || n === undefined) {
                return { on: true, label: header, chips: flat("unrecognised"), meta: "", keys: "560000 · 560k · 1.2m3" };
            }
            const unit = meta.kind === "quantity" && input.unit !== undefined ? ` ${input.unit}` : "";
            return { on: true, label: header, chips: flat(`${formatQuantity(n, meta.kind === "quantity" ? meta.format : undefined)}${unit}`), meta: "", keys: "560000 · 560k · 1.2m3" };
        }
        case "custom": {
            if (empty) return { on: true, label: `${header} · accepts`, chips: flat(meta.accepts ?? "a value"), meta: "", keys: "type to parse" };
            const p = input.customPreview;
            if (p === undefined || p === null) return { on: true, label: header, chips: flat("unrecognised"), meta: meta.accepts ?? "", keys: "" };
            return { on: true, label: header, chips: flat(cellText(p, meta)), meta: meta.accepts ?? "", keys: "" };
        }
        default:
            return OFF;
    }
}

/** The link strip states (B§9): predicted · candidates · the entry menu · the grammar line. */
function buildLinkStrip(header: string, val: string, link: StripLinkInput, single: boolean): StripModel {
    const empty = val.trim() === "";
    const halfName = single ? "" : link.side === 1 ? " · to" : " · from";
    const chipOf = (c: LinkCandidate, i: number, on: boolean): StripChip => ({
        key: `a${i}`, label: c.label.length > 34 ? `${c.label.slice(0, 33)}…` : c.label, on, flat: false, title: c.label, members: c.members,
    });
    // A prediction is more specific than the register's entry menu.
    if (empty && link.predicted.length > 0) {
        const chips: StripChip[] = link.predicted.map((m, i) => ({ key: `p${i}`, label: memberLabel(m), on: i === 0, flat: false, title: `Add ${memberLabel(m)}`, members: [m] }));
        if (link.enumerate !== undefined) chips.push(chipOf(link.enumerate, 99, false));
        return { on: true, label: `${header} · predicted`, chips, meta: link.predictedMeta, keys: "⇥ one · ⌘→ all · or type" };
    }
    const list = empty ? link.entry : link.candidates;
    if (list.length > 0) {
        const armed = empty ? undefined : link.armed;
        const hi = armed === undefined ? -1 : Math.max(0, list.indexOf(armed));
        const chips = list.slice(0, 12).map((c, i) => chipOf(c, i, i === hi));
        if (hi < 0) {
            return { on: true, label: `${header}${halfName} · accepts`, chips, meta: link.arity, keys: "type to filter · ⌥↓ to pick · click any" };
        }
        return {
            on: true,
            label: `${list.length > 1 ? "⌥] " : ""}${header}${halfName}`,
            chips,
            meta: armed?.meta ?? "",
            keys: `${list.length > 1 ? `${hi + 1} of ${list.length} · ` : ""}⇥ take · , next${single ? "" : " · > hops to the To half"} · ⌘→ rest`,
        };
    }
    // Nothing to offer is still worth a line: the grammar, and the arity check.
    return {
        on: true,
        label: `${header}${halfName} · accepts`,
        chips: flat(empty ? link.grammar : "no register match — kept as typed"),
        meta: link.arity,
        keys: `, adds${single ? "" : " · > hops to the To half"} · ⏎ done`,
    };
}

export interface SheetStripProps {
    styles: Styles;
    model: StripModel;
    onPick: (label: string, i: number, members?: SheetMemberValue[]) => void;
}

/** Renders the docked strip. */
export const SheetStrip = memo(function SheetStrip({ styles, model, onPick }: SheetStripProps) {
    if (!model.on) return null;
    return (
        <Box css={styles.strip} data-slot="strip">
            <Box as="span" css={styles.stripLabel} data-slot="stripLabel">{model.label}</Box>
            <Box css={styles.stripChips}>
                {model.chips.map((ch) => ch.flat
                    ? <Box key={ch.key} as="span" css={styles.stripChipFlat} data-slot="stripChip" data-flat="">{ch.label}</Box>
                    : (
                        <Box
                            key={ch.key}
                            as="span"
                            css={ch.on ? styles.stripChipOn : styles.stripChip}
                            data-slot="stripChip"
                            data-armed={ch.on ? "" : undefined}
                            data-pending={ch.pending ? "" : undefined}
                            title={ch.title}
                            // mousedown, not click: preventDefault keeps focus in the editor so the cell stays open.
                            onMouseDown={(e) => { e.preventDefault(); if (ch.members !== undefined) onPick(ch.title, -1, ch.members); else if (ch.pick !== undefined) onPick(ch.title, ch.pick); }}
                        >
                            {ch.label}
                        </Box>
                    ))}
            </Box>
            <Box as="span" css={styles.stripMeta} data-slot="stripMeta">{model.meta}</Box>
            <Box as="span" css={styles.stripKeys}>{model.keys}</Box>
        </Box>
    );
});
