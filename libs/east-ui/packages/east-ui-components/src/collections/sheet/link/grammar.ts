/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The link grammar (B§4.1 — `Sheet Spec.md` §5 row 4): text ↔
 * `Sheet.Types.Link`, resolved against a column's register and the member
 * kinds it declares.
 *
 * - **identified** — a register key or alias, case-insensitively; bare digits
 *   try the identified keys' letter prefixes (`2140` ⇒ `M2140`); a
 *   `number + unit` attribute the register knows (`120t`, `120 T` ⇒ the
 *   `120 t press` family) resolves with its spacing normalised — countable
 *   by attribute.
 * - **range** — `M2140-45` expands through the register; a short upper bound
 *   completes from the lower. A hyphen is a range only between two UNSPACED
 *   bare numbers — spaced, or beside a name, it is an arrow.
 * - **counted** — `N x kind` / `kind x N` with the declared ops, countable
 *   kinds only; a trailing qualifier becomes its own text token; multiplying
 *   an identified member keeps the whole token as text.
 * - **placeholder** — `TBC`.
 * - **text** — anything else, kept as typed. Entry is never blocked.
 *
 * The East-side twin (`Sheet.link.parse` / `print` in east-ui's `link.ts`)
 * is the syntactic half a task can run without the renderer; this module
 * adds the register-aware resolution the editor needs.
 */

import { memberLabel, type SheetColumnMeta } from "../model.js";
import { getSomeorUndefined } from "../../../utils.js";
import type { SheetLinkValue, SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

/** The arrow forms that separate the halves (B§4.1). */
export const ARROW = /\s*(?:->|-->|=>|→|>)\s*|\s+[-–]\s+/;

/** One declared member kind (the column's `members` list). */
export interface MemberKindDecl {
    kind: string;
    identified: boolean;
    countable: boolean;
    resolvesTo: string | undefined;
}

/** What the grammar resolves against — a column's register and its declared kinds. */
export interface LinkVocabulary {
    /** The register's members. */
    members: readonly SheetRegisterMemberValue[];
    /** Lower-cased key → member. */
    byKey: ReadonlyMap<string, SheetRegisterMemberValue>;
    /** Lower-cased alias → member. */
    byAlias: ReadonlyMap<string, SheetRegisterMemberValue>;
    /** The declared member kinds. */
    kinds: readonly MemberKindDecl[];
    /** Kinds that resolve by code. */
    identifiedKinds: ReadonlySet<string>;
    /** Kinds that take the counted form. */
    countableKinds: ReadonlySet<string>;
    /** Whether ranges are accepted (a `range` kind is declared). */
    ranges: boolean;
    /** The multiplication tokens (`x`, `X`, `*`, `×`). */
    ops: readonly string[];
    /** The letter prefixes of the identified keys of the form `LETTERS+DIGITS` (`M` for `M2140`). */
    prefixes: readonly string[];
}

const DEFAULT_OPS = ["x", "X", "*", "×"];

/** Build the vocabulary of a link / set column. */
export function linkVocabulary(meta: SheetColumnMeta, members: readonly SheetRegisterMemberValue[]): LinkVocabulary {
    const kv = meta.raw.kind.value as {
        members?: readonly { kind: string; identified: boolean; countable: boolean; resolvesTo: { type: string; value: string | null } }[];
        multiple?: { type: string; value: { ops: readonly string[] } | null };
    } | null;
    const kinds: MemberKindDecl[] = (kv?.members ?? []).map((k) => ({
        kind: k.kind, identified: k.identified, countable: k.countable, resolvesTo: getSomeorUndefined(k.resolvesTo as never) as string | undefined,
    }));
    const multiple = kv?.multiple !== undefined && kv.multiple !== null ? getSomeorUndefined(kv.multiple as never) as { ops: readonly string[] } | undefined : undefined;
    const byKey = new Map<string, SheetRegisterMemberValue>();
    const byAlias = new Map<string, SheetRegisterMemberValue>();
    const prefixes = new Set<string>();
    const identifiedKinds = new Set(kinds.filter((k) => k.identified).map((k) => k.kind));
    const countableKinds = new Set(kinds.filter((k) => k.countable).map((k) => k.kind));
    for (const m of members) {
        const k = m.key.toLowerCase();
        if (!byKey.has(k)) byKey.set(k, m);
        for (const a of m.aliases) {
            const al = a.toLowerCase();
            if (!byAlias.has(al)) byAlias.set(al, m);
        }
        const pm = /^([A-Za-z]+)(\d+)$/.exec(m.key);
        if (pm !== null && (identifiedKinds.size === 0 || identifiedKinds.has(m.kind))) prefixes.add(pm[1]!);
    }
    return {
        members, byKey, byAlias, kinds, identifiedKinds, countableKinds,
        ranges: kinds.some((k) => k.kind === "range"),
        ops: multiple?.ops ?? DEFAULT_OPS,
        prefixes: [...prefixes],
    };
}

/** Whether a member's kind takes the counted form. */
export function isCountable(vocab: LinkVocabulary, m: SheetRegisterMemberValue): boolean {
    return vocab.countableKinds.size === 0 ? false : vocab.countableKinds.has(m.kind);
}

/** Whether a member's kind resolves by code (identified). */
export function isIdentified(vocab: LinkVocabulary, m: SheetRegisterMemberValue): boolean {
    return vocab.identifiedKinds.size === 0 ? !isCountable(vocab, m) : vocab.identifiedKinds.has(m.kind);
}

/**
 * The register key a `number + unit` attribute names — `120t` · `120 T` ·
 * `120  t` ⇒ the `120 t press` family — by key or alias, with the spacing
 * between the number and the unit normalised both ways.
 */
export function attributeKey(raw: string, vocab: LinkVocabulary): string | undefined {
    const m = /^(\d+(?:[.,]\d+)?)\s*([^\d\s]{1,8})$/.exec(raw.trim().toLowerCase());
    if (m === null) return undefined;
    for (const form of [`${m[1]}${m[2]}`, `${m[1]} ${m[2]}`]) {
        const hit = vocab.byKey.get(form) ?? vocab.byAlias.get(form);
        if (hit !== undefined) return hit.key;
    }
    return undefined;
}

/** The register member a token names — key, alias (a leading "the" dropped), a `number + unit` attribute, or bare digits + a prefix. */
export function resolveMember(raw: string, vocab: LinkVocabulary): SheetRegisterMemberValue | undefined {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (t === "") return undefined;
    const direct = vocab.byKey.get(t) ?? vocab.byKey.get(t.replace(/\s+/g, ""));
    if (direct !== undefined) return direct;
    const alias = vocab.byAlias.get(t) ?? vocab.byAlias.get(t.replace(/^the\s+/, ""));
    if (alias !== undefined) return alias;
    const named = vocab.byKey.get(t.replace(/^the\s+/, ""));
    if (named !== undefined) return named;
    const attr = attributeKey(raw, vocab);
    if (attr !== undefined) return vocab.byKey.get(attr.toLowerCase());
    if (/^\d{2,}$/.test(t)) {
        for (const p of vocab.prefixes) {
            const hit = vocab.byKey.get(`${p.toLowerCase()}${t}`);
            if (hit !== undefined) return hit;
        }
    }
    return undefined;
}

/** A regex over the declared multiplication tokens. */
function opsClass(vocab: LinkVocabulary): string {
    return `[${vocab.ops.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}]`;
}

/** The counted form — a count either side of an operator (`4 x lathe`, `Line 2 × 3`). */
export function parseMultiple(raw: string, vocab: LinkVocabulary): { n: number; rest: string } | undefined {
    const ops = opsClass(vocab);
    const m = new RegExp(`^(?:(\\d{1,3})\\s*${ops}\\s*(.+)|(.+?)\\s*${ops}\\s*(\\d{1,3}))$`, "i").exec(raw.trim());
    if (m === null) return undefined;
    const n = Number(m[1] ?? m[4]);
    const rest = (m[2] ?? m[3] ?? "").trim();
    return n > 0 && rest !== "" ? { n, rest } : undefined;
}

/** The identified members in a numeric span — `M2140` … `M2145` — with the letters of `from`. */
export function rangeMembers(from: string, to: string, vocab: LinkVocabulary): SheetRegisterMemberValue[] {
    const a = /^([A-Za-z]*)(\d+)$/.exec(from);
    const b = /^([A-Za-z]*)(\d+)$/.exec(to);
    if (a === null || b === null) return [];
    const prefix = a[1]!.toLowerCase();
    const lo = Math.min(Number(a[2]), Number(b[2]));
    const hi = Math.max(Number(a[2]), Number(b[2]));
    const out: SheetRegisterMemberValue[] = [];
    for (const m of vocab.members) {
        if (!isIdentified(vocab, m)) continue;
        const km = /^([A-Za-z]*)(\d+)$/.exec(m.key);
        if (km === null || km[1]!.toLowerCase() !== prefix) continue;
        const n = Number(km[2]);
        if (n >= lo && n <= hi) out.push(m);
    }
    return out;
}

/**
 * A range token — `M2140-45` / `2140-2145` — to its normalised bounds, when
 * the register has members in the span. A short upper bound completes from
 * the lower; bare digits take an identified prefix that yields members.
 */
export function parseRange(raw: string, vocab: LinkVocabulary): { from: string; to: string; members: SheetRegisterMemberValue[] } | undefined {
    if (!vocab.ranges) return undefined;
    // Unspaced only: `M2140 - 45` is an arrow between two members, never a range.
    const m = /^([A-Za-z]*)(\d{2,})[-–]([A-Za-z]*)(\d{1,})$/.exec(raw.trim());
    if (m === null) return undefined;
    let upper = m[4]!;
    if (upper.length < m[2]!.length) upper = m[2]!.slice(0, m[2]!.length - upper.length) + upper;
    const letters = m[1] !== "" ? [m[1]!] : m[3] !== "" ? [m[3]!] : vocab.prefixes;
    for (const p of letters) {
        // Take the register's own casing of the prefix.
        const sample = vocab.members.find((x) => x.key.toLowerCase().startsWith(p.toLowerCase()) && /^[A-Za-z]+\d+$/.test(x.key));
        const prefix = sample !== undefined ? sample.key.slice(0, p.length) : p.toUpperCase();
        const from = `${prefix}${m[2]}`;
        const to = `${prefix}${upper}`;
        const members = rangeMembers(from, to, vocab);
        if (members.length > 0) return { from, to, members };
    }
    return undefined;
}

const identified = (key: string): SheetMemberValue => ({ type: "identified", value: { key } }) as SheetMemberValue;
const counted = (n: number, key: string): SheetMemberValue => ({ type: "counted", value: { n: BigInt(n), key } }) as SheetMemberValue;
const range = (from: string, to: string): SheetMemberValue => ({ type: "range", value: { from, to } }) as SheetMemberValue;
const text = (t: string): SheetMemberValue => ({ type: "text", value: t }) as SheetMemberValue;
const PLACEHOLDER: SheetMemberValue = { type: "placeholder", value: null } as SheetMemberValue;

/**
 * One token to its members: the placeholder, a range, a register member, the
 * counted form (a trailing qualifier becomes its own text token; multiplying
 * an identified member keeps the token as text), else text.
 */
export function classifyToken(raw: string, vocab: LinkVocabulary): SheetMemberValue[] {
    const s = raw.trim().replace(/-+$/, "").trim();
    if (s === "") return [];
    if (/^tbc$/i.test(s)) return [PLACEHOLDER];
    const rng = parseRange(s, vocab);
    if (rng !== undefined) return [range(rng.from, rng.to)];
    const mult = parseMultiple(s, vocab);
    if (mult !== undefined) {
        const words = mult.rest.split(/\s+/);
        for (let k = words.length; k >= 1; k--) {
            const head = words.slice(0, k).join(" ");
            const base = resolveMember(head, vocab);
            if (base === undefined) continue;
            if (!isCountable(vocab, base)) return [text(s)];
            const tail = words.slice(k).join(" ").trim();
            return tail !== "" ? [counted(mult.n, base.key), text(tail)] : [counted(mult.n, base.key)];
        }
    }
    const member = resolveMember(s, vocab);
    if (member !== undefined) return [identified(member.key)];
    return [text(s)];
}

/** The members of one half — comma-separated tokens. */
export function parseHalfText(textIn: string, vocab: LinkVocabulary): SheetMemberValue[] {
    return textIn.split(",").flatMap((tok) => classifyToken(tok, vocab));
}

/** The planner's text to a link — `a > b` both halves, `b` destination only, `a >` source only. */
export function parseLinkText(textIn: string, vocab: LinkVocabulary): SheetLinkValue {
    const parts = textIn.split(ARROW);
    if (parts.length === 1) return { from: [], to: parseHalfText(parts[0] ?? "", vocab) } as SheetLinkValue;
    const from = parseHalfText(parts[0] ?? "", vocab);
    const to = parts.slice(1).flatMap((p) => parseHalfText(p, vocab));
    return { from, to } as SheetLinkValue;
}

/** A member's chip meta — the register's line, `unassigned` for a counted member (a count names no one in particular), the span of a range. */
export function memberMeta(m: SheetMemberValue, vocab: LinkVocabulary): string {
    switch (m.type) {
        case "identified": {
            const reg = vocab.byKey.get((m.value as { key: string }).key.toLowerCase());
            return reg !== undefined ? getSomeorUndefined(reg.meta) ?? "" : "";
        }
        case "counted":
            return vocab.byKey.has((m.value as { key: string }).key.toLowerCase()) ? "unassigned" : "";
        case "range": {
            const r = m.value as { from: string; to: string };
            const n = rangeMembers(r.from, r.to, vocab).length;
            return n > 0 ? `${n} members` : "";
        }
        default:
            return "";
    }
}

/** The register key a member counts against — `undefined` for text and the placeholder. */
export function memberKey(m: SheetMemberValue): string | undefined {
    switch (m.type) {
        case "identified": return (m.value as { key: string }).key;
        case "counted": return (m.value as { key: string }).key;
        case "range": return (m.value as { from: string }).from;
        default: return undefined;
    }
}

/** The lower-cased keys a link's members already hold — a member is never offered twice. */
export function usedKeys(members: readonly SheetMemberValue[], vocab: LinkVocabulary): Set<string> {
    const used = new Set<string>();
    for (const m of members) {
        if (m.type === "range") {
            const r = m.value as { from: string; to: string };
            for (const x of rangeMembers(r.from, r.to, vocab)) used.add(x.key.toLowerCase());
            continue;
        }
        const k = memberKey(m);
        if (k !== undefined) used.add(k.toLowerCase());
    }
    return used;
}

/** Print a link the way the planner types it (the model's print, re-exported for the grammar's callers). */
export { memberLabel as printMember };
export { printLinkText } from "../model.js";
