/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key as the viewer types it in the Flowchart's and the
 * Schematic's inspectors (#1549, #1581). A key of one part — a String, a
 * number, a date, a case holding nothing — is taken as it is typed. A key of
 * several — a struct's fields, a variant's case and its value — is typed a part
 * at a time into a draft the form shows, and taken whole when the viewer sets
 * it ({@link KeySetButton}), checked once then: no key with a part still at its
 * default is ever the row's, so one another row holds never refuses a part, and
 * the row waits under its placeholder, holding Save, until the key is set.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { chakra, useRecipe } from "@chakra-ui/react";
import { StringType, equalFor } from "@elaraai/east";
import { keyEdited, type KindKeys } from "./kind-keys.js";

const stringEqual = equalFor(StringType);

/** A new row's key as the viewer types it: see the module docs. */
export interface KeyDraft {
    /** The key as the form shows it, under `key`: the draft typed so far, else the row's — `undefined` for a placeholder. */
    readonly value: unknown;
    /** Whether the key has several parts: typed into the draft, and set whole. */
    readonly parts: boolean;
    /** Whether the draft holds a key other than the row's: what Set takes. */
    readonly typed: boolean;
    /**
     * A part of the key edited in the form: the key taken at once, for a key of one part; else the draft.
     *
     * @param path - The edited spec's path, from `key` down
     * @param next - Its new value
     * @returns Why a key of one part was refused, where the inspector says: what the form says under its field
     */
    readonly onChange: (path: readonly string[], next: unknown) => string | void;
    /** Takes the draft whole: refused, the draft stays to be changed. */
    readonly set: () => void;
}

/**
 * A new row's key as the viewer types it (see the module docs).
 *
 * @param keys - The row's kind's keys
 * @param at - The row's key's text: a placeholder's until its key is set
 * @param take - Takes a key, by its text: the row under it, or refused, saying why — the words handed back where it does
 * @returns The key as the form shows it, and how it is typed and set
 */
export function useKeyDraft(keys: KindKeys, at: string, take: (key: string) => string | void): KeyDraft {
    const [draft, setDraft] = useState<{ readonly key: unknown } | undefined>(undefined);
    const held = useMemo(() => keys.keyOf(at), [keys, at]);
    const parts = keys.specs.length > 1;
    const onChange = useCallback((path: readonly string[], next: unknown): string | void => {
        if (!parts) return take(keys.textOf(keyEdited(keys, held, path, next)));
        setDraft((was) => ({ key: keyEdited(keys, was === undefined ? held : was.key, path, next) }));
    }, [parts, keys, held, take]);
    const text = draft === undefined ? undefined : keys.textOf(draft.key);
    const typed = text !== undefined && !stringEqual(text, at);
    const set = useCallback(() => {
        if (text !== undefined && typed) take(text);
    }, [text, typed, take]);
    return { value: draft === undefined ? held : draft.key, parts, typed, onChange, set };
}

/**
 * A key of several parts' Set: takes the draft whole — off while it holds the row's key.
 *
 * @param props - The draft, and the button's words
 * @returns The button
 */
export function KeySetButton({ draft, label }: { readonly draft: KeyDraft; readonly label: string }) {
    const button = useRecipe({ key: "button" });
    return (
        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!draft.typed} data-inspector-key-set="" onClick={draft.set}>
            {label}
        </chakra.button>
    );
}
