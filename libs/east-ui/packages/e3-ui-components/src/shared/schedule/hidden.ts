/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The hidden pick: which of a source's choices hide a row of its record that
 * its narrowing hides — asked of e3 through the record's indexes, never worked
 * out in the browser — so that Search Records' line for the row, and an
 * issue's line, can name them as the rail's `Replaces …` names the choices a
 * pick drops, and a pick of the row clears just them. The Sheet asks it of its
 * `rows` source's rows (#1376); the Allocation of the rows its bins stand on —
 * each bin's lane, its resource and its arrival, in the source of each that
 * hides it — and the Roster of its people's (#1398).
 *
 * - **A choice alone.** For each choice the index rules let stand alone
 *   (`recordChoiceWhere` from no narrowing), whether the narrowing of that
 *   choice alone holds the row: the record Slice's membership read
 *   (`recordSliceWithin`) over the row's maintained keys. A choice they do not
 *   let stand alone — a trailing field of an index no other index leads, which
 *   the rail offers only once the fields before it are chosen — is asked as the
 *   rail holds it: with the choices before it, the narrowing's leading path
 *   through it. Its own answer is known once every other choice in its
 *   question holds the row; while one of them hides it, it goes with that one.
 * - **What a pick clears.** The choices that hide the row, each cleared as the
 *   rail clears a choice (`recordChoiceWhere` with none), which drops any
 *   choice that cannot stand without one it clears — named beside them — and a
 *   choice that could not be told apart from them. Every other choice stays,
 *   and the narrowing left holds the row: every choice in it holds it.
 * - **What it reads.** Only the rows it is asked of, each question's
 *   membership of all of them in one request, kept by the record's revision
 *   and the narrowing: a row asked of again reads nothing.
 * - **How it says so.** Each choice as the rail words it (`Status: Ready`,
 *   {@link hidingWords}), in the sentence a builder's message table makes of
 *   them — in English, {@link hiddenByText}.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { StringType, equalFor, none, printFor, some, type option, type ValueTypeOf } from "@elaraai/east";
