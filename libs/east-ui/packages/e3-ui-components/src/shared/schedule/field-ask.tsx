/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The field an issue gone to asks for: the warning button's first issue, or a
 * refusal pressed in the Issues tab, selects its entry — and the field its
 * refusal names, ringed in the entry's form, takes the keyboard as the form
 * draws it, which brings it into view in its pane, as the Record's issue gone
 * to does. A builder holds its asks ({@link useFieldAsks}) and provides them
 * ({@link FieldAskProvider}); an entry's form reads the field asked of it
 * ({@link useFieldAsk}) for its `FieldForm`'s `focus`, and answers the ask —
 * in a phone's drawer without taking the keyboard, the field left to a tap, so
 * no keyboard rises over the drawer unasked. An entry's form drawn anew while
 * another's ask stands drops it: the viewer moved on before it was drawn.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StringType, equalFor, type option } from "@elaraai/east";
import { FrameDrawer } from "@elaraai/east-ui-components/internal";

/** An ask for the keyboard in one field of an entry's form. */
export interface FieldAsk {
    /** The entry's kind: its slot, or its record's key — whose session refuses it. */
    readonly kind: string;
    /** The entry's key. */
    readonly entry: string;
    /** The field, by its form's key. */
    readonly field: string;
    /** Which ask it is: each later than the one before. */
    readonly seq: number;
}

/** What an entry's form reads of its builder's asks. */
export interface FieldAsks {
    /** The ask standing, until a form answers it. */
    readonly ask: FieldAsk | undefined;
    /** Says a form answered an ask: its entry's, or another's drawn anew. */
    readonly answered: (seq: number) => void;
}

const NO_ASKS: FieldAsks = { ask: undefined, answered: () => undefined };
const FieldAskContext = createContext<FieldAsks>(NO_ASKS);

/** Provides a builder's asks to its entries' forms: the `asks` {@link useFieldAsks} gives. */
export const FieldAskProvider = FieldAskContext.Provider;

const stringEqual = equalFor(StringType);

/**
 * A builder's asks: the one standing, for its {@link FieldAskProvider}, and how an issue gone to asks.
 *
 * @returns The asks, and `request`: an issue gone to on its entry, asking for the field it names — an issue naming none
 * drops any ask standing
 */
export function useFieldAsks(): { readonly asks: FieldAsks; readonly request: (kind: string, entry: string, field: option<string>) => void } {
    const [ask, setAsk] = useState<FieldAsk>();
    const last = useRef(0);
    const answered = useCallback((seq: number) => setAsk((was) => (was !== undefined && was.seq === seq ? undefined : was)), []);
    const request = useCallback((kind: string, entry: string, field: option<string>) => {
        last.current += 1;
        setAsk(field.type === "some" ? { kind, entry, field: field.value, seq: last.current } : undefined);
    }, []);
    const asks = useMemo(() => ({ ask, answered }), [ask, answered]);
    return { asks, request };
}

/**
 * The field an issue gone to asks of an entry's form, for its `FieldForm`'s `focus` (see the module docs).
 *
 * @param kind - The entry's kind: its slot, or its record's key
 * @param entry - The entry's key
 * @returns The field, by its form's key, while its ask stands — never in a phone's drawer
 */
export function useFieldAsk(kind: string, entry: string): string | undefined {
    const { ask, answered } = useContext(FieldAskContext);
    const phone = useContext(FrameDrawer);
    const mine = ask !== undefined && stringEqual(ask.kind, kind) && stringEqual(ask.entry, entry) ? ask : undefined;
    // Drawn anew while another entry's ask stands: the viewer moved on before that entry was drawn.
    const fresh = useRef(true);
    useEffect(() => {
        if (mine !== undefined) answered(mine.seq);
        else if (fresh.current && ask !== undefined) answered(ask.seq);
        fresh.current = false;
    }, [ask, mine, answered]);
    return phone || mine === undefined ? undefined : mine.field;
}
