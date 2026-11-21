/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tile's meta (#1671, TIL-1): what its eyebrow says at its end, beside its
 * menu — said by whatever its body draws, since only that knows it: `loading`
 * while its answer is awaited, `needs a field` while one is missing, its
 * source's name while its wells are empty, and, once drawn, what it groups
 * by, its unit and what it holds of how many. The body's part says it with
 * {@link TileMeta}, which draws it in the eyebrow's slot.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useFormatters } from "@elaraai/east-ui-components";
import { useStudioMessages } from "../messages.js";
import { visualMeta, type VisualShown, type VisualSource, type VisualView } from "./values.js";

/** The eyebrow's meta slot: the element a tile's body draws its meta in; `null` before it is mounted. */
const MetaSlot = createContext<HTMLElement | null>(null);

/** Gives a tile's body the eyebrow's meta slot. */
export const TileMetaSlot = MetaSlot.Provider;

/**
 * A tile's meta, drawn in its eyebrow: one line, cut with an ellipsis where
 * the strip is short, its whole on hover (#1692).
 *
 * @param props - What it says; nothing draws nothing
 * @returns The meta, in the eyebrow's slot
 */
export function TileMeta({ children }: { readonly children: string | undefined }) {
    const slot = useContext(MetaSlot);
    // Its whole on hover, on the slot that cuts it.
    useLayoutEffect(() => {
        if (slot === null || children === undefined) return undefined;
        slot.title = children;
        return () => { slot.removeAttribute("title"); };
    }, [slot, children]);
    return slot === null || children === undefined ? null : createPortal(children, slot);
}

/** Props of {@link VisualMeta}. */
export interface VisualMetaProps {
    /** What the visual draws. */
    readonly view: VisualView;
    /** Its source. */
    readonly source: VisualSource;
    /** What it holds of how many, when it holds fewer; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/**
 * A drawn visual's meta ({@link visualMeta}): what it groups by, its unit and
 * what it holds of how many, in the eyebrow's slot.
 *
 * @param props - The view, its source and what it holds of how many
 * @returns The meta, in the eyebrow's slot
 */
export function VisualMeta({ view, source, shown }: VisualMetaProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    return <TileMeta>{visualMeta(view, source, m, shown === undefined ? undefined : { shown: f.number(shown.shown), of: f.number(shown.of) })}</TileMeta>;
}
