/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A filter step's conditions in place (#1673): the query builder's own rows —
 * their words, slots, inputs, ×s and adds, and `all · any of these` once
 * there are two conditions — with no frame of their own, so that their host's
 * is the only one: a page filter's popover, a visual's own filter, an alert.
 * Each slot is its words and its caret, its box drawn only while it is
 * hovered, focused or open (the `queryBuilder` recipe's in-place look); a lone
 * condition has no joiner column.
 *
 * While a slot is open, its offers are the shared picker in the flow under
 * the rows (`SlotChooser`, bare), in the host's body. Told to (`autoOpen`),
 * the rows open their first empty slot as they mount: a new filter opens on
 * its field's list.
 *
 * The step card (`StepCard`) is the builder's frame of the same rows.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useMemo, useRef } from "react";
import { Box, mergeRefs } from "@chakra-ui/react";
import { firstEmptySlot, type Card } from "./model/cards.js";
import { Lines, Parts, slotElement, slotKey, type PartActions, type PartStyles } from "./parts.js";
import { SlotChooser } from "./slot-chooser.js";
import type { SlotPopover } from "./use-query-editor.js";

/** Props of {@link ConditionRows}. */
export interface ConditionRowsProps {
    /** The filter step's card: its head — its match, from its second condition — and its lines. */
    readonly card: Card;
    /** The open slot's offers; `undefined` while none is open. */
    readonly popover: SlotPopover | undefined;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** What the parts ask. */
    readonly actions: PartActions;
    /** Whether the rows open their first empty slot as they mount. */
    readonly autoOpen?: boolean | undefined;
    /** Told the rows' element: what the editor finds the slots a gesture opens next in. */
    readonly rootRef?: ((el: HTMLDivElement | null) => void) | undefined;
}

/**
 * A filter step's conditions in place — see the module docs.
 *
 * @param props - The card, the open slot's offers, the parts' styles and asks ({@link ConditionRowsProps})
 * @returns The rows, and the open slot's picker under them
 */
export const ConditionRows = memo(function ConditionRows({ card, popover, ps, actions, autoOpen = false, rootRef }: ConditionRowsProps) {
    const { styles } = ps;
    const own = useRef<HTMLDivElement | null>(null);
    const setRoot = useMemo(() => mergeRefs(own, rootRef), [rootRef]);
    // A lone condition — one row, or one group — has no joiner column.
    const single = card.lines.filter((line) => line.kind === "row" || line.kind === "group").length <= 1;
    // The first empty slot opened as the rows mount, once.
    const opened = useRef(false);
    useEffect(() => {
        if (!autoOpen || opened.current) return;
        opened.current = true;
        const slot = firstEmptySlot(card);
        const anchor = slot === undefined ? undefined : slotElement(own.current, slotKey(slot));
        if (slot !== undefined && anchor !== undefined) actions.onSlot(slot, anchor);
    }, [autoOpen, card, actions]);
    return (
        <Box ref={setRoot} css={styles.conditions} data-query-look="inline" data-condition-rows="" data-single={single ? "" : undefined}>
            {card.head.length > 0 && <Box css={styles.row} data-query-line="head"><Parts parts={card.head} ps={ps} actions={actions} /></Box>}
            <Lines lines={card.lines} ps={ps} actions={actions} />
            {popover !== undefined && <SlotChooser key={popover.generation} popover={popover} surface="bare" />}
        </Box>
    );
});
