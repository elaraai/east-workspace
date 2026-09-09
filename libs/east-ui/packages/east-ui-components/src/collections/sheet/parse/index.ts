/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Parse / print dispatch by column kind (`Sheet Spec.md` §6): typed text to
 * a wire cell, and a cell back to its edit form. A custom kind calls the
 * factory's compiled East pair; the register kinds resolve through the
 * scored candidates (exact → top → typed; an enum non-match clears).
 *
 * @packageDocumentation
 */

import { parseDate, formatDateEdit } from "./date.js";
import { parseQuantity, formatNumberBare } from "./quantity.js";
import { candidateList, type CandidateContext } from "../candidates.js";
import { cellText, memberLabel, printLinkText, type SheetColumnMeta } from "../model.js";
import { parseLinkText, type LinkVocabulary } from "../link/grammar.js";
import type { SheetCellValue, SheetLinkValue } from "../values.js";

/** The outcome of parsing an editor buffer. */
export type ParseOutcome =
    /** An empty buffer — the blank cell. */
    | { kind: "blank" }
    /** A recognised value. */
    | { kind: "cell"; cell: SheetCellValue }
    /** Unrecognised — the editor stays open with the neg ring. */
    | { kind: "unrecognised" };

/** What a parse may need beside the text and the column. */
export interface ParseContext extends CandidateContext {
    /** Today, UTC midnight. */
    today: Date;
    /** The base column's date for a date column with `base`, when the row holds one. */
    baseDate?: Date | undefined;
    /** The wire copilot context for a custom kind's `parse`. */
    wireContext?: unknown;
    /** A link / set column's vocabulary — the grammar resolves against it. */
    linkVocab?: LinkVocabulary | undefined;
}

/** A cell of a scalar tag. */
export function cellOf(tag: "String", value: string): SheetCellValue;
export function cellOf(tag: "Float", value: number): SheetCellValue;
export function cellOf(tag: "Integer", value: bigint): SheetCellValue;
export function cellOf(tag: "DateTime", value: Date): SheetCellValue;
export function cellOf(tag: "Link", value: SheetLinkValue): SheetCellValue;
export function cellOf(tag: string, value: unknown): SheetCellValue {
    return { type: tag, value } as SheetCellValue;
}

/** Parse the editor buffer for a column. */
export function parseCell(meta: SheetColumnMeta, text: string, ctx: ParseContext): ParseOutcome {
    const trimmed = text.trim();
    switch (meta.kind) {
        case "text":
        case "stamped":
            return trimmed === "" ? { kind: "blank" } : { kind: "cell", cell: cellOf("String", text) };
        case "date": {
            const d = parseDate(text, { today: ctx.today, base: ctx.baseDate });
            if (d === undefined) return { kind: "blank" };
            if (d === null) return { kind: "unrecognised" };
            return { kind: "cell", cell: cellOf("DateTime", d) };
        }
        case "quantity": {
            const n = parseQuantity(text);
            if (n === undefined) return { kind: "blank" };
            if (n === null) return { kind: "unrecognised" };
            return { kind: "cell", cell: cellOf("Float", n) };
        }
        case "integer": {
            const n = parseQuantity(text);
            if (n === undefined) return { kind: "blank" };
            if (n === null) return { kind: "unrecognised" };
            return { kind: "cell", cell: cellOf("Integer", BigInt(Math.round(n))) };
        }
        case "lookup":
        case "reference": {
            if (trimmed === "") return { kind: "blank" };
            const list = candidateList(meta, text, ctx);
            const exact = list.find((l) => l.toLowerCase() === trimmed.toLowerCase());
            return { kind: "cell", cell: cellOf("String", exact ?? list[0] ?? trimmed) };
        }
        case "enum": {
            if (trimmed === "") return { kind: "blank" };
            const list = candidateList(meta, trimmed.toUpperCase(), ctx);
            const exact = list.find((l) => l.toLowerCase() === trimmed.toLowerCase());
            const pick = exact ?? list[0];
            // A non-match clears the cell (B§3).
            return pick === undefined ? { kind: "blank" } : { kind: "cell", cell: cellOf("String", pick) };
        }
        case "set":
        case "link": {
            if (trimmed === "") return { kind: "blank" };
            // The grammar against the column's register; entry is never blocked —
            // without a vocabulary the text is kept as a text member.
            const link = ctx.linkVocab !== undefined
                ? parseLinkText(trimmed, ctx.linkVocab)
                : ({ from: [], to: [{ type: "text", value: trimmed }] } as unknown as SheetLinkValue);
            if (meta.kind === "set" && link.from.length > 0) {
                return { kind: "cell", cell: cellOf("Link", { from: [], to: [...link.from, ...link.to] } as unknown as SheetLinkValue) };
            }
            if (link.from.length === 0 && link.to.length === 0) return { kind: "blank" };
            return { kind: "cell", cell: cellOf("Link", link) };
        }
        case "custom": {
            if (trimmed === "") return { kind: "blank" };
            if (meta.customParse === undefined) return { kind: "unrecognised" };
            try {
                const out = meta.customParse(text, ctx.wireContext);
                if (out.type !== "some") return { kind: "unrecognised" };
                return { kind: "cell", cell: out.value as SheetCellValue };
            } catch (err) {
                // Fail-open: a throwing parse reads as unrecognised, never a stuck editor.
                console.error(`[Sheet] custom parse failed on column "${meta.key}":`, err);
                return { kind: "unrecognised" };
            }
        }
    }
    return { kind: "unrecognised" };
}

/** A cell's EDIT form — what the editor opens with (dates `17/11/26`, numbers bare). */
export function editText(cell: SheetCellValue | undefined, meta: SheetColumnMeta): string {
    if (cell === undefined || cell.type === "Null") return "";
    switch (cell.type) {
        case "DateTime": return formatDateEdit(cell.value as Date);
        case "Float": return formatNumberBare(cell.value as number);
        case "Integer": return String(cell.value);
        case "String": return cell.value as string;
        case "Boolean": return String(cell.value);
        case "Link": return printLinkText(cell.value as SheetLinkValue);
    }
    return cellText(cell, meta);
}

/** The labels of a link's members, for the clipboard's two-column form. */
export function linkHalvesText(link: SheetLinkValue): [string, string] {
    return [link.from.map(memberLabel).join(", "), link.to.map(memberLabel).join(", ")];
}
