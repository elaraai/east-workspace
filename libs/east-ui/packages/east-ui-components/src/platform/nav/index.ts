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
    variant,
    encodeBeast2For,
    decodeBeast2For,
    type EastTypeValue,
    type StructTypeValue,
    type FunctionTypeValue,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { navBindPlatformFn } from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "../state-runtime.js";
import { registerPlatformImplementation } from "../registry.js";

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
export const NavImpl: PlatformFunction[] = [
    navBindPlatformFn.implement((handleType: EastTypeValue, _routeType: EastTypeValue) =>
        (key: unknown, initial: unknown) => {
            const k = key as string;

            // Introspect the handle struct for the sub-types we need (the Record.bind
            // idiom) — never re-wrap a runtime EastTypeValue with a TS type builder.
            const fields = (handleType as StructTypeValue).value;

            // `path: FunctionType([], ArrayType(Route))` → its output IS the path array
            // EastTypeValue, fed straight to encode/decode (as State.bind / Record.bind do).
            const pathFn = fields.find(f => f.name === "path")?.type as FunctionTypeValue | undefined;
            if (pathFn === undefined) {
                throw new Error("Navigation.bind: handle type is missing its `path` field");
            }
            const pathType = pathFn.value.output as EastTypeValue;
            const encode = encodeBeast2For(pathType) as unknown as (v: unknown) => Uint8Array;
            const decode = decodeBeast2For(pathType) as unknown as (b: Uint8Array) => unknown[];

            // Seed the path on first bind (like State.bind seeds its default).
            if (!getStore().has(k)) {
                getStore().write(k, encode(initial));
            }

            const readPath = (): unknown[] => {
                trackKey(k);
                const bytes = getStore().read(k);
                return (bytes === undefined ? initial : decode(bytes)) as unknown[];
            };
            const writePath = (p: unknown[]): null => {
                getStore().write(k, encode(p));
                return null;
            };

            // One navigate closure per route — the `go` struct's field names are the routes.
            const goStruct = fields.find(f => f.name === "go")?.type as StructTypeValue | undefined;
            const go: Record<string, (payload: unknown) => null> = {};
            for (const { name } of goStruct?.value ?? []) {
                go[name] = (payload: unknown) =>
                    writePath([...readPath(), variant(name, payload === undefined ? null : payload)]);
            }

            return {
                key: k,
                path: () => readPath(),
                current: () => {
                    const p = readPath();
                    return p[p.length - 1];
                },
                depth: () => BigInt(readPath().length),
                canPop: () => readPath().length > 1,
                pop: (): null => {
                    const p = readPath();
                    if (p.length > 1) writePath(p.slice(0, -1));
                    return null;
                },
                go,
                navigateTo: (p: unknown): null => writePath(p as unknown[]),
            };
        },
    ),
];

registerPlatformImplementation(NavImpl);
