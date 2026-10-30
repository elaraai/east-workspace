/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Kept state: what East UI keeps in the browser for a reload, and the one way
 * every component keeps it.
 *
 * - **Where.** `browser` is the origin's local storage: every tab, until it is
 *   cleared. `tab` is the tab's session storage: through its reloads, gone when
 *   the tab closes. `url` is a query parameter of the page's address: a link
 *   that opens the state, never scoped.
 * - **Read before the first draw.** A key is read from storage the first time
 *   the page asks for it, synchronously, so a component draws what was kept on
 *   its first render.
 * - **Written as it changes.** A write is the page's value at once, and reaches
 *   storage before the task that made it ends — one write a key, however often
 *   it changed in the task — so a reload never lands between a change and its
 *   write. An address is rewritten at most every 350 ms: a browser refuses a
 *   page that rewrites it 100 times in 30 s (Safari).
 * - **Read defensively.** Storage outlives versions, and anything on the origin
 *   may write it, so a value is taken only through its codec, which reads only
 *   the shape this version writes; anything else is removed, as never kept.
 * - **Never thrown.** Storage may be unavailable (blocked, a private window) or
 *   full: the page's value stands, the key says why it is not kept
 *   ({@link Kept.failure}), and the failure is reported to
 *   {@link onKeptFailure} once a key and reason. Nothing is thrown.
 * - **Scoped.** Every key lives under `east/` and the host's scope
 *   ({@link setKeptScope}: who is signed in), and {@link clearKept} removes them
 *   all, as a sign-out does. A device's own preference — the colour mode — is
 *   kept unscoped, and stays.
 * - **One value a key in a page.** Every reader of a key reads one value and
 *   hears every write to it. Another tab's write moves nothing here: a reload
 *   reads it.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

/** Where a value is kept: every tab (`browser`), this tab through its reloads (`tab`), or the page's address (`url`). */
export type KeptWhere = "browser" | "tab" | "url";

/**
 * How a kept value is written into storage's text and read back.
 *
 * @typeParam T - The value
 */
export interface KeptCodec<T> {
    /** The value as stored text. */
    readonly encode: (value: T) => string;
    /** Stored text as a value: `undefined` for anything this version does not write. */
    readonly decode: (text: string) => T | undefined;
}

/** Where a value is kept, and for whom. */
export interface KeptOptions {
    /** Where it is kept: `browser` (the default), `tab` or `url`. */
    readonly where?: KeptWhere | undefined;
    /**
     * Kept for whoever is signed in (the default), or for the device whoever
     * uses it — a preference of the device, as the colour mode, which a
     * sign-out leaves.
     */
    readonly scoped?: boolean | undefined;
}

/** Why a value is not kept: no storage to reach, storage full, text this version does not read, or a value its codec cannot write. */
export type KeptFailureReason = "unavailable" | "full" | "unreadable" | "unwritable";

/** A value storage did not keep. */
export interface KeptFailure {
    /** The key, as its component names it. */
    readonly key: string;
    /** Where it was to be kept. */
    readonly where: KeptWhere;
    /** Why it is not. */
    readonly reason: KeptFailureReason;
}

/**
 * One kept value of the page.
 *
 * @typeParam T - The value
 */
export interface Kept<T> {
    /** The value: the page's, else what storage kept; `undefined` for neither. */
    readonly read: () => T | undefined;
    /** Make it the page's value now, and storage's before the task ends. */
    readonly write: (value: T) => void;
    /** Drop it from the page and from storage. */
    readonly remove: () => void;
    /** Hear every change of the value, or of its failure. */
    readonly subscribe: (listener: () => void) => () => void;
    /** Why the last write was not kept; `undefined` while it was, or before any. */
    readonly failure: () => KeptFailureReason | undefined;
}

/** The root of every kept key a component names: scoped ones under `east/s/`, a device's under `east/d/`. */
const SCOPED_ROOT = "east/s/";
const DEVICE_ROOT = "east/d/";
/** How long an address waits between rewrites. */
const URL_INTERVAL_MS = 350;

