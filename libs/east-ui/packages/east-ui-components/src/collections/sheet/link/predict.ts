/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Link autocomplete and prediction (B§4.5 — `Sheet Spec.md` §5 row 8).
 *
 * Candidates, in order: the exact identified code → identified codes by
 * prefix when the input looks like a code → countables by name / alias, each
 * followed by an *enumerate* alternative listing its free identified members
 * → identified codes by prefix otherwise → other countables by key prefix →
 * the placeholder. Members already in the cell are never offered twice. A
 * range shows one candidate: its expansion.
 *
 * Prediction runs only while the buffer is empty, per half, never into a
 * locked half, from the column's fill providers as `Link` values (the copilot
 * runner of P4 supplies the predicted link): the predicted members not yet
 * in the cell, a counted member withdrawn once the half has named members.
 */

import { variant } from "@elaraai/east";
import { getSomeorUndefined } from "../../../utils.js";
import { memberLabel } from "../model.js";
import {
    classifyToken, isCountable, isIdentified, memberMeta, parseRange, pluralKind, resolveMember, usedKeys,
    type LinkVocabulary,
} from "./grammar.js";
import type { SheetLinkValue, SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

/** One candidate the strip lists. */
export interface LinkCandidate {
    /** The text the buffer takes (and the chip's label). */
    label: string;
    /** The register's line beside it. */
    meta: string;
    /** What picking it adds to the half. */
    members: SheetMemberValue[];
}

const identified = (key: string): SheetMemberValue => variant("identified", { key });

/**
 * The free identified members under a countable: the ones naming it as their
 * `parent` (a line's machines), else the ones whose `meta` names it (a family's).
 */
export function membersUnder(parent: SheetRegisterMemberValue, vocab: LinkVocabulary, used: ReadonlySet<string>): SheetRegisterMemberValue[] {
    const key = parent.key.toLowerCase();
    const free = (m: SheetRegisterMemberValue) => isIdentified(vocab, m) && !used.has(m.key.toLowerCase());
    const byParent = vocab.members.filter((m) => free(m) && getSomeorUndefined(m.parent)?.toLowerCase() === key);
    if (byParent.length > 0) return byParent;
    return vocab.members.filter((m) => free(m) && getSomeorUndefined(m.meta)?.toLowerCase() === key);
}

/** The scored candidates for a typed buffer, in the B§4.5 order. */
export function linkCandidates(query: string, vocab: LinkVocabulary, used: ReadonlySet<string>): LinkCandidate[] {
    const t = query.trim().toLowerCase();
    if (t === "") return [];
    const free = (m: SheetRegisterMemberValue) => !used.has(m.key.toLowerCase());
    const rng = parseRange(t, vocab);
    if (rng !== undefined) {
        const names = rng.members.map((m) => m.key).join(", ");
        // The span in the kind's own word (`→ 6 machines: …`).
        return [{
            label: `${rng.from}-${rng.to}`,
            meta: `→ ${rng.members.length} ${pluralKind(rng.members[0]!.kind)}: ${names.length > 34 ? `${names.slice(0, 34)}…` : names}`,
            members: [variant("range", { from: rng.from, to: rng.to })],
        }];
    }
    const out: LinkCandidate[] = [];
    const seen = new Set<string>();
    const push = (m: SheetRegisterMemberValue, members?: SheetMemberValue[]) => {
        if (seen.has(m.key)) return;
        seen.add(m.key);
        out.push({ label: m.label, meta: getSomeorUndefined(m.meta) ?? (isCountable(vocab, m) ? m.kind : ""), members: members ?? [identified(m.key)] });
    };
    const exact = resolveMember(query, vocab);
    if (exact !== undefined && free(exact) && !isCountable(vocab, exact)) push(exact);
    // A code prefix ghosts a code before a name gets a look — `m21` is someone
    // typing M2140, not asking for a mill.
    const codeLike = /^[a-z]?\d/.test(t);
    const bare = t.replace(/\s+/g, "");
    const codeHits = vocab.members.filter((m) => isIdentified(vocab, m) && free(m) && (
        m.key.toLowerCase().startsWith(bare)
        || (/^\d/.test(bare) && vocab.prefixes.some((p) => m.key.toLowerCase().startsWith(`${p.toLowerCase()}${bare}`)))
    ));
    if (codeLike) for (const m of codeHits) push(m);
    // Countables by name / alias (a leading "the" dropped), each followed by its enumerate alternative.
    const named = t.replace(/^the\s+/, "");
    for (const m of vocab.members) {
        if (!isCountable(vocab, m) || !free(m)) continue;
        const names = [m.key.toLowerCase(), m.label.toLowerCase(), ...m.aliases.map((a) => a.toLowerCase())];
        if (!names.some((n) => n.startsWith(named) || n.replace(/^the\s+/, "").startsWith(named))) continue;
        push(m);
        const under = membersUnder(m, vocab, used);
        if (under.length > 0) {
            out.push({
                label: under.map((x) => x.key).join(", "),
                meta: `enumerate · ${under.length} members`,
                members: under.map((x) => identified(x.key)),
            });
        }
    }
    if (!codeLike) for (const m of codeHits) push(m);
    // Other countables by key prefix, spacing ignored (`line2`, `120t`).
    for (const m of vocab.members) {
        if (!isCountable(vocab, m) || !free(m) || seen.has(m.key)) continue;
        if (m.key.toLowerCase().replace(/\s+/g, "").startsWith(bare)) push(m);
    }
    if ("tbc".startsWith(t)) out.push({ label: "TBC", meta: "to confirm", members: [variant("placeholder", null)] });
    return out;
}

/** The armed candidate: the explicit pick, else the top one once something is typed. */
export function linkCandidateAt(query: string, hi: number, vocab: LinkVocabulary, used: ReadonlySet<string>): LinkCandidate | undefined {
    if (query.trim() === "") return undefined;
    const list = linkCandidates(query, vocab, used);
    if (list.length === 0) return undefined;
    return list[Math.min(Math.max(hi, 0), list.length - 1)];
}

/** The inline ghost — the armed candidate's suffix when it completes the buffer. */
export function linkGhost(query: string, cand: LinkCandidate | undefined): string {
    const t = query.trim();
    if (t === "" || cand === undefined) return "";
    return cand.label.toLowerCase().startsWith(t.toLowerCase()) ? cand.label.slice(t.length) : "";
}

/** The replacement preview — a real match that is not a prefix (an alias, an attribute, a range). */
export function linkResolve(query: string, cand: LinkCandidate | undefined): string {
    const t = query.trim();
    if (t === "" || cand === undefined) return "";
    if (linkGhost(query, cand) !== "") return "";
    return cand.label.toLowerCase() === t.toLowerCase() ? "" : `${cand.label}${cand.meta !== "" ? `  ${cand.meta}` : ""}`;
}

/**
 * What a buffer resolves to on `,` / ⏎ / a hop / a commit: the armed
 * candidate when it completes the buffer, else the grammar over the text
 * (commas split, ranges expand, the counted form counts).
 */
export function resolveBuffer(query: string, cand: LinkCandidate | undefined, vocab: LinkVocabulary): SheetMemberValue[] {
    const t = query.trim();
    if (t === "") return [];
    if (cand !== undefined && linkGhost(query, cand) !== "") return cand.members;
    if (t.includes(",")) return t.split(",").flatMap((x) => classifyToken(x, vocab));
    return classifyToken(t, vocab);
}

/**
 * The predicted members for one half — the fill's link minus what the cell
 * already holds; a counted member withdrawn once the half has named members;
 * never into a locked half; nothing while the buffer is typed.
 */
export function predictedMembers(
    predicted: SheetLinkValue | undefined,
    side: 0 | 1,
    groups: readonly [readonly SheetMemberValue[], readonly SheetMemberValue[]],
    live: boolean,
    typed: string,
    vocab: LinkVocabulary,
): SheetMemberValue[] {
    if (predicted === undefined || !live || typed.trim() !== "") return [];
    const have = new Set([...groups[0], ...groups[1]].map((m) => memberLabel(m).toLowerCase()));
    const used = usedKeys([...groups[0], ...groups[1]], vocab);
    const named = groups[side].length > 0;
    const out: SheetMemberValue[] = [];
    for (const m of side === 0 ? predicted.from : predicted.to) {
        if (have.has(memberLabel(m).toLowerCase())) continue;
        if (m.type === "identified" && used.has(m.value.key.toLowerCase())) continue;
        if (m.type === "counted" && named) continue;
        out.push(m);
    }
    return out.slice(0, 5);
}

/** Whether `b` is the code after `a`: the same letters and suffix, the next number (`M2140` → `M2141`). */
function follows(a: SheetRegisterMemberValue, b: SheetRegisterMemberValue): boolean {
    if (a.kind !== b.kind) return false;
    const x = /^([A-Za-z]*)(\d+)([A-Za-z]?)$/.exec(a.key);
    const y = /^([A-Za-z]*)(\d+)([A-Za-z]?)$/.exec(b.key);
    return x !== null && y !== null && x[1]!.toLowerCase() === y[1]!.toLowerCase() && x[3]!.toLowerCase() === y[3]!.toLowerCase() && Number(y[2]) === Number(x[2]) + 1;
}

/**
 * The entry menu of a link half, in the vocabulary's order (the options rule's,
 * when the row is offered a subset): the countable abstractions (nobody guesses
 * a code) and each RUN of a ranged kind's consecutive codes as one range
 * (`M2140-M2145`, #844); the identified codes only when nothing else is
 * offered. Nothing already used.
 */
export function linkEntryCandidates(vocab: LinkVocabulary, used: ReadonlySet<string>): LinkCandidate[] {
    const out: LinkCandidate[] = [];
    const ranged = new Set(vocab.kinds.filter((k) => k.ranged).map((k) => k.kind));
    const members = vocab.members.filter((m) => !used.has(m.key.toLowerCase()));
    const one = (m: SheetRegisterMemberValue): LinkCandidate => ({ label: m.label, meta: getSomeorUndefined(m.meta) ?? m.kind, members: [identified(m.key)] });
    for (let i = 0; i < members.length && out.length < 8; i++) {
        const m = members[i]!;
        if (ranged.has(m.kind) && isIdentified(vocab, m)) {
            let last = m;
            let n = 1;
            while (i + 1 < members.length && follows(last, members[i + 1]!)) { last = members[++i]!; n++; }
            if (n === 1) out.push(one(m));
            else out.push({ label: `${m.key}-${last.key}`, meta: `${n} ${pluralKind(m.kind)}`, members: [variant("range", { from: m.key, to: last.key })] });
            continue;
        }
        if (isCountable(vocab, m)) out.push(one(m));
    }
    if (out.length > 0) return out;
    for (const m of members) {
        if (!isIdentified(vocab, m)) continue;
        out.push(one(m));
        if (out.length >= 8) break;
    }
    return out;
}

/** The grammar line the strip states when a half has nothing to offer. */
export function grammarLine(vocab: LinkVocabulary): string {
    const parts: string[] = [];
    for (const k of vocab.kinds) {
        if (k.kind === "range") continue;
        parts.push(k.identified ? `${k.kind} code` : k.kind);
    }
    if (vocab.countableKinds.size > 0) parts.push("N x kind");
    if (vocab.ranges) parts.push("a range");
    parts.push("TBC");
    return parts.join(" · ");
}

/** The metas of a candidate list's members, for tests and the strip. */
export function candidateMeta(c: LinkCandidate, vocab: LinkVocabulary): string {
    return c.meta !== "" ? c.meta : c.members.map((m) => memberMeta(m, vocab)).find((s) => s !== "") ?? "";
}
