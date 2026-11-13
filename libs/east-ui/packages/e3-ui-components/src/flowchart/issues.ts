/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's issues (#1504, `Flowchart Records Spec.md` R6, R7, R11,
 * R12, R16, D3, D12) — pure and React-free: what the inspector's Issues tab
 * lists, each naming what a click on it selects, and the field it names, if
 * any, which the click asks of its row's Details.
 *
 * - **An end no state is keyed by** — a transition's end the canvas draws as a
 *   ghost. Under `"hide"` such an end is read by key first: one the states'
 *   narrowing hides takes its transition off the canvas with it, and is no
 *   issue (D7).
 * - **A state whose lane names no lane** — or that names none, while lanes are
 *   given — drawn in the last band, *No lane* (D12).
 * - **A transition whose decision names none** of the decisions the Flowchart
 *   is given.
 * - **The details' counts no bin holds** — a row's histogram counting at no
 *   edge of the flowchart's bins, or counting what is no count — and **the bins
 *   the app binds** that hold no edge, one that is no finite number, or two
 *   that do not ascend (R38, `details.ts`). A details row keyed as no row drawn
 *   is no issue.
 * - **A number its field's bounds don't hold** (#1585) — a row drawn whose
 *   number is under its least or over its most, by its field's label and the
 *   bound in its hint's own words, `Slices: at least 1`. A changed row's is
 *   its session's readiness, which holds Save off; any other row's warns.
 * - **A draft waiting in its session**, the narrowing hiding its row: listed
 *   with the rows of the rail's sources whose narrowing leaves it out, which the
 *   inspector names the choices of (the shared hidden pick) and Go to issue
 *   clears (R11).
 * - **The app's `ready` refusals** — the key check's among them, a new key e3
 *   holds already (D3) — which hold Save off (R12).
 * - **A Save's conflict or refusal**, while it stands.
 *
 * The last two block, and come first; the rest warn, and Save goes ahead with
 * them. What the narrowing draws as context (`"dim"`) raises no issue: no path
 * selects it.
 *
 * A Save's conflict names each side's value as the canvas names that row — a
 * state's lane by the lane's label, a transition's ends by their states' and
 * its decision by the decision's — never a key ({@link conflictValueName}),
 * each read at the key type of the kind it names (#1549).
 *
 * @packageDocumentation
 */

import { OptionType, StringType, equalFor, fromEastTypeValue, isValueOf, type PatchPath, type option } from "@elaraai/east";
import type { EditIssue, EditSession, FieldBreach } from "@elaraai/east-ui-components";
import { breachOf } from "../shared/bounds.js";
import type { FlowchartBinsRefusalWord, FlowchartDetailsFinding } from "./details.js";
import type { FlowchartWaiting } from "./drafted.js";
import type { FlowchartDecisionRoles, FlowchartModel, FlowchartRow, FlowchartTransitionRoles } from "./model.js";
import type { FlowchartSort } from "./read.js";
import type { FlowchartSelection } from "./selection.js";

const keyEqual = equalFor(StringType);

/** A row of a source of the rail whose narrowing leaves out what an issue names: the source's kind, and the row's key. */
export interface FlowchartHiding {
    /** The kind read through the source. */
    readonly sort: "states" | "transitions";
    /** The row's key in its record. */
    readonly key: string;
}

/** What an issue says, before its words. */
export type FlowchartIssueWord =
    /** A transition, named by its ends, naming states no row is keyed by — by their keys. */
    | { readonly issue: "end"; readonly link: string; readonly missing: readonly string[] }
    /** A state naming a lane the Flowchart has none of, by its key — or naming none. */
    | { readonly issue: "lane"; readonly state: string; readonly lane: string | undefined }
    /** A transition, named by its ends, naming a decision the Flowchart has none of, by its key. */
    | { readonly issue: "decision"; readonly link: string; readonly decision: string }
    /** A row's histogram holding counts no bin holds, by the row's name and the read's label. */
    | { readonly issue: "counts"; readonly name: string; readonly read: string }
    /** A histogram's bins, as the app binds them, refused, by the read's label: why, its numbers in the app's locale. */
    | { readonly issue: "bins"; readonly read: string; readonly refusal: FlowchartBinsRefusalWord }
    /**
     * The rail's source whose picks would weigh a kind's details narrowing another record than they read (#1522), by
     * the kind's name and the source's: the details draw each row's own.
     */
    | { readonly issue: "weighed"; readonly kind: string; readonly source: string }
    /** A change waiting on Save that the narrowing hides, by the row's name. */
    | { readonly issue: "waiting"; readonly name: string }
    /** The app's check — or the key check — refusing a drafted row, which holds Save off, in its own words. */
    | { readonly issue: "ready"; readonly message: string }
    /** A number its field's bounds don't hold (#1585): its field's label, and the bound in its hint's own words. */
    | { readonly issue: "bounds"; readonly field: string; readonly bound: string }
    /** A Save's conflict or refusal, in the source's own words. */
    | { readonly issue: "save"; readonly message: string };

/** One issue, as the Issues tab lists it. */
export interface FlowchartIssue {
    /** What a click on it selects, as the canvas selects it; `null`, the Flowchart itself — what nothing selected shows. */
    readonly at: FlowchartSelection | null;
    /** Whether it blocks — the app's check holds Save, or a Save was stopped — rather than warns. */
    readonly blocking: boolean;
    /** What it names: its kind — `undefined` for a record's words that name no row — and its name, as the Flowchart names it. */
    readonly where: { readonly sort: FlowchartSort | undefined; readonly name: string };
    /**
     * The rows of the rail's sources whose narrowing leaves out what it names — a draft waiting in its session: its own
     * row, or a transition's ends the states' narrowing hides; none for what the canvas draws.
     */
    readonly hiding: readonly FlowchartHiding[];
    /** What it says. */
    readonly word: FlowchartIssueWord;
    /**
     * The field it names, by its form's key: a click on it asks its row's Details for it, and it takes the keyboard
     * there, as it does for the toolbar's issue gone to. `undefined` for an issue naming none.
     */
    readonly field?: string | undefined;
}

/** A number its field's bounds don't hold, as Issues says it (#1585). */
export interface FlowchartBreachWords {
    /** Its field's label. */
    readonly field: string;
    /** The bound, in its field's hint's own words — `at least 1`. */
    readonly bound: string;
}

/** A row drawn whose number its field's bounds don't hold, no change of it holding Save (#1585). */
export interface FlowchartBreach extends FlowchartBreachWords {
    /** Its kind. */
    readonly sort: FlowchartSort;
    /** Its key. */
    readonly key: string;
    /** The field, by its form's key: what a click on its issue asks of its row's Details. */
    readonly fieldKey: string;
}

/** What the issues are worked out from. */
export interface FlowchartIssueArgs {
    /** What the canvas draws, the drafts in place. */
    readonly model: FlowchartModel;
    /** The transitions it draws, the drafts in place — those in place among them. */
    readonly transitions: readonly FlowchartRow<FlowchartTransitionRoles>[];
    /** The drafted rows waiting in their sessions (`drafted.ts`). */
    readonly waiting: readonly FlowchartWaiting[];
    /** The transitions held but hidden with their far end (`read.ts`' `hiddenWith`). */
    readonly hiddenWith: ReadonlySet<string>;
    /** The states the read holds, by key: a waiting transition's end it does not hold is one the narrowing hides. */
    readonly stored: ReadonlyMap<string, unknown>;
    /** Whether the Flowchart is given decisions: a transition naming one it has none of is an issue only then. */
    readonly decisions: boolean;
    /** What the details model finds (`details.ts`): the bins the app binds refused, and the rows' counts no bin holds. */
    readonly details: readonly FlowchartDetailsFinding[];
    /** The rows drawn whose numbers their fields' bounds don't hold, none of them changed so (#1585); none unless given. */
    readonly breaches?: readonly FlowchartBreach[] | undefined;
}

/**
 * What the canvas selects a row of a kind as, by its key.
 *
 * @param sort - The row's kind
 * @param key - Its key
 * @returns The selection
 */
export function selectionOf(sort: FlowchartSort, key: string): FlowchartSelection {
    switch (sort) {
        case "states": return { kind: "state", key };
        case "transitions": return { kind: "link", key };
        case "lanes": return { kind: "lane", key };
        case "decisions": return { kind: "trigger", key };
    }
}

/** How the issues name rows, and what hides one that waits. */
interface IssueReader {
    /**
     * A row's name, as the inspector's head names it: a state by its key, a transition by its ends' keys, a lane by its
     * label — else its key — and a decision by its diamond's letter.
     */
    readonly nameOf: (sort: FlowchartSort, key: string) => string;
    /** The rows of the rail's sources whose narrowing leaves out a row waiting in its session; none for a row drawn. */
    readonly hidingOf: (sort: FlowchartSort, key: string) => readonly FlowchartHiding[];
}

/**
 * A decision's diamond's letter, as the model gives it: its own, else its label's first, upper case.
 *
 * @param roles - The decision's roles
 * @returns The letter
 */
function letterOf(roles: FlowchartDecisionRoles): string {
    if (roles.letter.type === "some") return roles.letter.value;
    return roles.label.length > 0 ? roles.label.charAt(0).toUpperCase() : "?";
}

/** The issues' namer over what they are worked out from. */
function readerOf(args: FlowchartIssueArgs): IssueReader {
    const { model, transitions, waiting, hiddenWith, stored } = args;
    const waits = (sort: FlowchartSort, key: string): FlowchartWaiting | undefined =>
        waiting.find((row) => row.sort === sort && keyEqual(row.key, key));
    const nameOf = (sort: FlowchartSort, key: string): string => {
        switch (sort) {
            case "states": return key;
            case "transitions": {
                const drawn = transitions.find((t) => keyEqual(t.key, key))?.roles;
                const row = waits("transitions", key);
                const roles = drawn ?? (row?.sort === "transitions" ? row.roles : undefined);
                return roles === undefined ? key : `${roles.from} → ${roles.to}`;
            }
            case "lanes": {
                const lane = model.lanes.find((l) => l.band === "lane" && keyEqual(l.key, key));
                if (lane !== undefined) return lane.label;
                const row = waits("lanes", key);
                return row?.sort === "lanes" && row.roles.label.length > 0 ? row.roles.label : key;
            }
            case "decisions": {
                const trigger = model.triggers.get(key);
                if (trigger !== undefined) return trigger.letter;
                const row = waits("decisions", key);
                return row?.sort === "decisions" ? letterOf(row.roles) : key;
            }
        }
    };
    const hidingOf = (sort: FlowchartSort, key: string): readonly FlowchartHiding[] => {
        const row = waits(sort, key);
        if (row === undefined) return [];
        if (row.sort === "states") return [{ sort: "states", key }];
        if (row.sort !== "transitions") return [];
        if (!hiddenWith.has(key)) return [{ sort: "transitions", key }];
        // Hidden with its far end: the end the states' narrowing hides — the read holds no state of its key.
        const { from, to } = row.roles;
        return [from, to].filter((end, i) => !stored.has(end) && (i === 0 || !keyEqual(from, to))).map((end) => ({ sort: "states" as const, key: end }));
    };
    return { nameOf, hidingOf };
}

/**
 * The Flowchart's own issues (see the module docs), each a warning: the states
 * standing in *No lane*, in their band's order; then the transitions', in
 * their keys' order at their key type — an end no state is keyed by, a decision
 * the Flowchart has none of;
 * then the details', as the details model finds them — each kind's refused
 * bins, naming the kind and selecting the Flowchart, then its rows' counts no
 * bin holds, each selecting its row; then the rows' numbers their fields'
 * bounds don't hold, as given, each naming its field; then each draft waiting
 * in its session, each kind's in its drafts' order.
 *
 * @param args - What the canvas draws, its transitions, the drafts waiting, the transitions hidden with their far end,
 *   the states read, whether decisions are given, what the details model finds, and the rows' breaches
 * @returns The issues
 */
export function flowchartIssues(args: FlowchartIssueArgs): FlowchartIssue[] {
    const { model, transitions, waiting, decisions, details } = args;
    const { nameOf, hidingOf } = readerOf(args);
    const out: FlowchartIssue[] = [];
    const warn = (at: FlowchartSelection, where: FlowchartIssue["where"], word: FlowchartIssueWord, hiding: readonly FlowchartHiding[] = [], field?: string) =>
        out.push({ at, blocking: false, where, hiding, word, field });
    for (const key of model.noLane) {
        const node = model.nodesByKey.get(key);
        if (node === undefined || node.dimmed) continue;
        warn({ kind: "state", key }, { sort: "states", name: key }, { issue: "lane", state: key, lane: node.lane });
    }
    const ghost = (key: string): boolean => model.nodesByKey.get(key)?.ghost === true;
    const byKey = new Map(transitions.map((transition) => [transition.key, transition] as const));
    for (const { text } of model.keys.transitions.order(byKey.keys())) {
        const transition = byKey.get(text)!;
        if (transition.dimmed) continue;
        const { key } = transition;
        const { from, to } = transition.roles;
        const link = nameOf("transitions", key);
        const where = { sort: "transitions" as const, name: link };
        const missing = [from, to].filter((end, i) => ghost(end) && (i === 0 || !keyEqual(from, to)));
        if (missing.length > 0) warn({ kind: "link", key }, where, { issue: "end", link, missing });
        const decision = transition.roles.decision;
        if (decisions && decision.type === "some" && !model.triggers.has(decision.value)) {
            warn({ kind: "link", key }, where, { issue: "decision", link, decision: decision.value });
        }
    }
    // What the narrowing draws as context raises none: no path selects it.
    const dimmed = (sort: "states" | "transitions", key: string): boolean => (sort === "states"
        ? model.nodesByKey.get(key)?.dimmed === true
        : transitions.some((t) => t.dimmed && keyEqual(t.key, key)));
    for (const found of details) {
        if (found.finding === "bins") {
            out.push({ at: null, blocking: false, where: { sort: undefined, name: found.kind }, hiding: [], word: { issue: "bins", read: found.read, refusal: found.refusal } });
            continue;
        }
        if (found.finding === "weighed") {
            out.push({ at: null, blocking: false, where: { sort: undefined, name: found.kind }, hiding: [], word: { issue: "weighed", kind: found.kind, source: found.source } });
            continue;
        }
        if (dimmed(found.sort, found.key)) continue;
        const name = nameOf(found.sort, found.key);
        warn(selectionOf(found.sort, found.key), { sort: found.sort, name }, { issue: "counts", name, read: found.read });
    }
    for (const breach of args.breaches ?? []) {
        warn(selectionOf(breach.sort, breach.key), { sort: breach.sort, name: nameOf(breach.sort, breach.key) },
            { issue: "bounds", field: breach.field, bound: breach.bound }, [], breach.fieldKey);
    }
    for (const row of waiting) {
        const name = nameOf(row.sort, row.key);
        warn(selectionOf(row.sort, row.key), { sort: row.sort, name }, { issue: "waiting", name }, hidingOf(row.sort, row.key));
    }
    return out;
}

/** A record's session as Issues reads it: the kind it is, and where its Save stands. */
export interface FlowchartIssueSession {
    /** The record's key in the history: its kind. */
    readonly kind: string;
    /** Its session: where its latest Save stands, its source's words, and its drafts' readiness. */
    readonly session: Pick<EditSession<unknown>, "status" | "issues" | "readiness">;
}

/** Whether a record's key in the history names one of the Flowchart's kinds. */
function isSort(kind: string): kind is FlowchartSort {
    return kind === "states" || kind === "transitions" || kind === "lanes" || kind === "decisions";
}

/**
 * The issues each record's session raises (see the module docs): the app's
 * check — the key check's among it — refusing its drafted rows, a changed
 * row's number its field's bounds don't hold among them, and its latest Save's
 * conflict or refusal while it stands; each blocking, naming its row — one
 * waiting in its session with the rows of the rail's sources hiding it — and
 * the field the source's issue names.
 *
 * @param sessions - Each record's session
 * @param args - What the canvas draws, as {@link flowchartIssues} takes it: what names a row, and what hides one waiting
 * @param kindName - A kind's name, as the payload gives it: what a record's words that name no row stand for
 * @param breachWords - A breach of a kind's form in Issues' words (#1585): its field's label and its bound; a breach
 *   says its bound alone unless given
 * @returns The issues, in the sessions' order
 */
export function sessionIssues(sessions: readonly FlowchartIssueSession[], args: FlowchartIssueArgs,
    kindName: (sort: FlowchartSort) => string, breachWords?: (sort: FlowchartSort, breach: FieldBreach) => FlowchartBreachWords): FlowchartIssue[] {
    const { nameOf, hidingOf } = readerOf(args);
    const out: FlowchartIssue[] = [];
    for (const part of sessions) {
        if (!isSort(part.kind)) continue;
        const sort = part.kind;
        const raise = (issue: EditIssue, word: FlowchartIssueWord) => {
            // The source's own words name no row: they stand for the kind's record.
            const row = keyEqual(issue.entry, "") ? undefined : issue.entry;
            out.push({
                at: row === undefined ? null : selectionOf(sort, row), blocking: true,
                where: { sort: row === undefined ? undefined : sort, name: row === undefined ? kindName(sort) : nameOf(sort, row) },
                hiding: row === undefined ? [] : hidingOf(sort, row),
                word,
                field: row === undefined || issue.field.type !== "some" ? undefined : issue.field.value,
            });
        };
        const readiness = part.session.readiness;
        if (readiness.type !== "ready") {
            for (const issue of readiness.value) {
                const breach = breachOf(issue);
                raise(issue, breach === undefined || breachWords === undefined ? { issue: "ready", message: issue.message }
                    : { issue: "bounds", ...breachWords(sort, breach) });
            }
        }
        const status = part.session.status;
        if (status === "conflict" || status === "rejected") for (const issue of part.session.issues) raise(issue, { issue: "save", message: issue.message });
    }
    return out;
}

/** The fields the kinds' roles name another row's key in (#1503): what a conflict on one is named by. */
export interface FlowchartKeyFields {
    /** The field of a state naming its lane by the lane's key; `undefined` without lanes. */
    readonly lane: string | undefined;
    /** The fields of a transition naming its ends by their states' keys; `undefined` without transitions. */
    readonly ends: readonly [from: string, to: string] | undefined;
    /** The field of a transition naming its decision by the decision's key; `undefined` without one. */
    readonly decision: string | undefined;
}

/**
 * A conflict's value as the canvas names that row, where the value is a key
 * (#1503): a state's lane by the lane's label, a transition's end by its
 * state's label and its decision by the decision's — never a key, as the
 * history bar's conflict card shows each side and what it was.
 *
 * @param sort - The kind whose row conflicts
 * @param path - The conflict's path in the row: one field, through the case of an Option
 * @param value - The value on one side: a key at the key type of the kind its field names (#1549), or an `Option` of one
 * @param fields - The fields the kinds' roles name a key in
 * @param model - The flowchart as its drafts stand, which names each row and holds each kind's keys
 * @returns Its name, or the key's text for a row the flowchart holds none of; `undefined` for any other value, which the card reads as it is
 */
export function conflictValueName(sort: FlowchartSort, path: PatchPath, value: unknown, fields: FlowchartKeyFields, model: FlowchartModel): string | undefined {
    let named: string | undefined;
    for (const step of path) {
        if (step.kind !== "field") continue;
        if (named !== undefined) return undefined;
        named = step.name;
    }
    const field = named;
    if (field === undefined) return undefined;
    const is = (name: string | undefined): boolean => name !== undefined && keyEqual(name, field);
    // The kind the field names a row of.
    const names = sort === "states" ? (is(fields.lane) ? "lanes" : undefined)
        : sort !== "transitions" ? undefined
        : fields.ends !== undefined && (is(fields.ends[0]) || is(fields.ends[1])) ? "states"
        : is(fields.decision) ? "decisions" : undefined;
    if (names === undefined) return undefined;
    const keys = model.keys[names];
    const keyType = fromEastTypeValue(keys.keyType);
    let key: { readonly at: unknown } | undefined;
    if (isValueOf(value, keyType)) key = { at: value };
    else if (isValueOf(value, OptionType(keyType))) {
        const held = value as option<unknown>;
        if (held.type === "some") key = { at: held.value };
    }
    if (key === undefined) return undefined;
    const text = keys.textOf(key.at);
    switch (names) {
        case "lanes": return model.lanes.find((lane) => keyEqual(lane.key, text))?.label ?? text;
        case "states": return model.nodesByKey.get(text)?.label ?? text;
        case "decisions": return model.triggers.get(text)?.label ?? text;
    }
}