/** One key's value in the page. */
interface Entry {
    readonly key: string;
    readonly name: string;
    readonly where: KeptWhere;
    readonly scoped: boolean;
    readonly codec: KeptCodec<unknown>;
    value: unknown;
    failure: KeptFailureReason | undefined;
    readonly listeners: Set<() => void>;
    /** A storage write is queued for the end of this task. */
    pending: boolean;
    /** An address rewrite is waiting out its interval. */
    timer: ReturnType<typeof setTimeout> | undefined;
}

let scope = "";
let scopeSerial = 0;
const scopeListeners = new Set<() => void>();
/** Every key the page has read, by where and its storage name. */
const entries = new Map<string, Entry>();
const failureListeners = new Set<(failure: KeptFailure) => void>();
/** Each failure reported, once a key, where and reason. */
const reported = new Set<string>();
const clearHooks = new Set<() => void>();

/**
 * Who the kept state is for: the host's scope, as who is signed in — set
 * before the app renders. A key read under another scope is another key.
 *
 * @param next - The scope: any text; the empty text for none
 */
export function setKeptScope(next: string): void {
    if (next === scope) return;
    scope = next;
    scopeSerial++;
    for (const listener of [...scopeListeners]) listener();
}

/**
 * Remove every scoped kept value, of every scope, from storage and from the
 * page — a sign-out's: what one person kept is never another's. A device's
 * own preferences stay. Every store registered with {@link onClearKept} is
 * cleared too.
 */
export function clearKept(): void {
    for (const where of ["browser", "tab"] as const) {
        const storage = storageOf(where);
        if (storage === undefined) continue;
        try {
            const names: string[] = [];
            for (let i = 0; i < storage.length; i++) {
                const name = storage.key(i);
                if (name !== null && name.startsWith(SCOPED_ROOT)) names.push(name);
            }
            for (const name of names) storage.removeItem(name);
        } catch { /* storage gone: nothing of it to clear */ }
    }
    for (const entry of entries.values()) {
        if (!entry.scoped || entry.where === "url" || entry.value === undefined) continue;
        entry.value = undefined;
        notify(entry);
    }
    for (const hook of [...clearHooks]) {
        try { hook(); } catch (error) { console.warn("[east-ui] a store cleared with the kept state failed", error); }
    }
}

/**
 * Clear another store with the kept state: one a component keeps elsewhere,
 * as the staged writes' IndexedDB.
 *
 * @param hook - Clears it
 * @returns Stops clearing it
 */
export function onClearKept(hook: () => void): () => void {
    clearHooks.add(hook);
    return () => { clearHooks.delete(hook); };
}

/**
 * Hear each value storage did not keep, once a key, where and reason. With
 * none listening, the console says so.
 *
 * @param listener - Told of each
 * @returns Stops telling it
 */
export function onKeptFailure(listener: (failure: KeptFailure) => void): () => void {
    failureListeners.add(listener);
    return () => { failureListeners.delete(listener); };
}

/**
 * Whether a value kept there survives a reload: its storage is reachable.
 *
 * @param where - Where
 * @returns Whether it is
 */
export function keptReachable(where: KeptWhere): boolean {
    if (where === "url") return typeof window !== "undefined";
    return storageOf(where) !== undefined;
}

/**
 * One value kept in the page and in storage — see the module docs. Every
 * handle of a key reads one value; the first reader's codec is the key's.
 *
 * @typeParam T - The value
 * @param key - The key, as the component names it
 * @param codec - How it is stored
 * @param options - Where, and for whom
 * @returns The value's handle
 */
export function kept<T>(key: string, codec: KeptCodec<T>, options?: KeptOptions): Kept<T> {
    const where = options?.where ?? "browser";
    const scoped = where !== "url" && (options?.scoped ?? true);
    const at = (): Entry => entryOf(key, codec as KeptCodec<unknown>, where, scoped);
    return {
        read: () => at().value as T | undefined,
        write: (value) => {
            const entry = at();
            if (Object.is(entry.value, value)) return;
            entry.value = value;
            notify(entry);
            schedule(entry);
        },
        remove: () => {
            const entry = at();
            if (entry.value === undefined) return;
            entry.value = undefined;
            notify(entry);
            schedule(entry);
        },
        subscribe: (listener) => {
            const entry = at();
            entry.listeners.add(listener);
            return () => { entry.listeners.delete(listener); };
        },
        failure: () => at().failure,
    };
}

