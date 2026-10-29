/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a card shows of its case (`Decision Queue Spec.md` R14–R17, R19, R23),
 * pure: the option it opens on and the one the viewer chose — the preview, the
 * summary, the value, the figures, the question and the warning follow it —
 * whether the card is modified, Your call's state from the chosen option's
 * question and its answer, the card's status, why Apply is off, the value's
 * sub line, and the rows a verdict writes once Modify's edits are in place.
 *
 * @packageDocumentation
 */

import { BlobType, FloatType, OptionType, StringType, compareFor, equalFor, none, some, type option } from "@elaraai/east";
import { bytesOf, optionId, type CaseChoice, type RowEdit } from "./choices.js";
import { recommendedIndex, type DecisionCase, type DecisionOption } from "./layout.js";
import type { DecisionAnswerWord } from "./messages.js";

/** Your call's state (R16): unanswered, blocked by a No, handed on by a Don't know, or answered Yes. */
export type CallState = "needs" | "blocked" | "handoff" | "answered";

/** A card's status, at its value line's end (R16, P21). */
export type CardStatus = "needsAnswer" | "blocked" | "handoff" | "stale";

/** Why Apply is off (R16, R23, §12). */
export type ApplyOff = "needs" | "blocked" | "handoff" | "stale" | "reading" | "failed" | "malformed" | "unready";

/**
 * Where the rows the chosen option's change touches stand: read, with what the change leaves of them; none to write —
 * no record the queue can write is the change's; read still; no longer taking the change (P21); or not read, the read
 * having failed.
 */
export type RowsState = "ready" | "none" | "reading" | "stale" | "failed";

/** What a card shows of its case and the viewer's choices. */
export interface CardView {
    /** The option the card opens on: the recommended one, else its first (§12). */
    readonly recommended: number;
    /** Whether the recommendation names no option of the case (§12). */
    readonly malformed: boolean;
    /** The chosen option's index; the recommended one unless the viewer chose another that is not refused. */
    readonly chosen: number;
    /** The chosen option; `undefined` for a case with none. */
    readonly option: DecisionOption | undefined;
    /** The chosen option's name among the choices. */
    readonly id: string | undefined;
    /** The answer to the chosen option's question. */
    readonly answer: DecisionAnswerWord | undefined;
    /** Your call, where the chosen option asks a question and the verdicts hold its answer; `undefined` otherwise. */
    readonly call: CallState | undefined;
    /** Modify's edits of the chosen option, by the changed row's key. */
    readonly edits: Readonly<Record<string, RowEdit>> | undefined;
    /** Whether Modify has edited the chosen option. */
    readonly edited: boolean;
    /** Whether the card is the viewer's: another option chosen, or the chosen one edited — `Modified`. */
    readonly modified: boolean;
}

const stringEqual = equalFor(StringType);
const compareFloat = compareFor(FloatType);
const CALLS: Readonly<Record<DecisionAnswerWord, CallState>> = { yes: "answered", no: "blocked", unsure: "handoff" };
const STATUSES: Readonly<Record<CallState, CardStatus | undefined>> = { needs: "needsAnswer", blocked: "blocked", handoff: "handoff", answered: undefined };

/**
 * What a card shows (see the module docs).
 *
 * @param c - The case
 * @param choice - The viewer's choices on it
 * @param asks - Whether the verdicts hold an answer (§5.2): without it the card asks no question
 * @returns What it shows
 */
export function cardView(c: DecisionCase, choice: CaseChoice, asks: boolean): CardView {
    const { index: recommended, malformed } = recommendedIndex(c);
    const picked = choice.option === undefined ? -1 : c.options.findIndex(o => stringEqual(optionId(o), choice.option!));
    const chosen = picked >= 0 && c.options[picked]!.refused.type !== "some" ? picked : recommended;
    const option = c.options[chosen];
    const id = option === undefined ? undefined : optionId(option);
    const answer = id === undefined ? undefined : choice.answers?.[id];
    const call = option !== undefined && asks && option.question.type === "some" ? (answer === undefined ? "needs" : CALLS[answer]) : undefined;
    const edits = id === undefined ? undefined : choice.edits?.[id];
    const edited = edits !== undefined && Object.keys(edits).length > 0;
    return { recommended, malformed, chosen, option, id, answer, call, edits, edited, modified: chosen !== recommended || edited };
}

/**
 * The card's status (R16, P21): what Your call says, else Stale where the open card's change no longer applies.
 *
 * @param view - What the card shows
 * @param stale - Whether the chosen option's change no longer applies to the rows it touches
 * @returns The status; `undefined` for none
 */
export function cardStatus(view: CardView, stale: boolean): CardStatus | undefined {
    const said = view.call === undefined ? undefined : STATUSES[view.call];
    return said ?? (stale ? "stale" : undefined);
}

/**
 * Why Apply is off (R16, R23, §12): the recommendation names no option, the question waits or blocks or hands the case
 * on, the rows the change touches are read still, could not be read or no longer take it, or the edits do not pass
 * their checks.
 *
 * @param view - What the card shows
 * @param rows - Where the rows the chosen option's change touches stand
 * @param unready - Whether Modify's edits fail their checks
 * @returns The reason; `undefined` while Apply is on
 */
export function applyOff(view: CardView, rows: RowsState, unready: boolean): ApplyOff | undefined {
    if (view.malformed || view.option === undefined) return "malformed";
    if (view.call !== undefined && view.call !== "answered") return view.call;
    if (rows === "stale" || rows === "reading" || rows === "failed") return rows;
    return unready ? "unready" : undefined;
}

