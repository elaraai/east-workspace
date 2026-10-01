/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The line between two steps (#936) — #934's `ShapeLine` as the Query tab
 * draws it after the source and after every step (`Query Editor Spec.md`
 * §4.3): a rule down the steps' spine; the shape in plain words ("Many
 * shipped orders"), or counted after a fresh run ("16 shipped orders"); what
 * changed ("+ name, region"), or the fields after a reshaping step; the East
 * type on hover; and **Insert**, which opens the add-step list for that point.
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box, Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import type { ShapeLine } from "./model/cards.js";
import type { SlotRef } from "./model/refs.js";
import { Tip, slotKey, type PartActions, type PartStyles } from "./parts.js";

/** Props of {@link ShapeLineView}. */
export interface ShapeLineViewProps {
    /** The shape. */
    readonly shape: ShapeLine;
    /** Where Insert adds a step: before the step at this index. */
    readonly at: number;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** What Insert asks: the add-step list, hanging from it. */
    readonly onSlot: PartActions["onSlot"];
}

/**
 * Renders the line after the source or a step — see the module docs.
 *
 * @param props - The shape, Insert's place, and what it asks ({@link ShapeLineViewProps})
 * @returns The line
 */
export const ShapeLineView = memo(function ShapeLineView({ shape, at, ps, onSlot }: ShapeLineViewProps) {
    const { styles, words } = ps;
    const m = words.messages;
    const slot: SlotRef = { kind: "add-step", stepId: "", at };
    return (
        <Box css={styles.shape} data-query-shape={at}>
            <Box as="span" css={styles.shapeRule} aria-hidden />
            <Tip label={shape.type}>
                <Box as="span" css={styles.shapeText} data-query-shape-text="" data-counted={shape.counted ? "" : undefined}>
                    <span>{shape.text}</span>
                    {shape.extra !== "" && <Box as="span" css={styles.shapeExtra}>{shape.extra}</Box>}
                </Box>
            </Tip>
            <Button size="xs" variant="ghost" css={styles.insert} data-slot-key={slotKey(slot)} aria-label={m.insertHere()}
                onClick={(event) => onSlot(slot, event.currentTarget)}>
                <FontAwesomeIcon icon={faPlus} />{m.insert()}
            </Button>
        </Box>
    );
});
