/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The host's veto of a connection (`canConnect`), as every route that joins
 * two things asks it: a Connect drag where it rests and at its release, and
 * an inspector's Connect to…. The Schematic asks it of two items, the Plan of
 * two events; each is told the link kind and the two ends, by their refs.
 *
 * @packageDocumentation
 */

import type { option } from "@elaraai/east";

/**
 * The host's veto, decoded: its words refusing a candidate, or `none` allowing it.
 *
 * @typeParam R - What it hears an end as: its ref
 */
export type ConnectVetoFn<R> = (candidate: { kind: string; from: R; to: R }) => option<string>;

/**
 * A connection, as every route asks the host's veto of it: the kind it writes, by its slot, and the two things it joins,
 * by their ids — its words refusing it, or `undefined` allowing it.
 */
export type ConnectVetoOf = (kind: string, from: string, to: string) => string | undefined;

/**
 * The host's veto as a builder's routes ask it. Its verdict on each candidate is kept, so a pointer's moves never ask
 * it again for one; one that throws is logged and allows, so a broken veto never blocks editing.
 *
 * @typeParam R - What the veto hears an end as: its ref
 * @param veto - The host's veto; `undefined` for none, which allows every connection
 * @param refOf - An end's ref, by its id: what the veto hears it as; `undefined` for one it can't name, which it allows
 * @param builder - The builder asking, as a logged failure names it (`Schematic`)
 * @returns The veto, by the candidate's kind and its ends' ids
 */
export function connectVetoOf<R>(veto: ConnectVetoFn<R> | undefined, refOf: (id: string) => R | undefined, builder: string): ConnectVetoOf {
    if (veto === undefined) return () => undefined;
    const verdicts = new Map<string, string | null>();
    return (kind, from, to) => {
        const key = `${kind}\u0000${from}\u0000${to}`;
        const kept = verdicts.get(key);
        if (kept !== undefined) return kept ?? undefined;
        let refusal: string | null = null;
        const fromRef = refOf(from), toRef = refOf(to);
        if (fromRef !== undefined && toRef !== undefined) {
            try {
                const said = veto({ kind, from: fromRef, to: toRef });
                refusal = said.type === "some" ? said.value : null;
            } catch (err) {
                console.error(`[${builder}] canConnect veto failed (allowing):`, err);
            }
        }
        verdicts.set(key, refusal);
        return refusal ?? undefined;
    };
}
