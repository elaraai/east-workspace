/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The built-ins newer than ES2023, and an engine without them.
 *
 * East runs in browsers on iPhones back to iOS 16.4 (docs/conventions/BROWSER_FLOOR.md), whose engine has every
 * built-in of ES2023 and few of what came after. Node has most of them, and so has the browser the tests drive, so
 * a suite run on either alone says nothing of the older engine: East's Dicts and Sets named `Iterator` in every
 * release until one such phone opened a page. {@link takeAway} makes the engine it runs in that older one — every
 * built-in of {@link FLOOR} deleted. `engine.ts` does so in Node before anything else loads (`make test-floor`),
 * and the showcase's `browser-floor.spec.ts` in a page before its first script. The lint rule
 * `east-floor/browser-floor` refuses the same built-ins by name; this is what holds a value typed `any`, where no
 * rule can see, and what an app bundles besides East.
 *
 * The lists follow TypeScript's library, which declares each edition's built-ins in files of their own:
 * `floor.spec.ts` reads those files and fails while one declares a built-in this module does not account for.
 */

/** Members an edition newer than ES2023 gave a built-in that is itself older. */
export interface NewerMembers {
    /** The interface TypeScript's library declares them on. */
    readonly declares: string;
    /**
     * The object that holds them at run time, as a path from the global object (`Set.prototype`), or
     * `%IteratorPrototype%`: the object every built-in iterator inherits from, which the iterator helpers are
     * methods of and no path names.
     */
    readonly owner: string;
    readonly names: readonly string[];
}

