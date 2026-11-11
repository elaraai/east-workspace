/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How the proof harness walks a model (test use): every ordering of its
 * operations to a depth, each run from a fresh model; every state it can
 * reach, however many operations away; and seeded random numbers for the
 * runs past either.
 *
 * The walks hold no state of a model between runs: each is replayed from its
 * first operation, so nothing one run did can reach another.
 *
 * - **Every ordering to a depth** (`everyOrdering`). Two operations whose
 *   order is no matter — the model's own `independent` — are run in one order
 *   only (sleep sets): an operation run from a point sleeps for those after
 *   it that it is independent of, until one it is not independent of runs.
 * - **Every state** (`everyState`). A model whose operations are budgeted —
 *   so many gestures, so many requests, so many of another session's writes —
 *   can be in finitely many states. Each state is told by its print
 *   (`fingerprint`): everything the model and the code under it hold, every
 *   private field, each object once and what is shared read as shared. The
 *   walk runs every operation from every state it has not met, breadth first,
 *   until none is new: every state the code can reach under those budgets
 *   has then been checked, at any number of operations, and each brought to
 *   rest.
 *
 * @packageDocumentation
 */
import { SortedMap, SortedSet } from "@elaraai/east";

/** One operation of a model, by name. */
type Op = string;

/** What the walk asks of a model. */
export interface Explorable {
    /** The operations that can run now, by name. */
    enabled(): Op[];
    /** Brings the model to rest, and checks what must hold of it there. */
    rest(): Promise<void>;
}

/**
 * Runs every ordering of a model's operations to a depth, each from a fresh
 * model, brought to rest once its operations are run.
 *
 * @typeParam T - The model
 * @param after - A fresh model with some operations run at it, in order
 * @param depth - How many operations an ordering holds at most
 * @param allow - Which operations it explores
 * @param independent - Whether two operations' order is no matter
 * @param visit - Called with each ordering's model, at rest
 * @returns How many orderings it ran
 * @throws The first fault a model raises
 */
export async function everyOrdering<T extends Explorable>(
    after: (ops: readonly Op[]) => Promise<T>,
    depth: number,
    allow: (op: Op) => boolean,
    independent: (a: Op, b: Op) => boolean,
    visit: (at: T) => void,
): Promise<number> {
    let count = 0;
    const walk = async (prefix: readonly Op[], asleep: ReadonlySet<Op>): Promise<void> => {
        const model = await after(prefix);
        const next = prefix.length < depth ? model.enabled().filter(allow) : [];
        await model.rest();
        count++;
        visit(model);
        // An operation run from here sleeps for the ones after it whose order with it is no matter: they have met.
        const slept = new Set(asleep);
        for (const op of next) {
            if (slept.has(op)) continue;
            await walk([...prefix, op], new Set([...slept].filter((other) => independent(other, op))));
            slept.add(op);
        }
    };
    await walk([], new Set());
    return count;
}

/**
 * A seeded generator of numbers in [0, 1): the same run for the same seed.
 *
 * @param seed - The seed
 * @returns The generator
 */
export function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** An id the code makes at random: its 32 hex digits. A print names each by the order it meets them in. */
const RANDOM_ID = /^[0-9a-f]{32}$/;

/** What a print leaves out of an object, or reads in another form. */
export interface PrintRules {
    /** Whether a field is no state: a cache, a counter that only counts, what an object is bound to. */
    readonly skip: (owner: object, key: string) => boolean;
    /** A field read in another form before it is printed — bytes that hold a random id, decoded — or the value itself. */
    readonly read?: (owner: object, key: string, value: unknown) => unknown;
}

/**
 * A print of everything a value holds: every own field of every object it reaches, private ones too, in a fixed
 * order. An object met again is named by where it was first met, so two prints are equal only where the same things
 * are shared; an id made at random is named by the order it is met in, so two runs that differ only in the ids they
 * drew print the same. Functions print as there or not: what they close over is printed where it is held.
 *
 * @param root - The value
 * @param rules - What is no state, and what is read in another form
 * @returns The print
 */