/** What the value's sub line says (R15). */
export type ValueSub = { readonly kind: "edited" } | { readonly kind: "proposal"; readonly value: number } | { readonly kind: "only" }
    | { readonly kind: "next"; readonly difference: number };

/**
 * The value's sub line (R15): `before your edits` once edited, the proposal's value when another option is chosen,
 * `only option` where no other option is offered, else the difference from the best other option not refused.
 *
 * @param c - The case
 * @param view - What the card shows
 * @returns What it says; `undefined` for a case with no option
 */
export function valueSub(c: DecisionCase, view: CardView): ValueSub | undefined {
    const option = view.option;
    if (option === undefined) return undefined;
    if (view.edited) return { kind: "edited" };
    if (view.chosen !== view.recommended) return { kind: "proposal", value: c.options[view.recommended]!.value };
    let best: number | undefined;
    c.options.forEach((o, i) => {
        if (i === view.chosen || o.refused.type === "some") return;
        if (best === undefined || compareFloat(o.value, best) > 0) best = o.value;
    });
    return best === undefined ? { kind: "only" } : { kind: "next", difference: option.value - best };
}

/** One row a verdict changes, as the chosen option leaves it and as it stands: `undefined` where it is none. */
export interface ChangedRow {
    /** The row's key's text. */
    readonly key: string;
    /** The row as it stands. */
    readonly standing: Uint8Array | undefined;
    /** The row as the option's change leaves it. */
    readonly proposed: Uint8Array | undefined;
    /** Modify's edit of it, if any. */
    readonly edit: RowEdit | undefined;
}

const blobEqual = equalFor(OptionType(BlobType));
const asOption = (bytes: Uint8Array | undefined): option<Uint8Array> => (bytes === undefined ? none : some(bytes));

/**
 * The rows the chosen option changes, each with its edit (R19).
 *
 * @param rows - The rows the option's change leaves, by key: `undefined` for one it deletes
 * @param standing - The rows as they stand, by key
 * @param edits - Modify's edits of the option
 * @returns Each changed row, in the change's order
 */
export function changedRows(rows: ReadonlyMap<string, Uint8Array | undefined>, standing: ReadonlyMap<string, Uint8Array | undefined>,
    edits: Readonly<Record<string, RowEdit>> | undefined): ChangedRow[] {
    return [...rows].map(([key, proposed]) => ({ key, standing: standing.get(key), proposed, edit: edits?.[key] }));
}

/**
 * Whether a changed row ends as it stands (R19): kept as it is, or edited back to it — no change of the verdict's,
 * which Apply writes nothing of and the preview draws as none.
 *
 * @param row - A changed row ({@link changedRows})
 * @returns Whether it ends as it stands
 */
export function endsAsItStands(row: ChangedRow): boolean {
    if (row.edit !== undefined && "keep" in row.edit) return true;
    return sameRow(row.edit !== undefined ? bytesOf(row.edit.row) : row.proposed, row.standing);
}

/**
 * The rows a verdict writes (R19, R23): each changed row as Modify left it — its edited row, or the row the change
 * leaves — leaving out a row that ends as it stands ({@link endsAsItStands}).
 *
 * @param changed - The changed rows ({@link changedRows})
 * @returns The rows to write, by key: `undefined` for one removed
 */
export function writtenRows(changed: readonly ChangedRow[]): Map<string, Uint8Array | undefined> {
    const out = new Map<string, Uint8Array | undefined>();
    for (const row of changed) {
        if (endsAsItStands(row)) continue;
        out.set(row.key, row.edit !== undefined && "row" in row.edit ? bytesOf(row.edit.row) : row.proposed);
    }
    return out;
}

/**
 * The rows an override writes (R20, R23): the person's own change, where the Edit panel set one — each row Modify
 * edited, as it left it — and nothing of the option's change, leaving out a row that ends as it stands.
 *
 * @param changed - The changed rows ({@link changedRows})
 * @returns The rows to write, by key
 */
export function overrideRows(changed: readonly ChangedRow[]): Map<string, Uint8Array | undefined> {
    const out = new Map<string, Uint8Array | undefined>();
    for (const row of changed) {
        if (row.edit === undefined || "keep" in row.edit) continue;
        const next = bytesOf(row.edit.row);
        if (blobEqual(some(next), asOption(row.standing))) continue;
        out.set(row.key, next);
    }
    return out;
}

/**
 * Two rows' bytes the same: what decides whether Modify's edit of a row is still an edit, or puts it back as the
 * proposal has it.
 *
 * @param a - A row's bytes
 * @param b - Another's
 * @returns Whether they hold the same bytes
 */
export function sameRow(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
    return blobEqual(asOption(a), asOption(b));
}

/**
 * A field of a row, read along its path (R19): the form's field, a nested struct's under its name.
 *
 * @param row - The row, decoded as its record's codec decodes it
 * @param path - The field's names, from the row down
 * @returns The field's value
 */
export function fieldAt(row: unknown, path: readonly string[]): unknown {
    let at = row;
    for (const name of path) at = (at as Readonly<Record<string, unknown>>)[name];
    return at;
}

/**
 * A row with one of its fields set (R19): Modify's edit of a field of the form, every other field as it was.
 *
 * @param row - The row, decoded as its record's codec decodes it
 * @param path - The field's names, from the row down
 * @param next - The field's new value, typed as the field
 * @returns The row with the field set
 */
export function withField(row: unknown, path: readonly string[], next: unknown): unknown {
    const [name, ...rest] = path;
    if (name === undefined) return next;
    const struct = row as Readonly<Record<string, unknown>>;
    return { ...struct, [name]: withField(struct[name], rest, next) };
}