import {
    RecordSliceWhereType, recordChoiceWhere, recordPlanIndex,
    type RecordSliceBindType, type RecordSliceEntry, type RecordSliceFieldType, type RecordSliceIndexType,
} from "@elaraai/east-ui/internal";
import { useSliceReactivity, useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import { awaitTracked, recordChoiceLabel, recordSlicePage, recordSliceRevision, recordSliceRows, recordSliceWithin } from "@elaraai/east-ui-components/internal";

type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Index = ValueTypeOf<RecordSliceIndexType>;
type Bind = ValueTypeOf<RecordSliceBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;

const printWhere = printFor(RecordSliceWhereType);
const stringEqual = equalFor(StringType);

/** No narrowing: the record's own rows, in its order. */
const WHOLE_RECORD: Where = new Map();

/** One question the hidden pick asks of a row: whether a narrowing standing for one of the choices holds it. */
export interface HidingQuestion {
    /** The choice it asks of, by its field. */
    readonly field: string;
    /** The narrowing asked: the choice alone, or — one the rail lets stand only after the choices before it — with them. */
    readonly where: Where;
}

/**
 * A narrowing's choices in its index's order: the order the rail holds them
 * in, each after the ones it stands on.
 *
 * @param indexes - The record's indexes, as its source lists them
 * @param where - The narrowing
 * @returns Its fields, in that order
 */
function narrowingOrder(indexes: readonly Index[], where: Where): string[] {
    const index = recordPlanIndex(indexes, where);
    const order = index === undefined ? [] : index.fields.filter((field) => where.has(field));
    for (const field of where.keys()) if (!order.some((f) => stringEqual(f, field))) order.push(field);
    return order;
}

/**
 * The questions that tell which of a narrowing's choices hide a row (see the
 * module docs): each choice alone where the index rules let it stand alone,
 * else with the choices before it, as the rail holds it.
 *
 * @param indexes - The record's indexes, as its source lists them
 * @param where - The narrowing
 * @returns One question for each choice, in the narrowing's order
 */
export function hidingQuestions(indexes: readonly Index[], where: Where): HidingQuestion[] {
    const order = narrowingOrder(indexes, where);
    return order.map((field, at) => {
        const alone = recordChoiceWhere(indexes, WHOLE_RECORD, field, where.get(field)!);
        if (alone !== null) return { field, where: alone };
        // As the rail holds it: after the choices before it — and, where those are no path an index answers, the ones
        // after it too, until they are one.
        for (let end = at + 1; end <= order.length; end++) {
            const path: Where = new Map(order.slice(0, end).map((f) => [f, where.get(f)!] as const));
            if (recordPlanIndex(indexes, path) !== undefined) return { field, where: path };
        }
        return { field, where };
    });
}

/** Which choices hide a row, by their fields, as its questions' answers say. */
export interface HidingVerdict {
    /** The choices that hide it, in the narrowing's order. */
    readonly by: readonly string[];
    /** The choices whose own answer is not known: each asked only beside one that hides the row. */
    readonly unknown: readonly string[];
}

/**
 * Which choices hide a row, from whether each question holds it (see the
 * module docs). A question that holds the row holds it by every choice in it,
 * a narrowing being all of its choices at once; one that does not, asked of a
 * choice alone, says that choice hides it, and asked of a choice with others,
 * says so once every other choice in it holds the row.
 *
 * @param questions - The questions, as {@link hidingQuestions} asks them
 * @param holds - Whether each holds the row, in their order
 * @returns The choices that hide it, and those that cannot be told apart from them; `undefined` when the answers say
 *   nothing hides it, which a row the narrowing hides cannot be: they were read at another revision
 */
export function hidingOf(questions: readonly HidingQuestion[], holds: readonly boolean[]): HidingVerdict | undefined {
    const known = new Map<string, boolean>();
    questions.forEach((q, i) => { if (holds[i]) for (const field of q.where.keys()) known.set(field, true); });
    questions.forEach((q, i) => { if (!holds[i] && q.where.size === 1) known.set(q.field, false); });
    const heldBy = (field: string) => known.get(field) ?? false;
    for (let moved = true; moved;) {
        moved = false;
        questions.forEach((q, i) => {
            if (known.has(q.field) || holds[i]) return;
            if ([...q.where.keys()].every((field) => stringEqual(field, q.field) || heldBy(field))) {
                known.set(q.field, false);
                moved = true;
            }
        });
    }
    const by = questions.filter((q) => known.has(q.field) && !heldBy(q.field)).map((q) => q.field);
    const unknown = questions.filter((q) => !known.has(q.field)).map((q) => q.field);
    // None told apart from the others: each might hide it, so each is named.
    if (by.length === 0) return unknown.length === 0 ? undefined : { by: unknown, unknown: [] };
    return { by, unknown };
}

/** What e3 said hides a row the narrowing hides, and what a pick of it clears (the hidden pick). */
export interface HiddenAnswer {
    /** The choices that hide it, by their fields, in the narrowing's order. */
    readonly by: readonly string[];
    /**
     * The choices a pick clears beside them, by their fields: each one the rail clears with one of them, as it cannot
     * stand without it, or one that could not be told apart from them.
     */
    readonly also: readonly string[];
    /** The narrowing a pick leaves: every other choice. */
    readonly where: Where;
}

/**
 * What a pick of a row clears: the choices that hide it, each cleared as the
 * rail clears a choice — dropping one that cannot stand without it — and any
 * that could not be told apart from them still standing.
 *
 * @param indexes - The record's indexes, as its source lists them
 * @param where - The narrowing
 * @param verdict - Which choices hide the row
 * @returns The answer: what hides it, what a pick clears besides, and the narrowing it leaves
 */
export function clearingOf(indexes: readonly Index[], where: Where, verdict: HidingVerdict): HiddenAnswer {
    let next: Where = where;
    for (const field of verdict.by) next = recordChoiceWhere(indexes, next, field, undefined) ?? next;
    for (const field of verdict.unknown) if (next.has(field)) next = recordChoiceWhere(indexes, next, field, undefined) ?? next;
    const left = next;
    const also = narrowingOrder(indexes, where).filter((field) => !verdict.by.some((f) => stringEqual(f, field)) && !left.has(field));
    return { by: verdict.by, also, where: left };
}

/** The choices that hide a row and those a pick clears with them, each as the rail words it — `Status: Ready`. */
export interface HidingWords {
    /** The choices that hide it. */
    readonly filters: readonly string[];
    /** The choices a pick clears with them. */
    readonly also: readonly string[];
}

/**
 * What e3 said hides a row, each choice as the rail words it: its field's
 * label and the choice the narrowing holds of it (`recordChoiceLabel`).
 *
 * @param fields - The source's fields, as its part of the slice lists them
 * @param where - The narrowing the answer was asked of
 * @param answer - What e3 said hides the row
 * @param words - The app's formatters, which word a date or a number of a choice
 * @returns The choices that hide it, and those a pick clears with them
 */
export function hidingWords(fields: readonly Field[], where: Where, answer: HiddenAnswer, words: Formatters): HidingWords {
    const label = (fieldId: string): string => {
        const field = fields.find((f) => stringEqual(f.fieldId, fieldId));
        return field === undefined ? fieldId : recordChoiceLabel(field, where.get(fieldId), words);
    };
    return { filters: answer.by.map(label), also: answer.also.map(label) };
}

/**
 * The English of a row the rail's narrowing hides, by the choices that do —
 * joined as the rail's `Replaces …` joins them — and what a pick of it clears:
 * `hidden by Status: Ready — picking it clears that filter`. A builder's
 * message table says it so in English, and a translation in its own words.
 *
 * @param filters - The choices that hide the row, as the rail words them
 * @param also - The choices a pick clears with them
 * @returns The words
 */
export function hiddenByText(filters: readonly string[], also: readonly string[]): string {
    const one = filters.length === 1;
    const extra = also.length === 0 ? "" : `, and ${also.join("; ")} with ${one ? "it" : "them"}`;
    return `hidden by ${filters.join("; ")} — picking it clears ${one ? "that filter" : "those filters"}${extra}`;
}

/** What the narrowing holds of a row it was asked of, and — of one it hides — what e3 said hides it, once it has. */
export type HiddenState =
    /** The narrowing holds it, or the record holds no row by its key: nothing hides it. */
    | { readonly hidden: false }
    /** The narrowing hides it: what does, `undefined` until e3 has said — or where it could not. */
    | { readonly hidden: true; readonly answer: HiddenAnswer | undefined };

const SHOWN: HiddenState = { hidden: false };
const HIDDEN: HiddenState = { hidden: true, answer: undefined };

/** What the hidden pick has asked and been told, at one revision and narrowing. */
interface Asked {
    /** The revision and the narrowing, as one key. */
    readonly key: string;
    /** Each row's state, by its id. */
    readonly states: Map<string, HiddenState>;
    /** The rows asked of, by their ids: each asked once. */
    readonly asked: Set<string>;
}

/** What {@link useHiddenRows} asks e3 through. */
export interface HiddenRowsInput {
    /** Who asks, as its console names it when a read fails: `Sheet`, `Allocation`. */
    readonly name: string;
    /** The source's part of the slice; `undefined` while nothing narrows its rows. */
    readonly part: Bind | undefined;
    /** Its narrowing. */
    readonly where: Where | undefined;
    /** The record's revision the builder reads at: what the answers are kept by, with the narrowing. */
    readonly revision: string | undefined;
    /** A row's record key, by its id: none for an id that names no key. */
    readonly keyOf: (id: string) => option<unknown>;
    /** A row's id, by its record key. */
    readonly idOf: (key: unknown) => string;
}

/** The hidden pick's reads, and what they have been told. */
export interface HiddenRows {
    /**
     * Asks which choices hide the rows a listing of the record holds from its row `from` that the narrowing hides — the
     * key search's lines: their rows are those the listing read, so nothing is read again for them.
     *
     * @param from - The listing's first row, in the record's order
     * @param ids - Each listed row's id, in order
     * @param held - Whether the narrowing holds each, as the listing read it
     */
    askListed(from: number, ids: readonly string[], held: readonly boolean[]): void;
    /**
     * Asks of some rows by their ids — an issue's, or the rows the key search's lines stand on — whether the narrowing
     * hides them, and which choices hide those it does: their rows read by their keys in one request, which the narrowing
     * holds in one more — none more where the builder knows already that it hides them all, as the source's shown keys
     * have said.
     *
     * @param ids - The rows' ids
     * @param hidden - Whether the narrowing is known to hide every one of them
     */
    askIds(ids: readonly string[], hidden?: boolean): void;
    /**
     * What is known of a row at the revision and the narrowing now.
     *
     * @param id - The row's id
     * @returns Its state; `undefined` while it has not been asked of, or is being asked whether the narrowing hides it
     */
    stateOf(id: string): HiddenState | undefined;
    /** Moves as answers land. */
    readonly version: number;
}

/**
 * Reads which of a source's choices hide the rows its narrowing hides, for
 * the rows a builder is asked to say so of — see the module docs.
 *
 * @param input - Who asks, the source's part, its narrowing, the record's revision, and its rows' keys
 * @returns The reads and what they have been told
 */
export function useHiddenRows(input: HiddenRowsInput): HiddenRows {
    const [version, setVersion] = useState(0);
    const latest = useRef(input);
    latest.current = input;
    const held = useRef<Asked>({ key: "", states: new Map(), asked: new Set() });

    /** What is asked and known at the revision and the narrowing now — none kept from another — or `undefined` while either is not known. */
    const now = useCallback((): Asked | undefined => {
        const { part, where, revision } = latest.current;
        if (part === undefined || where === undefined || revision === undefined) return undefined;
        const key = `${revision}\u0000${printWhere(where)}`;
        if (!stringEqual(held.current.key, key)) held.current = { key, states: new Map(), asked: new Set() };
        return held.current;
    }, []);

    /**
     * Asks every question of some rows the narrowing hides, each one request holding all of them, and keeps what each
     * row's answers say hides it — at the revision and the narrowing asked at, while they stand.
     */
    const answer = useCallback((at: Asked, ids: readonly string[], rows: readonly { key: unknown; row: unknown }[]) => {
        const { part, where, name } = latest.current;
        if (part === undefined || where === undefined) return;
        const indexes = part.config.indexes;
        const questions = hidingQuestions(indexes, where);
        void awaitTracked(() => {
            // Every question asked in one turn, so its reads go together.
            const asked = questions.map((q) => recordSliceWithin(part, q.where, rows));
            const answers: boolean[][] = [];
            for (const a of asked) {
                if (a.type === "none") return none;
                answers.push(a.value);
            }
            return some(answers);
        }).then((answers) => {
            if (!Object.is(now(), at)) return;
            ids.forEach((id, j) => {
                const verdict = hidingOf(questions, answers.map((a) => a[j]!));
                at.states.set(id, { hidden: true, answer: verdict === undefined ? undefined : clearingOf(indexes, where, verdict) });
            });
            setVersion((v) => v + 1);
        }, (error: unknown) => {
            // Not told: each line goes on saying the filters hide the row, and a pick of it clears every one.
            console.error(`[${name}] could not read which filters hide a row:`, error);
        });
    }, [now]);

    const askListed = useCallback((from: number, ids: readonly string[], holds: readonly boolean[]) => {
        const at = now();
        const { part, idOf, name } = latest.current;
        if (at === undefined || part === undefined) return;
        const asking: number[] = [];
        ids.forEach((id, i) => {
            if (holds[i]) { if (!at.states.has(id)) at.states.set(id, SHOWN); return; }
            if (!at.states.has(id)) at.states.set(id, HIDDEN);
            if (at.asked.has(id)) return;
            at.asked.add(id);
            asking.push(i);
        });
        if (asking.length === 0) return;
        // Their rows as the record holds them: the page the listing read them from, held already.
        void awaitTracked(() => recordSlicePage(part, WHOLE_RECORD, BigInt(from), BigInt(ids.length))).then((page) => {
            if (!Object.is(now(), at)) return;
            const entries = page as readonly RecordSliceEntry[];
            const rows = asking.map((i) => {
                const entry = entries[i];
                if (entry === undefined || entry.row?.type !== "some" || !stringEqual(idOf(entry.key), ids[i]!)) {
                    throw new Error("The record's rows moved while they were listed");
                }
                return { key: entry.key, row: entry.row.value };
            });
            answer(at, asking.map((i) => ids[i]!), rows);
        }).catch((error: unknown) => {
            console.error(`[${name}] could not read the listed rows the filters hide:`, error);
        });
    }, [now, answer]);

    const askIds = useCallback((ids: readonly string[], hidden = false) => {
        const at = now();
        const { part, where, keyOf, name } = latest.current;
        if (at === undefined || part === undefined || where === undefined) return;
        const asking: { id: string; key: unknown }[] = [];
        for (const id of ids) {
            // Known hidden, a row says so at once — `hidden by the filters` — while e3 is asked which choices hide it.
            if (hidden && !at.states.has(id)) at.states.set(id, HIDDEN);
            if (at.asked.has(id)) continue;
            at.asked.add(id);
            const key = keyOf(id);
            if (key.type === "some") asking.push({ id, key: key.value });
        }
        if (asking.length === 0) return;
        void awaitTracked(() => {
            // Their rows as the record holds them, by their keys in one request, and which of them the narrowing holds in
            // one more — unless it is known to hide them all.
            const rows = recordSliceRows(part, asking.map(({ key }) => key));
            if (rows.type === "none") return none;
            const stored = asking.flatMap(({ id, key }, i) => {
                const row = rows.value[i]!;
                return row.type === "some" ? [{ id, key, row: row.value }] : [];
            });
            if (hidden) return some({ stored, inside: stored.map(() => false) });
            const inside = stored.length === 0 ? some<boolean[]>([]) : recordSliceWithin(part, where, stored.map(({ key, row }) => ({ key, row })));
            return inside.type === "none" ? none : some({ stored, inside: inside.value });
        }).then(({ stored, inside }) => {
            if (!Object.is(now(), at)) return;
            // A key the record holds no row by is a new row's: the builder draws it among the rows, and nothing hides it.
            for (const { id } of asking) at.states.set(id, SHOWN);
            const hidden = stored.filter((_row, i) => !inside[i]);
            for (const { id } of hidden) at.states.set(id, HIDDEN);
            setVersion((v) => v + 1);
            if (hidden.length > 0) answer(at, hidden.map(({ id }) => id), hidden.map(({ key, row }) => ({ key, row })));
        }, (error: unknown) => {
            console.error(`[${name}] could not read whether the filters hide the rows asked of:`, error);
        });
    }, [now, answer]);

    const stateOf = useCallback((id: string): HiddenState | undefined => now()?.states.get(id), [now]);
    return useMemo(() => ({ askListed, askIds, stateOf, version }), [askListed, askIds, stateOf, version]);
}

/**
 * The revision a source's record is read at, tracked: what a builder that
 * reads the record through its part — not through a lens of its own — keeps
 * its hidden pick's answers by.
 *
 * @param part - The source's part of the slice; `undefined` with none
 * @returns Its revision; `undefined` while it is not known, or with no part
 */
export function usePartRevision(part: Bind | undefined): string | undefined {
    const read = useCallback((): option<string> => (part === undefined ? none : recordSliceRevision(part)), [part]);
    const { result } = useTrackedEvaluation(read);
    return result.ok && result.value.type === "some" ? result.value.value : undefined;
}

/** A source's rows by their keys, as every source a builder binds through `recordSources` keys them: by String, a row's id its key. */
const stringKey = (id: string): option<unknown> => some(id);
const stringId = (key: unknown): string => key as string;

/** The hidden pick over one source, read through its part (see {@link useSourceHidden}). */
export interface SourceHidden {
    /** The pick's reads, and what they have been told. */
    readonly rows: HiddenRows;
    /** The source's part of the slice; `undefined` with none. */
    readonly part: Bind | undefined;
    /** Its narrowing now; `undefined` with no part. */
    readonly where: Where | undefined;
}

/**
 * The hidden pick over one source of a builder's `Slice.bindRecords`, read
 * through its part — never through a lens of its own, as the Sheet's is — its
 * rows keyed by String, as `recordSources` binds every source: its narrowing
 * followed as a choice moves it, its answers kept by its record's revision:
 * the Allocation's lanes, resources and arrivals, and the Roster's people.
 *
 * @param name - Who asks, as its console names it when a read fails
 * @param part - The source's part of the slice; `undefined` with none
 * @returns The pick, the part and its narrowing
 */
export function useSourceHidden(name: string, part: Bind | undefined): SourceHidden {
    // Its narrowing, read again as a choice moves it.
    const moved = useSliceReactivity(part?.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a choice moves `moved`, which the part's `read()` follows
    const where = useMemo(() => part?.read().where, [part, moved]);
    const rows = useHiddenRows({ name, part, where, revision: usePartRevision(part), keyOf: stringKey, idOf: stringId });
    return useMemo(() => ({ rows, part, where }), [rows, part, where]);
}

/**
 * Clears the choices that hide a row, as the rail clears a choice: those e3
 * named — and what goes with them — else, while it has not said, every choice
 * of the source; the source's narrowing written once, a write of the rail like
 * a chip's.
 *
 * @param part - The source's part of the slice
 * @param answer - What e3 said hides the row; `undefined` while it has not
 */
export function clearHiding(part: Bind, answer: HiddenAnswer | undefined): void {
    part.write({ ...part.read(), where: answer?.where ?? WHOLE_RECORD, preset: none });
}