/**
 * A kept value as a component's state — see the module docs: read before the
 * first draw, written as it changes, the same value in every component of the
 * page that keeps the key.
 *
 * @typeParam T - The value
 * @param key - The key
 * @param codec - How it is stored: the key's first codec stands
 * @param initial - The value while nothing is kept
 * @param options - Where, and for whom
 * @returns The value, its setter (a value or an update of the current one), and what removes it
 */
export function useKept<T>(key: string, codec: KeptCodec<T>, initial: T, options?: KeptOptions): readonly [T, (next: T | ((current: T) => T)) => void, () => void] {
    const where = options?.where ?? "browser";
    const scoped = options?.scoped ?? true;
    const serial = useSyncExternalStore(subscribeScope, readScopeSerial, readScopeSerial);
    // The key's first codec stands, as a key holds one shape: a codec made each render is not a new key.
    const codecRef = useRef(codec);
    const handle = useMemo(() => kept(key, codecRef.current, { where, scoped }),
        // A scope set again reads its own keys.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [key, where, scoped, serial]);
    const stored = useSyncExternalStore(handle.subscribe, handle.read, handle.read);
    const initialRef = useRef(initial);
    initialRef.current = initial;
    const set = useCallback((next: T | ((current: T) => T)) => {
        const current = handle.read();
        const base = current === undefined ? initialRef.current : current;
        handle.write(typeof next === "function" ? (next as (value: T) => T)(base) : next);
    }, [handle]);
    const remove = useCallback(() => { handle.remove(); }, [handle]);
    return [stored === undefined ? initial : stored, set, remove] as const;
}

// ── Codecs ────────────────────────────────────────────────────────────────

/** Plain text, kept as it is. */
export const keptText: KeptCodec<string> = { encode: (value) => value, decode: (text) => text };

/** A flag, kept as `true` or `false`. */
export const keptFlag: KeptCodec<boolean> = {
    encode: (value) => (value ? "true" : "false"),
    decode: (text) => (text === "true" ? true : text === "false" ? false : undefined),
};

/** Bytes — an East value's beast2 — kept as base64url: compact, and safe in an address. */
export const keptBytes: KeptCodec<Uint8Array> = {
    encode: (bytes) => {
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    decode: (text) => {
        if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
        let binary: string;
        try { binary = atob(text.replace(/-/g, "+").replace(/_/g, "/")); } catch { return undefined; }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    },
};

/** What a reader returns for a stored value of a shape this version does not write. */
export const NOT_KEPT: unique symbol = Symbol("not kept");

/**
 * Reads a stored value — parsed JSON, of any shape anything wrote — as this
 * version writes it, else {@link NOT_KEPT}.
 *
 * @typeParam T - The value
 */
export type KeptReader<T> = (stored: unknown) => T | typeof NOT_KEPT;

/**
 * Plain view state, kept as JSON and read back through a reader of the shape
 * this version writes. Only for plain data — strings, finite numbers, flags,
 * lists and records of them, `null` — never an East value, which keeps its
 * beast2 ({@link keptBytes}).
 *
 * @typeParam T - The value
 * @param read - Reads a stored value as this version writes it
 * @returns The codec
 */
export function keptJson<T>(read: KeptReader<T>): KeptCodec<T> {
    return {
        encode: (value) => JSON.stringify(value),
        decode: (text) => {
            let parsed: unknown;
            try { parsed = JSON.parse(text); } catch { return undefined; }
            const value = read(parsed);
            return value === NOT_KEPT ? undefined : value;
        },
    };
}

/** A plain record: an object, not a list. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Readers of plain view state's parts, composed to the shape a component
 * writes: each takes a part only in that shape, else {@link NOT_KEPT}.
 */
export const keptRead = {
    /** Text. */
    string: ((value: unknown) => (typeof value === "string" ? value : NOT_KEPT)) as KeptReader<string>,
    /** A finite number. */
    number: ((value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : NOT_KEPT)) as KeptReader<number>,
    /** A flag. */
    boolean: ((value: unknown) => (typeof value === "boolean" ? value : NOT_KEPT)) as KeptReader<boolean>,
    /**
     * One of the given texts.
     *
     * @param options - The texts
     * @returns The reader
     */
    oneOf: <S extends string>(...options: readonly S[]): KeptReader<S> =>
        (value) => (typeof value === "string" && (options as readonly string[]).includes(value) ? value as S : NOT_KEPT),
    /**
     * A list, every item in shape.
     *
     * @param item - Reads an item
     * @returns The reader
     */
    array: <T>(item: KeptReader<T>): KeptReader<T[]> => (value) => {
        if (!Array.isArray(value)) return NOT_KEPT;
        const out: T[] = [];
        for (const part of value) {
            const read = item(part);
            if (read === NOT_KEPT) return NOT_KEPT;
            out.push(read);
        }
        return out;
    },
    /**
     * A pair, each part in shape.
     *
     * @param first - Reads the first part
     * @param second - Reads the second part
     * @returns The reader
     */
    pair: <A, B>(first: KeptReader<A>, second: KeptReader<B>): KeptReader<[A, B]> => (value) => {
        if (!Array.isArray(value) || value.length !== 2) return NOT_KEPT;
        const a = first(value[0]);
        const b = second(value[1]);
        return a === NOT_KEPT || b === NOT_KEPT ? NOT_KEPT : [a, b];
    },
    /**
     * A record of the given fields, each in shape; a field the reader is given
     * as {@link keptRead.optional} may be absent. Fields it is not given are
     * dropped.
     *
     * @param fields - Reads each field
     * @returns The reader
     */
    record: <T extends object>(fields: { readonly [K in keyof T]-?: KeptReader<T[K]> }): KeptReader<T> => (value) => {
        if (!isRecord(value)) return NOT_KEPT;
        const out: Record<string, unknown> = {};
        for (const [name, read] of Object.entries(fields) as [string, KeptReader<unknown>][]) {
            const part = read(value[name]);
            if (part === NOT_KEPT) return NOT_KEPT;
            if (part !== undefined) out[name] = part;
        }
        return out as T;
    },
    /**
     * A part that may be absent: `undefined` for absent, else as the reader takes it.
     *
     * @param read - Reads it when present
     * @returns The reader
     */
    optional: <T>(read: KeptReader<T>): KeptReader<T | undefined> => (value) => (value === undefined ? undefined : read(value)),
    /**
     * A part that may be `null`.
     *
     * @param read - Reads it when not `null`
     * @returns The reader
     */
    nullable: <T>(read: KeptReader<T>): KeptReader<T | null> => (value) => (value === null ? null : read(value)),
};

// ── Storage ───────────────────────────────────────────────────────────────

/** The storage of a place, or `undefined` where the page cannot reach it (no browser, blocked, a sandboxed frame). */
function storageOf(where: "browser" | "tab"): Storage | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        return where === "browser" ? window.localStorage : window.sessionStorage;
    } catch {
        return undefined;
    }
}

