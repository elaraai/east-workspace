/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A test-only hook on the showcase's in-page e3 (#1398): it holds, fails and
 * releases the page's requests of its e3, by what they ask and the dataset
 * they name, so the responsive suite can measure what a builder draws while a
 * read is in flight, or once it has failed — the footer's loading line in
 * each of its forms, a failure with its Retry. It also applies a record's
 * mutation of the spec's own, as another session would (#1393): the budget
 * run fills a floor through its patch doors so.
 *
 * It is installed only when a spec asks for it before the page loads, by
 * setting {@link FAULTS_FLAG} on the window through `page.addInitScript`; the
 * showcase is never published, so no page a person opens has it. Installed,
 * it wraps the e3's `fetch`, which every request the page makes of its e3
 * goes through — its start's and its examples' — and puts its controls on the
 * window ({@link FAULTS_CONTROLS}). Without a hold or a fault, a request goes
 * to e3 as it would. A spec's own mutation goes to e3 past it: no hold or
 * fault takes it, and the log never lists it.
 *
 * A request's kind and dataset are read from its route as e3's API server
 * routes it, as e3-ui-components' test harness reads them
 * (`e3-web.test-utils.ts`' `e3RequestOf`).
 *
 * @packageDocumentation
 */

import { none, some } from "@elaraai/east";
import { workspaceRecordMutate } from "@elaraai/e3-api-client";
import type { WebE3 } from "@elaraai/e3-web";

/** What a spec sets on the window, before the page loads, to install the hook: `true`. */
export const FAULTS_FLAG = "__showcaseE3Faults";

/** Where the installed hook puts its controls on the window: a {@link ShowcaseE3Faults}. */
export const FAULTS_CONTROLS = "showcaseE3Faults";

/**
 * What a request asks e3, as the hook names it: a builder's reads — a page, a
 * key search, rows or runs by key, a narrowing's placement or membership — a
 * read of a dataset whole, a write, a dataset's status, a record's mutation,
 * its history or its description, a function's call, or anything else.
 */
export type FaultKind =
    | "page" | "find" | "rows" | "runs" | "place" | "within" | "read" | "write" | "dataset-status"
    | "mutate" | "history" | "describe" | "call" | "other";

/** Which requests a hold or a fault takes: every one it names — any kind, or any dataset, where it names none. */
export interface FaultMatch {
    /** The kinds it takes. */
    readonly kinds?: readonly FaultKind[] | undefined;
    /** The dataset it takes, its path's fields joined by dots, as a record's reads name it (`records.roster_duties`). */
    readonly dataset?: string | undefined;
}

/** How a fault answers: as e3 answers a failure — its HTTP status, its error's type and message — or as a network fails. */
export type FaultFailure = { readonly status?: number; readonly type?: string; readonly message?: string } | "network";

/** One request the page made of its e3, as the hook logged it. */
export interface FaultRequest {
    readonly kind: FaultKind;
    readonly dataset: string | undefined;
    readonly method: string;
    /** Whether its caller gave it up. */
    readonly aborted: boolean;
    /** What a batch read sent, the JSON naming what it reads — its keys, or the runs that name them; none for any other request. */
    readonly body: string | undefined;
}

/** The hook's controls, on the window once it is installed. */
export interface ShowcaseE3Faults {
    /**
     * Holds each request it matches, from now until released.
     *
     * @returns The hold's id
     */
    hold(match: FaultMatch): number;
    /**
     * Answers each request it matches as the failure says — as e3 answers a
     * failure, a 500 unless given another — from now until released.
     *
     * @returns The fault's id
     */
    fail(match: FaultMatch, failure?: FaultFailure): number;
    /** Lets every request a hold holds go on to e3, and holds no more; or stops a fault. */
    release(id: number): void;
    /** How many requests a hold holds now. */
    held(id: number): number;
    /** Each request the page has made since the hook was installed, in order. */
    requests(): readonly FaultRequest[];
    /**
     * Applies a record's mutation as another session would, through e3's API:
     * the spec's own request, which no hold or fault takes and the log never
     * lists.
     *
     * @param workspace - The workspace
     * @param record - The record's name
     * @param mutation - The mutation's name
     * @param args - Its arguments, each its type's beast2, in base64
     * @returns What e3 answered: its outcome's case, `committed` once it applied
     */
    mutate(workspace: string, record: string, mutation: string, args: readonly string[]): Promise<string>;
}

/** A hold or a fault, as the hook keeps it. */
interface Rule {
    readonly id: number;
    readonly match: FaultMatch;
    live: boolean;
    /** A fault's answer; a hold has none. */
    readonly failure?: FaultFailure | undefined;
    /** What lets each request a hold parks go, the oldest first. */
    readonly parked: (() => void)[];
}

/** A logged request, its caller's signal kept to say whether it was given up. */
interface Logged {
    readonly kind: FaultKind;
    readonly dataset: string | undefined;
    readonly method: string;
    readonly signal: AbortSignal;
    readonly body: string | undefined;
}

/** The kinds of a batch read: a POST whose JSON body names what it reads. */
const BATCHES: readonly FaultKind[] = ["find", "rows", "runs", "place", "within"];

/**
 * What a request asks e3 and the dataset it names, read from its route.
 *
 * @param method - Its method
 * @param url - Its URL
 * @returns Its kind, and its dataset when it names one
 */
function classify(method: string, url: URL): { kind: FaultKind; dataset: string | undefined } {
    const after = url.pathname.replace(/^\/api\/?/, "");
    const path = after === "" ? [] : after.split("/").map((segment) => decodeURIComponent(segment));
    // repos/<repo>/workspaces/<ws>/<area>/…
    if (path[0] !== "repos" || path[2] !== "workspaces" || path[3] === undefined) return { kind: "other", dataset: undefined };
    const query = url.searchParams;
    const rest = path.slice(5);
    switch (path[4]) {
        case "datasets": {
            const dataset = rest.length === 0 ? undefined : rest.join(".");
            const post = method === "POST";
            if (post && query.get("findKeys") === "true") return { kind: "find", dataset };
            if (post && query.get("rows") === "true") return { kind: "rows", dataset };
            if (post && query.get("runs") === "true") return { kind: "runs", dataset };
            if (post && query.get("place") === "true") return { kind: "place", dataset };
            if (post && query.get("within") === "true") return { kind: "within", dataset };
            if (method !== "GET") return { kind: "write", dataset };
            if (query.get("find") === "true") return { kind: "find", dataset };
            if (query.get("page") === "true") return { kind: "page", dataset };
            if (query.get("status") === "true" || query.get("list") === "true" || dataset === undefined) return { kind: "dataset-status", dataset };
            return { kind: "read", dataset };
        }
        case "records":
            return { kind: rest[1] === "mutations" ? "mutate" : rest[1] === "history" ? "history" : "describe", dataset: undefined };
        case "functions":
            return { kind: "call", dataset: undefined };
        default:
            return { kind: "other", dataset: undefined };
    }
}

/** Whether a rule takes a request. */
function takes(match: FaultMatch, kind: FaultKind, dataset: string | undefined): boolean {
    return (match.kinds === undefined || match.kinds.includes(kind)) && (match.dataset === undefined || match.dataset === dataset);
}

/** An answer as e3's API server sends a failure: its status, and its error's type and message as JSON. */
function failureResponse(failure: Exclude<FaultFailure, "network">, method: string, url: URL): Response {
    const status = failure.status ?? 500;
    const type = failure.type ?? "internal";
    const message = failure.message ?? `the showcase's fault hook failed ${method} ${url.pathname}`;
    return new Response(JSON.stringify({ error: { type, message } }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * The page's e3, its `fetch` going through the hook — when a spec asked for
 * it before the page loaded ({@link FAULTS_FLAG}); else the e3 as it is.
 *
 * @param e3 - The e3 the page started
 * @param repo - The repository its areas' workspaces are in, which a spec's own mutation names
 * @returns The e3 every request of the page goes to
 */
export function withFaults(e3: WebE3, repo: string): WebE3 {
    const scope = globalThis as unknown as Record<string, unknown>;
    if (scope[FAULTS_FLAG] !== true) return e3;
    const rules: Rule[] = [];
    const log: Logged[] = [];
    let ids = 0;
    const add = (match: FaultMatch, failure?: FaultFailure): number => {
        const id = ++ids;
        rules.push({ id, match, live: true, failure, parked: [] });
        return id;
    };
    const controls: ShowcaseE3Faults = {
        hold: (match) => add(match),
        fail: (match, failure) => add(match, failure ?? {}),
        release(id) {
            const rule = rules.find((candidate) => candidate.id === id);
            if (rule === undefined) return;
            rule.live = false;
            for (const go of rule.parked.splice(0)) go();
        },
        held: (id) => rules.find((candidate) => candidate.id === id)?.parked.length ?? 0,
        requests: () => log.map(({ kind, dataset, method, signal, body }) => ({ kind, dataset, method, aborted: signal.aborted, body })),
        async mutate(workspace, record, mutation, args) {
            const bytes = args.map((arg) => Uint8Array.from(atob(arg), (char) => char.charCodeAt(0)));
            const result = await workspaceRecordMutate(e3.apiUrl, repo, workspace, record, mutation,
                { args: bytes, actor: some("the responsive suite"), limits: none }, { token: null, fetch: e3.fetch });
            return result.outcome.type;
        },
    };
    scope[FAULTS_CONTROLS] = controls;
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const { kind, dataset } = classify(request.method, url);
        // A batch read's body names what it reads: read from a copy, so the request goes on whole.
        const body = request.method === "POST" && BATCHES.includes(kind) ? await request.clone().text() : undefined;
        log.push({ kind, dataset, method: request.method, signal: request.signal, body });
        const hold = rules.find((rule) => rule.live && rule.failure === undefined && takes(rule.match, kind, dataset));
        if (hold !== undefined) {
            // Parked until the hold lets it go, or its caller gives it up — as fetch rejects then.
            await new Promise<void>((resolve, reject) => {
                const go = () => resolve();
                const abort = () => {
                    const at = hold.parked.indexOf(go);
                    if (at >= 0) hold.parked.splice(at, 1);
                    reject(request.signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
                };
                if (request.signal.aborted) { abort(); return; }
                hold.parked.push(go);
                request.signal.addEventListener("abort", abort, { once: true });
            });
        }
        const fault = rules.find((rule) => rule.live && rule.failure !== undefined && takes(rule.match, kind, dataset));
        if (fault?.failure !== undefined) {
            if (fault.failure === "network") throw new TypeError(`fetch failed: the showcase's fault hook failed the network for ${request.method} ${url.pathname}`);
            return failureResponse(fault.failure, request.method, url);
        }
        return e3.fetch(request);
    };
    return { apiUrl: e3.apiUrl, persisted: e3.persisted, fetch, close: () => e3.close() };
}