export function fingerprint(root: unknown, rules: PrintRules): string {
    const met = new Map<object, number>();
    const ids = new Map<string, number>();
    const out: string[] = [];
    const visit = (value: unknown): void => {
        switch (typeof value) {
            case "undefined": out.push("u"); return;
            case "boolean": out.push(value ? "T" : "F"); return;
            case "number": out.push("n", String(value)); return;
            case "bigint": out.push("i", String(value)); return;
            case "string": {
                if (!RANDOM_ID.test(value)) { out.push(JSON.stringify(value)); return; }
                let at = ids.get(value);
                if (at === undefined) { at = ids.size; ids.set(value, at); }
                out.push("#", String(at));
                return;
            }
            case "function": case "symbol": out.push("f"); return;
            default:
        }
        if (value === null) { out.push("N"); return; }
        const object = value as object;
        const before = met.get(object);
        if (before !== undefined) { out.push("@", String(before)); return; }
        met.set(object, met.size);
        if (object instanceof Uint8Array) { out.push("b", Array.from(object, (byte) => byte.toString(16).padStart(2, "0")).join("")); return; }
        if (object instanceof WeakMap || object instanceof WeakSet || object instanceof Promise) { out.push("w"); return; }
        if (Array.isArray(object)) {
            out.push("[");
            for (const item of object) { visit(item); out.push(","); }
            out.push("]");
            return;
        }
        if (object instanceof Map || object instanceof SortedMap) {
            out.push("M{");
            for (const [key, item] of object as Map<unknown, unknown>) { visit(key); out.push(":"); visit(item); out.push(","); }
            out.push("}");
            return;
        }
        if (object instanceof Set || object instanceof SortedSet) {
            out.push("S{");
            for (const item of object as Set<unknown>) { visit(item); out.push(","); }
            out.push("}");
            return;
        }
        out.push("{");
        for (const key of Object.keys(object).sort()) {
            if (rules.skip(object, key)) continue;
            const held = (object as Record<string, unknown>)[key];
            out.push(key, "=");
            visit(rules.read === undefined ? held : rules.read(object, key, held));
            out.push(";");
        }
        out.push("}");
    };
    visit(root);
    return out.join("");
}

/** A print cut to 106 bits: two 53-bit hashes of it, under two seeds. What a walk keeps of each state it has met. */
function digest(text: string): string {
    const half = (seed: number): number => {
        let [h1, h2] = [0xdeadbeef ^ seed, 0x41c6ce57 ^ seed];
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ code, 2654435761);
            h2 = Math.imul(h2 ^ code, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    };
    return `${half(1).toString(36)}.${half(2).toString(36)}`;
}

/** What a walk of every state covered. */
export interface StatesWalked {
    /** How many states it met, each once. */
    readonly states: number;
    /** How many operations it ran from them: every one each state allows. */
    readonly transitions: number;
    /** The most operations it took to reach a state for the first time. */
    readonly depth: number;
    /** Whether it met every state there is: `false` where it stopped at its limit with states still to run from. */
    readonly closed: boolean;
}

/**
 * Runs every operation from every state a model can reach, breadth first, until no state is new: each state met once,
 * told by its print, and brought to rest.
 *
 * @typeParam T - The model
 * @param after - A fresh model with some operations run at it, in order
 * @param print - A model's print: everything it holds that what it does next may turn on
 * @param allow - Which operations it explores
 * @param visit - Called with each state's model, at rest, and the operations that first reached it
 * @param limit - The most states it meets before it stops, saying it has not met them all
 * @returns What it covered
 * @throws The first fault a model raises
 */
export async function everyState<T extends Explorable>(
    after: (ops: readonly Op[]) => Promise<T>,
    print: (at: T) => string,
    allow: (op: Op) => boolean,
    visit: (at: T, ops: readonly Op[]) => void,
    limit = Number.POSITIVE_INFINITY,
): Promise<StatesWalked> {
    const start = await after([]);
    const met = new Set<string>([digest(print(start))]);
    await start.rest();
    visit(start, []);
    let queue: (readonly Op[])[] = [[]];
    let [transitions, depth] = [0, 0];
    while (queue.length > 0 && met.size < limit) {
        const next: (readonly Op[])[] = [];
        for (const path of queue) {
            if (met.size >= limit) break;
            const from = await after(path);
            for (const op of from.enabled().filter(allow)) {
                const ops = [...path, op];
                const reached = await after(ops);
                transitions++;
                const state = digest(print(reached));
                if (met.has(state)) continue;
                met.add(state);
                next.push(ops);
                await reached.rest();
                visit(reached, ops);
            }
        }
        if (next.length > 0) depth++;
        queue = next;
    }
    return { states: met.size, transitions, depth, closed: queue.length === 0 };
}