/** A key's storage name: its root, scope and key; an address's parameter is the key itself. */
function nameOf(key: string, where: KeptWhere, scoped: boolean): string {
    if (where === "url") return key;
    return scoped ? `${SCOPED_ROOT}${encodeURIComponent(scope)}/${key}` : `${DEVICE_ROOT}${key}`;
}

/** A key's entry in the page, read from storage the first time it is asked for. */
function entryOf(key: string, codec: KeptCodec<unknown>, where: KeptWhere, scoped: boolean): Entry {
    const name = nameOf(key, where, scoped);
    const id = `${where}\u0000${name}`;
    let entry = entries.get(id);
    if (entry !== undefined) return entry;
    entry = { key, name, where, scoped, codec, value: undefined, failure: undefined, listeners: new Set(), pending: false, timer: undefined };
    entries.set(id, entry);
    const text = readText(entry);
    if (text !== undefined) {
        let value: unknown;
        try { value = codec.decode(text); } catch { value = undefined; }
        if (value === undefined) {
            forget(entry);
            report(entry, "unreadable");
        } else {
            entry.value = value;
        }
    }
    return entry;
}

/** What storage holds under a key, or `undefined` for nothing or no storage. */
function readText(entry: Entry): string | undefined {
    if (entry.where === "url") {
        if (typeof window === "undefined") return undefined;
        return new URLSearchParams(window.location.search).get(entry.name) ?? undefined;
    }
    if (typeof window === "undefined") return undefined;
    const storage = storageOf(entry.where);
    if (storage === undefined) { fail(entry, "unavailable"); return undefined; }
    try {
        return storage.getItem(entry.name) ?? undefined;
    } catch {
        fail(entry, "unavailable");
        return undefined;
    }
}

