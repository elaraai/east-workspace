/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Query tab's foot (#936), under the steps (`Query Editor Spec.md`
 * §4.3): "Add a step at the end", dashed, which opens the add-step list; and
 * **Quick add** — Keep rows, Group and total, Sort by, Keep the first and Show
 * only fields, and List every part in the tree and Try the model over a range
 * where they fit (#934's `quickAddOptions`). A step that does not fit there
 * is off, with its reason on hover.
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box, Button, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import type { SlotRef } from "./model/refs.js";
import type { StepOption } from "./model/slots.js";
import type { StepKind } from "./steps/values.js";
import { Tip, slotKey, type PartActions, type PartStyles } from "./parts.js";

/** Props of {@link QueryFoot}. */
export interface QueryFootProps {
    /** The Quick add buttons, each saying whether its step fits. */
    readonly options: readonly StepOption[];
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** What "Add a step at the end" asks: the add-step list, hanging from it. */
    readonly onSlot: PartActions["onSlot"];
    /** A Quick add button pressed: its step, added at the end. */
    readonly onQuick: (kind: StepKind) => void;
}

/** The add-step list at the end of the query. */
const AT_END: SlotRef = { kind: "add-step", stepId: "" };

/**
 * Renders the foot — see the module docs.
 *
 * @param props - The Quick add buttons, and what the foot asks ({@link QueryFootProps})
 * @returns The foot
 */
export const QueryFoot = memo(function QueryFoot({ options, ps, onSlot, onQuick }: QueryFootProps) {
    const { styles, words } = ps;
    const m = words.messages;
    const button = useRecipe({ key: "button" })({ size: "md", variant: "ghost" });
    return (
        <Box css={styles.tabFoot} data-query-foot="">
            <chakra.button type="button" css={[button, styles.addAtEnd!]} data-slot-key={slotKey(AT_END)}
                onClick={(event) => onSlot(AT_END, event.currentTarget)}>
                <FontAwesomeIcon icon={faPlus} />{m.addStepAtEnd()}
            </chakra.button>
            <Box css={styles.quick} role="group" aria-label={m.quickAdd()}>
                <Box as="span" css={styles.quickLabel} aria-hidden>{m.quickAdd()}</Box>
                {options.map((option) => {
                    const pressable = (
                        <Button key={option.kind} size="xs" variant="outline" disabled={!option.fits} data-quick={option.kind}
                            onClick={() => onQuick(option.kind)}>
                            <FontAwesomeIcon icon={["fas", option.icon as IconName]} />{option.label}
                        </Button>
                    );
                    // A button that is off takes no hover: its reason hangs from a wrapper.
                    return option.fits ? pressable : (
                        <Tip key={option.kind} label={option.reason}><span>{pressable}</span></Tip>
                    );
                })}
            </Box>
        </Box>
    );
});
