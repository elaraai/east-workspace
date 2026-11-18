/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's gutter, resized by its right rule (#1680's review): a separator,
 * as the window splitter pattern is. A drag moves the rule, and the gutter with
 * it, between its bounds; ← and → step it, with Shift further, and Home and End
 * take it to its bounds — the widths `gutter-width.ts` gives.
 *
 * A drag never draws the builder again while it runs. Each move writes the
 * width where the builder's layout reads it (`apply`): a CSS variable its grid's
 * template names. The release keeps it (`commit`), and the builder stores it.
 * A drag let go of, landing nowhere, puts the width back where it began. A key
 * keeps each step it takes. The drag is the shared pointer core's
 * (`followPointer`): its own pointer's moves alone carry it, and it ends once.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Box } from "@chakra-ui/react";
import { takeKey } from "@elaraai/east-ui-components";
import { followPointer } from "@elaraai/east-ui-components/internal";
import { clampGutter, gutterWidthByKey, type GutterBounds } from "./gutter-width.js";

type Styles = Record<string, Record<string, unknown>>;

/** Props of {@link GutterHandle}. */
export interface GutterHandleProps {
    /** The builder's recipe, its `gutterHandle` slot placing the rule. */
    readonly styles: Styles;
    /** The gutter's width as the builder keeps it. */
    readonly width: number;
    /** The widths it is held between. */
    readonly bounds: GutterBounds;
    /** What a reader hears the separator as. */
    readonly label: string;
    /** Writes a width where the builder's layout reads it, while a drag runs: never a render. */
    readonly apply: (width: number) => void;
    /** Keeps a width: a drag's release, or a key's step. */
    readonly commit: (width: number) => void;
    /** A drag began (`true`) or ended (`false`): what the builder hides while the rule moves. */
    readonly dragging?: ((on: boolean) => void) | undefined;
}

/**
 * The gutter's right rule, as a separator a drag or a key moves — see the module docs.
 *
 * @param props - The recipe, the width, its bounds, the separator's name, and where a width goes
 * @returns The separator
 */
export function GutterHandle({ styles, width, bounds, label, apply, commit, dragging }: GutterHandleProps) {
    // A drag the handle goes in the middle of stops with it: no later move writes a width.
    const stop = useRef<(() => void) | undefined>(undefined);
    useEffect(() => () => stop.current?.(), []);
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        // No text is picked up on the way: the press is the rule's.
        e.preventDefault();
        stop.current?.();
        const handle = e.currentTarget;
        const from = clampGutter(width, bounds);
        const x = e.clientX;
        let at = from;
        handle.setAttribute("data-dragging", "");
        dragging?.(true);
        const end = () => {
            stop.current = undefined;
            handle.removeAttribute("data-dragging");
            dragging?.(false);
        };
        stop.current = followPointer(e, {
            move: (event) => {
                at = clampGutter(from + event.clientX - x, bounds);
                apply(at);
            },
            up: () => {
                end();
                if (at !== from) commit(at);
            },
            cancel: () => {
                end();
                apply(from);
            },
        });
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const next = gutterWidthByKey(width, e.key, e.shiftKey, bounds);
        if (next === undefined) return;
        takeKey(e);
        if (next === width) return;
        apply(next);
        commit(next);
    };
    return (
        <Box
            css={styles.gutterHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuenow={width}
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            tabIndex={0}
            data-gutter-handle=""
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
        />
    );
}