export const NEWER_MEMBERS: readonly NewerMembers[] = [
    // ES2024
    { declares: "ArrayBuffer", owner: "ArrayBuffer.prototype", names: ["maxByteLength", "resizable", "resize", "detached", "transfer", "transferToFixedLength"] },
    { declares: "MapConstructor", owner: "Map", names: ["groupBy"] },
    { declares: "ObjectConstructor", owner: "Object", names: ["groupBy"] },
    { declares: "PromiseConstructor", owner: "Promise", names: ["withResolvers", "try"] },
    { declares: "Atomics", owner: "Atomics", names: ["waitAsync", "pause"] },
    // A page that is not isolated from other origins has no SharedArrayBuffer at all: an owner an engine lacks is passed by.
    { declares: "SharedArrayBuffer", owner: "SharedArrayBuffer.prototype", names: ["growable", "maxByteLength", "grow"] },
    { declares: "String", owner: "String.prototype", names: ["isWellFormed", "toWellFormed"] },
    // ES2025
    { declares: "Set", owner: "Set.prototype", names: ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"] },
    { declares: "IteratorObject", owner: "%IteratorPrototype%", names: ["map", "filter", "take", "drop", "flatMap", "reduce", "toArray", "forEach", "some", "every", "find"] },
    { declares: "Math", owner: "Math", names: ["f16round"] },
    { declares: "DataView", owner: "DataView.prototype", names: ["getFloat16", "setFloat16"] },
    { declares: "RegExpConstructor", owner: "RegExp", names: ["escape"] },
    // Proposals newer than ES2025
    { declares: "ArrayConstructor", owner: "Array", names: ["fromAsync"] },
    { declares: "Map", owner: "Map.prototype", names: ["getOrInsert", "getOrInsertComputed"] },
    { declares: "WeakMap", owner: "WeakMap.prototype", names: ["getOrInsert", "getOrInsertComputed"] },
    { declares: "Date", owner: "Date.prototype", names: ["toTemporalInstant"] },
    { declares: "ErrorConstructor", owner: "Error", names: ["isError"] },
    { declares: "Intl.Locale", owner: "Intl.Locale.prototype", names: ["getCalendars", "getCollations", "getHourCycles", "getNumberingSystems", "getTextInfo", "getTimeZones", "getWeekInfo"] },
    { declares: "Uint8Array", owner: "Uint8Array.prototype", names: ["toBase64", "setFromBase64", "toHex", "setFromHex"] },
    { declares: "Uint8ArrayConstructor", owner: "Uint8Array", names: ["fromBase64", "fromHex"] },
];

/** Built-ins that are newer whole, each as a path from the global object: the name is taken away, and with it everything it makes. */
export const NEWER_GLOBALS: readonly string[] = ["Iterator", "Float16Array", "Temporal", "SuppressedError", "DisposableStack", "AsyncDisposableStack", "Intl.DurationFormat"];

/** Built-ins engines have that TypeScript's library does not declare yet: only a value typed `any` reaches one. */
export const NEWER_UNDECLARED: readonly NewerMembers[] = [
    { declares: "Math", owner: "Math", names: ["sumPrecise"] },
    { declares: "JSON", owner: "JSON", names: ["rawJSON", "isRawJSON"] },
];

/**
 * What TypeScript's newer library files declare that this engine leaves in place, and why: each is an interface's
 * name as the library declares it.
 */
export const LEFT: Readonly<Record<string, string>> = {
    "ArrayBufferConstructor": "an option of the constructor, no name of its own: what it makes is refused by its members",
    "SharedArrayBufferConstructor": "an option of the constructor, no name of its own",
    "RegExp": "`unicodeSets` reads the `v` flag, which is syntax: the lint rule reads the literal",
    "ReadonlySet": "the Set methods again: one prototype, Set's",
    "ReadonlySetLike": "a shape, not a built-in: what a Set method's argument offers",
    "PromiseWithResolvers": "a shape: the record `Promise.withResolvers` returns",
    "SymbolConstructor": "`Symbol.dispose`, `asyncDispose` and `metadata` cannot be deleted, and Node's own runner reads them",
    "Function": "`[Symbol.metadata]`, a decorator's: no name to take away",
    "Disposable": "a shape: `[Symbol.dispose]()`",
    "AsyncDisposable": "a shape: `[Symbol.asyncDispose]()`",
    "AsyncIteratorObject": "`[Symbol.asyncDispose]()` alone: no name to take away",
    "Intl.DateTimeFormat": "overloads of methods as old as the built-in, taking a Temporal object, which is taken away",
    "Intl.TextInfo": "a record `Intl.Locale`'s newer methods return",
    "Intl.WeekInfo": "a record `Intl.Locale`'s newer methods return",
};

/** Whether an interface the library declares is of a built-in taken away whole: nothing of it is left to name. */
export function goesWhole(declares: string): boolean {
    const name = declares.replace(/Constructor$/, "");
    return NEWER_GLOBALS.includes(name) || declares.startsWith("Temporal.") || /^Intl\.(Resolved)?DurationFormat/.test(declares);
}

/** What {@link takeAway} deletes: plain data, so a test can hand it to a browser's page. */
export interface Floor {
    readonly members: readonly NewerMembers[];
    readonly globals: readonly string[];
}

/** Every built-in newer than ES2023. */
export const FLOOR: Floor = { members: [...NEWER_MEMBERS, ...NEWER_UNDECLARED], globals: NEWER_GLOBALS };

/**
 * Takes every built-in of a floor away from the engine this runs in.
 *
 * Reads nothing but its argument and the engine's globals, so a browser's page can run it as its first script
 * (Playwright's `addInitScript(takeAway, FLOOR)`), as Node runs it before a suite.
 *
 * @param floor - The built-ins to take away
 * @returns What was taken away, each as a person reads it (`Set.union`, `Iterator`): what the engine did not have is not among them
 * @throws {Error} When the engine holds one fixed, so that a suite run after would pass without it gone
 */
export function takeAway(floor: Floor): string[] {
    const gone: string[] = [];
    const at = (path: string): object | undefined => {
        if (path === "") return globalThis;
        if (path === "%IteratorPrototype%") return Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
        let owner: unknown = globalThis;
        for (const part of path.split(".")) {
            if (owner === undefined || owner === null) return undefined;
            owner = (owner as Record<string, unknown>)[part];
        }
        return owner === undefined || owner === null ? undefined : owner as object;
    };
    const drop = (owner: object | undefined, name: string, label: string): void => {
        if (owner === undefined || !Object.prototype.hasOwnProperty.call(owner, name)) return;
        if (!Reflect.deleteProperty(owner, name)) throw new Error(`${label} cannot be taken away: this engine holds it fixed`);
        gone.push(label);
    };
    for (const { declares, owner, names } of floor.members) {
        for (const name of names) drop(at(owner), name, `${declares}.${name}`);
    }
    for (const path of floor.globals) {
        const dot = path.lastIndexOf(".");
        drop(at(dot < 0 ? "" : path.slice(0, dot)), path.slice(dot + 1), path);
    }
    return gone;
}
