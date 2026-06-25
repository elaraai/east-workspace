/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the `Navigation.bind` (`nav_bind`) platform function.
 *
 * The handle is a navigation path-stack persisted under a `State` key: `path` is
 * `ArrayType(Route)`; `go.<route>(payload)` pushes `variant(route, payload)`;
 * `pop` drops the leaf; `current` is the leaf; `navigateTo` replaces the whole
 * stack. Reads `trackKey` the store key so a `<Pages>`/`<Reactive>` re-renders on
 * navigation. Backed by the same {@link getStore} as `State.bind`.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    NullType,
    fromEastTypeValue,
    variant,
    encodeBeast2For,
    decodeBeast2For,
    type EastType,
    type EastTypeValue,
    type StructTypeValue,
    type FunctionTypeValue,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { navBindPlatformFn, NavBindPrimitives } from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "../state-runtime.js";
import { registerPlatformImplementation, getRegisteredPlatformImplementations } from "../registry.js";

/**
 * Platform implementation for `Navigation.bind`.
 *
 * Generic over `[H, R]`, but the impl introspects the handle struct `H` for every
 * sub-type it needs (the `Record.bind` idiom) rather than re-wrapping the runtime
 * `R` value with a TS type builder: the handle's `path` field is
 * `FunctionType([], ArrayType(Route))`, so its output IS the path array
 * `EastTypeValue` to encode/decode with, and the `go` struct's field names are the
 * routes. Returns the handle struct of closures over the path stored at `key`.
 */
// Compiled-handle cache (issue #106 perf): like State.bind, nav binds re-run every
// reactive frame; the method IR is a pure function of the store key, and the methods
// resolve getStore() live, so a cached handle still re-binds. Module-level.
const navHandleCache = new Map<string, Record<string, unknown>>();

/** Path read/write over the store key, keyed on the path type (the existing logic;
 *  the primitives delegate here so the host I/O stays in one place). */
function navOps(pathType: EastTypeValue, key: string) {
    const encode = encodeBeast2For(pathType) as unknown as (v: unknown) => Uint8Array;
    const decode = decodeBeast2For(pathType) as unknown as (b: Uint8Array) => unknown[];
    return {
        readPath: (initial: unknown[]): unknown[] => {
            trackKey(key);
            const bytes = getStore().read(key);
            return bytes === undefined ? initial : decode(bytes);
        },
        writePath: (p: unknown[]): null => { getStore().write(key, encode(p)); return null; },
    };
}

/**
 * Build the `Navigation.bind` handle. The path-stack methods are thin IR-bearing
 * `East.function`s over the `nav_*` primitives, capturing only the store key (+ the
 * seed path for the decode-side fallback) — so the handle is ordinary serializable
 * East data (issue #106). `current`/`depth`/`canPop` are derived in East from
 * `nav_read`; `go.<route>` and `navigateTo` write through the primitives.
 */
function buildNavHandle(handleType: EastTypeValue, key: string, initial: unknown): Record<string, unknown> {
    const fields = (handleType as StructTypeValue).value;
    const fieldType = (n: string): EastTypeValue | undefined => fields.find(f => f.name === n)?.type;

    // `path: FunctionType([], ArrayType(Route))` → its output IS the path type `P`.
    const pathFn = fieldType("path") as FunctionTypeValue | undefined;
    if (pathFn === undefined) {
        throw new Error("Navigation.bind: handle type is missing its `path` field");
    }
    const pathTypeVal = pathFn.value.output as EastTypeValue;

    // Seed the path on first bind (like State.bind seeds its default). Runs every
    // bind, before the cache, so the current store is always seeded.
    if (!getStore().has(key)) {
        getStore().write(key, (encodeBeast2For(pathTypeVal) as unknown as (v: unknown) => Uint8Array)(initial));
    }

    const cached = navHandleCache.get(key);
    if (cached) return cached;

    const fnOut = (n: string): EastType =>
        fromEastTypeValue((fieldType(n) as FunctionTypeValue).value.output as EastTypeValue);
    const P = fromEastTypeValue(pathTypeVal);
    const routeRet = fnOut("current");
    const depthRet = fnOut("depth");
    const canPopRet = fnOut("canPop");

    const keyExpr = East.value(key, StringType);
    const initialExpr = East.value(initial as never, P);
    const platform = getRegisteredPlatformImplementations();
    const { read, write, pop, go } = NavBindPrimitives;

    // One typed navigate East.function per route (the `go` struct's field names).
    const goStruct = fieldType("go") as StructTypeValue | undefined;
    const goHandle: Record<string, unknown> = {};
    for (const { name, type } of goStruct?.value ?? []) {
        const V = fromEastTypeValue((type as FunctionTypeValue).value.inputs[0] as EastTypeValue);
        const routeNameExpr = East.value(name, StringType);
        goHandle[name] = East.compile(East.function([V], NullType, ($, payload) => {
            $.return(go([P, V], keyExpr, routeNameExpr, payload, initialExpr));
        }), platform);
    }

    const handle: Record<string, unknown> = {
        key,
        path: East.compile(East.function([], P, ($) => { $.return(read([P], keyExpr, initialExpr)); }), platform),
        current: East.compile(East.function([], routeRet, ($) => {
            const p = $.let(read([P], keyExpr, initialExpr)) as never as { get(i: unknown): unknown; size(): { subtract(n: bigint): unknown } };
            $.return(p.get(p.size().subtract(1n)));
        }), platform),
        depth: East.compile(East.function([], depthRet, ($) => {
            $.return((read([P], keyExpr, initialExpr) as never as { size(): unknown }).size());
        }), platform),
        canPop: East.compile(East.function([], canPopRet, ($) => {
            $.return((read([P], keyExpr, initialExpr) as never as { size(): { greater(n: bigint): unknown } }).size().greater(1n));
        }), platform),
        pop: East.compile(East.function([], NullType, ($) => { $.return(pop([P], keyExpr, initialExpr)); }), platform),
        go: goHandle,
        navigateTo: East.compile(East.function([P], NullType, ($, newPath) => { $.return(write([P], keyExpr, newPath)); }), platform),
    };
    navHandleCache.set(key, handle);
    return handle;
}

export const NavImpl: PlatformFunction[] = [
    navBindPlatformFn.implement((handleType: EastTypeValue, _routeType: EastTypeValue) =>
        (key: unknown, initial: unknown) => buildNavHandle(handleType, key as string, initial)),
    NavBindPrimitives.read.implement((pathType: EastTypeValue) => (key: unknown, initial: unknown) =>
        navOps(pathType, key as string).readPath(initial as unknown[])),
    NavBindPrimitives.write.implement((pathType: EastTypeValue) => (key: unknown, path: unknown) =>
        navOps(pathType, key as string).writePath(path as unknown[])),
    NavBindPrimitives.pop.implement((pathType: EastTypeValue) => (key: unknown, initial: unknown) => {
        const { readPath, writePath } = navOps(pathType, key as string);
        const p = readPath(initial as unknown[]);
        if (p.length > 1) writePath(p.slice(0, -1));
        return null;
    }),
    NavBindPrimitives.go.implement((pathType: EastTypeValue, _payloadType: EastTypeValue) =>
        (key: unknown, routeName: unknown, payload: unknown, initial: unknown) => {
            const { readPath, writePath } = navOps(pathType, key as string);
            return writePath([...readPath(initial as unknown[]), variant(routeName as string, payload === undefined ? null : payload)]);
        }),
];

registerPlatformImplementation(NavImpl);
