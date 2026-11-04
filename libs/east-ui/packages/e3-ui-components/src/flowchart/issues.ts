/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's issues (#1504, `Flowchart Records Spec.md` R6, R7, R11,
 * R12, R16, D3, D12) — pure and React-free: what the inspector's Issues tab
 * lists, each naming what a click on it selects.
 *
 * - **An end no state is keyed by** — a transition's end the canvas draws as a
 *   ghost. Under `"hide"` such an end is read by key first: one the states'
 *   narrowing hides takes its transition off the canvas with it, and is no
 *   issue (D7).
 * - **A state whose lane names no lane** — or that names none, while lanes are
 *   given — drawn in the last band, *No lane* (D12).
 * - **A transition whose decision names none** of the decisions the Flowchart
 *   is given.
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
 * its decision by the decision's — never a key ({@link conflictValueName}).
 *
 * @packageDocumentation
 */

import { OptionType, StringType, compareFor, equalFor, isValueOf, type PatchPath, type ValueTypeOf } from "@elaraai/east";
import type { EditIssue, EditSession } from "@elaraai/east-ui-components";
import type { FlowchartWaiting } from "./drafted.js";
import type { FlowchartDecisionRoles, FlowchartModel, FlowchartRow, FlowchartTransitionRoles } from "./model.js";
import type { FlowchartSort } from "./read.js";
import type { FlowchartSelection } from "./selection.js";

const keyEqual = equalFor(StringType);
const keyCompare = compareFor(StringType);

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
    /** A change waiting on Save that the narrowing hides, by the row's name. */
    | { readonly issue: "waiting"; readonly name: string }
    /** The app's check — or the key check — refusing a drafted row, which holds Save off, in its own words. */
    | { readonly issue: "ready"; readonly message: string }
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
 * standing in *No lane*, in their band's order; then the transitions', in key
 * order — an end no state is keyed by, a decision the Flowchart has none of;
 * then each draft waiting in its session, each kind's in its drafts' order.
 *
 * @param args - What the canvas draws, its transitions, the drafts waiting, the transitions hidden with their far end,
 *   the states read, and whether decisions are given
 * @returns The issues
 */
export function flowchartIssues(args: FlowchartIssueArgs): FlowchartIssue[] {
    const { model, transitions, waiting, decisions } = args;
    const { nameOf, hidingOf } = readerOf(args);
    const out: FlowchartIssue[] = [];
    const warn = (at: FlowchartSelection, where: FlowchartIssue["where"], word: FlowchartIssueWord, hiding: readonly FlowchartHiding[] = []) =>
        out.push({ at, blocking: false, where, hiding, word });
    for (const key of model.noLane) {
        const node = model.nodesByKey.get(key);
        if (node === undefined || node.dimmed) continue;
        warn({ kind: "state", key }, { sort: "states", name: key }, { issue: "lane", state: key, lane: node.lane });
    }
    const ghost = (key: string): boolean => model.nodesByKey.get(key)?.ghost === true;
    for (const transition of [...transitions].sort((a, b) => keyCompare(a.key, b.key))) {
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
 * check — the key check's among it — refusing its drafted rows, and its latest
 * Save's conflict or refusal while it stands; each blocking, naming its row —
 * one waiting in its session with the rows of the rail's sources hiding it.
 *
 * @param sessions - Each record's session
 * @param args - What the canvas draws, as {@link flowchartIssues} takes it: what names a row, and what hides one waiting
 * @param kindName - A kind's name, as the payload gives it: what a record's words that name no row stand for
 * @returns The issues, in the sessions' order
 */
export function sessionIssues(sessions: readonly FlowchartIssueSession[], args: FlowchartIssueArgs,
    kindName: (sort: FlowchartSort) => string): FlowchartIssue[] {
    const { nameOf, hidingOf } = readerOf(args);
    const out: FlowchartIssue[] = [];
    for (const part of sessions) {
        if (!isSort(part.kind)) continue;
        const sort = part.kind;
        const raise = (issue: EditIssue, word: "ready" | "save") => {
            // The source's own words name no row: they stand for the kind's record.
            const row = keyEqual(issue.entry, "") ? undefined : issue.entry;
            out.push({
                at: row === undefined ? null : selectionOf(sort, row), blocking: true,
                where: { sort: row === undefined ? undefined : sort, name: row === undefined ? kindName(sort) : nameOf(sort, row) },
                hiding: row === undefined ? [] : hidingOf(sort, row),
                word: { issue: word, message: issue.message },
            });
        };
        const readiness = part.session.readiness;
        if (readiness.type !== "ready") for (const issue of readiness.value) raise(issue, "ready");
        const status = part.session.status;
        if (status === "conflict" || status === "rejected") for (const issue of part.session.issues) raise(issue, "save");
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
 * @param value - The value on one side: a key, in a `String` or an `Option` of one
 * @param fields - The fields the kinds' roles name a key in
 * @param model - The flowchart as its drafts stand, which names each row
 * @returns Its name, or the key itself for a row the flowchart holds none of; `undefined` for any other value, which the card reads as it is
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
    let key: string | undefined;
    if (isValueOf(value, StringType)) key = value as string;
    else if (isValueOf(value, OptionType(StringType))) {
        const option = value as ValueTypeOf<OptionType<StringType>>;
        if (option.type === "some") key = option.value;
    }
    if (key === undefined) return undefined;
    const held = key;
    const is = (name: string | undefined): boolean => name !== undefined && keyEqual(name, field);
    switch (sort) {
        case "states":
            return is(fields.lane) ? model.lanes.find((lane) => keyEqual(lane.key, held))?.label ?? held : undefined;
        case "transitions":
            if (fields.ends !== undefined && (is(fields.ends[0]) || is(fields.ends[1]))) return model.nodesByKey.get(held)?.label ?? held;
            return is(fields.decision) ? model.triggers.get(held)?.label ?? held : undefined;
        default:
            return undefined;
    }
}
