/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder shows (#1668) — the page a Studio builder has open, the
 * query a query builder has open — and how another is opened in it.
 *
 * - **Its host's, when given.** A host that gives the builder what it shows
 *   holds it: a route's params, or the surface's own state. The builder shows
 *   it until the host changes it. When the builder's own pane asks for
 *   another, the host is told, and nothing else moves.
 * - **Its own, otherwise.** A builder given nothing holds what it shows
 *   itself, kept in the browser under its own storage key for a reload, as an
 *   East value's beast2. When its own pane asks for another, it shows it, and
 *   then tells the host, if there is one to tell.
 * - **What it kept is put to the test once.** What the browser kept from
 *   before is shown only if it still stands — a page still in the record, a
 *   query still saved — else the builder shows what it begins with. What the
 *   builder opened itself, and what it kept and found standing, it holds open
 *   from then on: a query just saved under a new name shows before the record
 *   reads it back, and one deleted elsewhere while open stays open, for the
 *   builder to say it is gone.
 * - **The host is told in a turn of its own** ({@link tellHost}): its `onOpen`
 *   is an author's East, never run inside the event that asked.
 *
 * Nothing is shared through a store entry: a library opens something in a
 * builder by telling the host, which gives it to the builder.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { equalFor, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import { useDataStable } from "@elaraai/east-ui-components";
import { keptBytes, useKeptValue } from "@elaraai/east-ui-components/internal";
import { storedCodec } from "./stored-value.js";

/**
 * How what a builder shows is kept and compared: through East, by its type.
 *
 * @typeParam T - What a builder shows, decoded
 */
export interface OpenCodec<T> {
    /** The value as its beast2: what the browser keeps. */
    readonly encode: (value: T) => Uint8Array;
    /** Kept bytes as the value; `undefined` for bytes this type does not read. */
    readonly decode: (bytes: Uint8Array) => T | undefined;
    /** Whether two are the same. */
    readonly equal: (a: T, b: T) => boolean;
}

/**
 * The codec of what a builder shows, from its East type — made once a type,
 * at module scope.
 *
 * @typeParam E - The East type
 * @param type - The East type of what a builder shows
 * @returns Its codec
 */
export function openCodec<E extends EastType>(type: E): OpenCodec<ValueTypeOf<E>> {
    const { encode, decode } = storedCodec(type);
    const equal = equalFor(type) as (a: ValueTypeOf<E>, b: ValueTypeOf<E>) => boolean;
    return {
        encode,
        decode: (bytes) => {
            // Storage outlives versions: bytes of another shape are nothing kept.
            try { return decode(bytes); } catch { return undefined; }
        },
        equal,
    };
}

/**
 * Tells a host what is asked for, in a turn of its own: its `onOpen` is an
 * author's East, which never runs inside the event that asked — what the pane
 * does next is not held up by it, and what it throws is not the click's.
 *
 * @typeParam T - What is asked for
 * @param onOpen - The host's `onOpen`; `undefined`, there is no host to tell
 * @param next - What is asked for
 */
export function tellHost<T>(onOpen: ((next: T) => unknown) | undefined, next: T): void {
    if (onOpen !== undefined) queueMicrotask(() => { onOpen(next); });
}

/** What {@link useOpen} is given. */
export interface OpenOptions<T> {
    /** How it is kept and compared ({@link openCodec}). */
    readonly codec: OpenCodec<T>;
    /** Where a builder given nothing keeps its own: a key of its own storage key. */
    readonly storageKey: string;
    /** What its host gives it to show; `none`, the builder holds its own. */
    readonly given: option<T>;
    /** What a builder holding its own shows while nothing it kept stands. */
    readonly first: T;
    /**
     * Whether what the browser kept from before still stands — a page still in
     * the record, a query still saved. Asked of what was kept alone, until it
     * stands: never of what the builder opened itself, nor again of what it
     * has shown.
     */
    readonly stands: (kept: T) => boolean;
    /** The host's `onOpen`: told what the builder's own pane asks for. */
    readonly onOpen: ((next: T) => unknown) | undefined;
}

/**
 * What a builder shows, and what opens another in it — see the module docs.
 *
 * @typeParam T - What a builder shows, decoded
 * @param options - What its host gives it, what it begins with, where it keeps its own, and who to tell
 * @returns What it shows — one object while it is the same — and `open(next)`, which its own pane calls
 */
export function useOpen<T>({ codec, storageKey, given, first, stands, onOpen }: OpenOptions<T>): readonly [T, (next: T) => void] {
    // The builder's own, as the browser keeps it: read once for the bytes it holds, whatever else moves.
    const [bytes, keep] = useKeptValue(storageKey, keptBytes);
    const kept = useMemo(() => (bytes === undefined ? undefined : codec.decode(bytes)), [codec, bytes]);
    // What this builder holds open: what its pane opened, or what it kept and found standing. Only what it does not
    // hold yet — kept from before — is put to `stands`.
    const [holding, setHolding] = useState<T | undefined>(undefined);
    const held = kept !== undefined && ((holding !== undefined && codec.equal(holding, kept)) || stands(kept));
    useEffect(() => {
        if (held && kept !== undefined && (holding === undefined || !codec.equal(holding, kept))) setHolding(kept);
    }, [held, kept, holding, codec]);
    const hosted = given.type === "some";
    const shown = useDataStable(hosted ? given.value : held && kept !== undefined ? kept : first, codec.equal);
    const open = useCallback((next: T) => {
        // A host that gives what the builder shows is the one that changes it.
        if (!hosted) {
            setHolding(next);
            keep(codec.encode(next));
        }
        tellHost(onOpen, next);
    }, [hosted, keep, codec, onOpen]);
    return [shown, open] as const;
}
