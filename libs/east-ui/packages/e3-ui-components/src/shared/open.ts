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
 *   itself, kept in the browser under its own storage key for a reload, as
 *   East text. When its own pane asks for another, it shows it, and then tells
 *   the host, if there is one to tell. What it kept is shown only while it
 *   still stands — a page still in the record, a query still saved — else the
 *   builder shows what it begins with.
 *
 * Nothing is shared through a store entry: a library opens something in a
 * builder by telling the host, which gives it to the builder.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { equalFor, parseFor, printFor, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import { useDataStable, usePersistedState } from "@elaraai/east-ui-components";
import { keptRead } from "@elaraai/east-ui-components/internal";

/**
 * How what a builder shows is kept and compared: through East, by its type.
 *
 * @typeParam T - What a builder shows, decoded
 */
export interface OpenCodec<T> {
    /** The value as East text: what the browser keeps. */
    readonly print: (value: T) => string;
    /** East text as the value; `undefined` for text this type does not read. */
    readonly parse: (text: string) => T | undefined;
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
    const print = printFor(type) as (value: ValueTypeOf<E>) => string;
    const parse = parseFor(type);
    const equal = equalFor(type) as (a: ValueTypeOf<E>, b: ValueTypeOf<E>) => boolean;
    return {
        print,
        parse: (text) => {
            const read = parse(text);
            return read.success ? read.value as ValueTypeOf<E> : undefined;
        },
        equal,
    };
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
    /** Whether what the builder kept still stands — a page still in the record, a query still saved. */
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
    // The builder's own, as East text; the empty text for none kept.
    const { state: text, setState: setText } = usePersistedState<string>(storageKey, "", keptRead.string);
    const own = useMemo(() => {
        if (text === "") return undefined;
        const kept = codec.parse(text);
        return kept !== undefined && stands(kept) ? kept : undefined;
    }, [codec, text, stands]);
    const held = given.type === "some";
    const shown = useDataStable(held ? given.value : own ?? first, codec.equal);
    const open = useCallback((next: T) => {
        // A host that gives what the builder shows is the one that changes it.
        if (!held) setText(codec.print(next));
        onOpen?.(next);
    }, [held, setText, codec, onOpen]);
    return [shown, open] as const;
}
