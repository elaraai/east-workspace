/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Candidate scoring for the register kinds (B§3.1): whole-string prefix (0)
 * → every typed word prefixes some word, or any word prefix (1) → initials
 * in order, two or more characters (2) → substring (3); ties broken by how
 * often the value already appears in the sheet. Only a PREFIX match ghosts
 * inline; a non-prefix match previews as a replacement.
 *
 * With an empty buffer nothing is armed: the strip lists what the field
 * ACCEPTS — the driver column ranked by what usually follows the row above,
 * then by sheet frequency.
 *
 * @packageDocumentation
 */

import type { SheetColumnMeta, SheetRegisterIndex } from "./model.js";
import type { SheetRowValue } from "./values.js";

/** The sheet facts a candidate list reads. */
export interface CandidateContext {
    /** The registers. */
    registers: SheetRegisterIndex;
    /** The resident real rows, in sheet order. */
    rows: readonly SheetRowValue[];
    /** The edited row's index among `rows` (`-1` for a blank row). */
    rowIndex: number;
    /** The driver column's key, when the sheet declares one. */
    driverColumn: string | undefined;
}

/** Score one label against a query (lower is better; `-1` = no match). */
export function scoreLabel(label: string, query: string): number {
    const t = query.trim().toLowerCase();
    if (t === "") return -1;
    const lo = label.toLowerCase();
    if (lo.startsWith(t)) return 0;
    const words = lo.split(/[^a-z0-9]+/).filter(Boolean);
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 1;
    if (words.some((w) => w.startsWith(t))) return 1;
    let wi = 0;
    let ok = true;
    for (const ch of t.replace(/\s+/g, "")) {
        let found = false;
        while (wi < words.length) {
            if (words[wi]![0] === ch) { found = true; wi++; break; }
            wi++;
        }
        if (!found) { ok = false; break; }
    }
    if (ok && t.length >= 2) return 2;
    if (lo.includes(t)) return 3;
    return -1;
}

/** The labels matching `query`, best first; ties by `freq`. */
export function scoreCandidates(labels: readonly string[], query: string, freq?: ReadonlyMap<string, number>): string[] {
    return labels
        .map((x) => ({ x, s: scoreLabel(x, query) }))
        .filter((o) => o.s >= 0)
        .sort((a, b) => a.s - b.s || (freq?.get(b.x) ?? 0) - (freq?.get(a.x) ?? 0))
        .map((o) => o.x);
}

/** How often each String value of `column` appears in the sheet. */
export function columnFrequency(rows: readonly SheetRowValue[], column: string): Map<string, number> {
    const f = new Map<string, number>();
    for (const r of rows) {
        const c = r.cells.get(column);
        if (c === undefined || c.type !== "String" || c.value === "") continue;
        f.set(c.value as string, (f.get(c.value as string) ?? 0) + 1);
    }
    return f;
}

/** A register's member keys, in declaration order. */
function memberKeys(ctx: CandidateContext, register: string | undefined): string[] {
    if (register === undefined) return [];
    return (ctx.registers.byName.get(register) ?? []).map((m) => m.key);
}

/** The String value of a row's column, or `""`. */
function stringAt(row: SheetRowValue | undefined, column: string): string {
    const c = row?.cells.get(column);
    return c !== undefined && c.type === "String" ? (c.value as string) : "";
}

/**
 * The entry menu — what the field accepts with an empty buffer. The driver
 * column ranks by what usually follows the row above (a value that most
 * often came right after the previous row's driver value, over the dated
 * rows in sheet order), then by sheet frequency, then the rest of the
 * register.
 */
export function entryCandidates(meta: SheetColumnMeta, ctx: CandidateContext): string[] {
    const keys = memberKeys(ctx, meta.register);
    if (meta.kind === "enum" || meta.kind === "reference") return keys.slice(0, 8);
    if (meta.kind !== "lookup") return [];
    const score = new Map<string, number>();
    const prev = ctx.rowIndex > 0 ? ctx.rows[ctx.rowIndex - 1] : undefined;
    const prevValue = stringAt(prev, meta.key);
    if (prevValue !== "") {
        const real = ctx.rows.filter((r, i) => i !== ctx.rowIndex && stringAt(r, meta.key) !== "");
        for (let i = 0; i < real.length - 1; i++) {
            const a = stringAt(real[i], meta.key);
            const b = stringAt(real[i + 1], meta.key);
            if (a === prevValue && b !== prevValue) score.set(b, (score.get(b) ?? 0) + 10);
        }
    }
    for (const r of ctx.rows) {
        const v = stringAt(r, meta.key);
        if (v !== "") score.set(v, (score.get(v) ?? 0) + 1);
    }
    const seen = [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)!);
    const rest = keys.filter((k) => !score.has(k));
    return seen.concat(rest).slice(0, 8);
}

/** The scored candidates for a typed buffer (the entry menu when empty). */
export function candidateList(meta: SheetColumnMeta, text: string, ctx: CandidateContext): string[] {
    const t = text.trim();
    if (t === "") return entryCandidates(meta, ctx);
    const keys = memberKeys(ctx, meta.register);
    switch (meta.kind) {
        case "lookup": return scoreCandidates(keys, t, columnFrequency(ctx.rows, meta.key));
        case "reference": return scoreCandidates(keys, t);
        case "enum": return scoreCandidates(keys, t.toUpperCase());
        default: return [];
    }
}

/** Which candidate is armed: an explicit pick, else the top one once something is typed. */
export function armedIndex(text: string, hi: number): number {
    if (hi >= 0) return hi;
    return text.trim() === "" ? 0 : 0;
}

/** The armed candidate for a buffer (`undefined` with an empty buffer — entering arms nothing). */
export function candidateAt(meta: SheetColumnMeta, text: string, hi: number, ctx: CandidateContext): string | undefined {
    if (text.trim() === "" && hi < 0) return undefined;
    const list = candidateList(meta, text, ctx);
    if (list.length === 0) return undefined;
    const i = hi < 0 ? 0 : hi;
    return list[Math.min(i, list.length - 1)];
}

/** The inline ghost — the top prefix candidate's suffix, else `""`. */
export function ghostFor(text: string, candidate: string | undefined): string {
    const t = text.trim();
    if (t === "" || candidate === undefined) return "";
    return candidate.toLowerCase().startsWith(t.toLowerCase()) ? candidate.slice(t.length) : "";
}

/** One word of the ghost — the copilot's word-wise accept. */
export function ghostWord(ghost: string): string {
    if (ghost === "") return "";
    const m = /^[\s\-–/]*[^\s\-–/]+/.exec(ghost);
    return m ? m[0] : ghost;
}

/** A non-prefix match previews as a replacement (`→ Machining - Roughing`); `""` when the ghost covers it. */
export function resolveFor(text: string, candidate: string | undefined): string {
    const t = text.trim();
    if (t === "" || candidate === undefined) return "";
    if (ghostFor(text, candidate) !== "") return "";
    return candidate.toLowerCase() === t.toLowerCase() ? "" : candidate;
}