/** Remove what storage holds under a key: text this version does not read. */
function forget(entry: Entry): void {
    if (entry.where === "url") { rewriteAddress(entry, undefined); return; }
    try { storageOf(entry.where)?.removeItem(entry.name); } catch { /* nothing to remove it from */ }
}

/** Queue a key's write: before this task ends, or an address after its interval. */
function schedule(entry: Entry): void {
    if (entry.where === "url") {
        if (entry.timer !== undefined) return;
        entry.timer = setTimeout(() => { entry.timer = undefined; store(entry); }, URL_INTERVAL_MS);
        return;
    }
    if (entry.pending) return;
    entry.pending = true;
    queueMicrotask(() => { entry.pending = false; store(entry); });
}

/** Write a key's value as the page holds it now — or remove it, for none. */
function store(entry: Entry): void {
    let text: string | undefined;
    if (entry.value !== undefined) {
        try {
            text = entry.codec.encode(entry.value);
        } catch {
            fail(entry, "unwritable");
            return;
        }
    }
    if (entry.where === "url") { rewriteAddress(entry, text); return; }
    if (typeof window === "undefined") return;
    const storage = storageOf(entry.where);
    if (storage === undefined) { fail(entry, "unavailable"); return; }
    try {
        if (text === undefined) storage.removeItem(entry.name);
        else storage.setItem(entry.name, text);
    } catch (error) {
        fail(entry, isQuotaError(error) ? "full" : "unavailable");
        return;
    }
    if (entry.failure !== undefined) {
        entry.failure = undefined;
        notify(entry);
    }
}

/** Set or remove a key's parameter of the page's address, its history entry kept. */
function rewriteAddress(entry: Entry, text: string | undefined): void {
    if (typeof window === "undefined") return;
    try {
        const url = new URL(window.location.href);
        if (text === undefined) url.searchParams.delete(entry.name);
        else url.searchParams.set(entry.name, text);
        window.history.replaceState(window.history.state, "", url);
    } catch {
        fail(entry, "unavailable");
    }
}

/** Whether a storage write failed for want of room, as each browser says it. */
function isQuotaError(error: unknown): boolean {
    if (typeof DOMException === "undefined" || !(error instanceof DOMException)) return false;
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22 || error.code === 1014;
}

/** A key's write was not kept: it says why, and the failure is reported once. */
function fail(entry: Entry, reason: KeptFailureReason): void {
    if (entry.failure !== reason) {
        entry.failure = reason;
        notify(entry);
    }
    report(entry, reason);
}

/** Report a failure once a key, where and reason. */
function report(entry: Entry, reason: KeptFailureReason): void {
    const id = `${entry.where}\u0000${entry.name}\u0000${reason}`;
    if (reported.has(id)) return;
    reported.add(id);
    const failure: KeptFailure = { key: entry.key, where: entry.where, reason };
    if (failureListeners.size === 0) {
        console.warn(`[east-ui] "${entry.key}" is not kept in ${entry.where} storage: ${reason}`);
        return;
    }
    for (const listener of [...failureListeners]) {
        try { listener(failure); } catch (error) { console.warn("[east-ui] a kept-state failure listener failed", error); }
    }
}

/** Tell every reader of a key that it moved. */
function notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) listener();
}

function subscribeScope(listener: () => void): () => void {
    scopeListeners.add(listener);
    return () => { scopeListeners.delete(listener); };
}

function readScopeSerial(): number {
    return scopeSerial;
}

/**
 * Forget every key the page has read, every failure reported and the scope,
 * and stop clearing other stores — storage left as it is. Test isolation only:
 * a page's next read reads storage afresh, as a reload's.
 *
 * @internal
 */
export function resetKept(): void {
    for (const entry of entries.values()) if (entry.timer !== undefined) clearTimeout(entry.timer);
    entries.clear();
    reported.clear();
    failureListeners.clear();
    clearHooks.clear();
    scope = "";
    scopeSerial++;
}
