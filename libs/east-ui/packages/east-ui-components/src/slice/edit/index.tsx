/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ReactNode } from "react";
import { Popover as ChakraPopover, Portal, Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

export interface SliceEditPopoverProps {
    /** Controlled open state (seeded from the affordance's `editOpen` IR flag). */
    open: boolean;
    /** Fired on Esc / click-outside / trigger toggle. Apply / Cancel call this with `false`. */
    onOpenChange: (open: boolean) => void;
    /** The compact trigger (chip / pill) the popover anchors to. */
    trigger: ReactNode;
    /** Mono head label naming the edit target. */
    label: ReactNode;
    /** `sm` (320px) for chip / range editors, `lg` (380px) for predicate editors. */
    size?: "sm" | "lg";
    /** Left foot slot — the contextual link (`Save as cohort →`, `Remove cohort`, …). */
    footLeft?: ReactNode;
    /** Right foot cluster — the action grammar (`Cancel · Apply`, `Done`, …). */
    footActions?: ReactNode;
    /** The editor body. */
    children: ReactNode;
}

/**
 * The single overlay shape every compact `Slice.*` affordance opens to edit.
 * Anchored to its trigger, fixed width, body scrolls internally (`maxH 50vh`);
 * head + foot stay pinned. Floats over content — opening it never resizes the
 * parent. Styled entirely by the `sliceEdit` slot recipe; only the foot's
 * action grammar varies per edit case. See `design/slice.html#slice-edit`.
 */
export function SliceEditPopover({
    open, onOpenChange, trigger, label, size = "sm", footLeft, footActions, children,
}: SliceEditPopoverProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })({ size });
    return (
        <ChakraPopover.Root
            open={open}
            onOpenChange={(d) => onOpenChange(d.open)}
            positioning={{ placement: "bottom" }}
            lazyMount
        >
            <ChakraPopover.Trigger asChild>
                <chakra.span display="inline-flex">{trigger}</chakra.span>
            </ChakraPopover.Trigger>
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content css={styles.content} padding="0" minWidth="0" maxWidth="none" width={size === "lg" ? "380px" : "320px"}>
                        <ChakraPopover.Arrow>
                            <ChakraPopover.ArrowTip />
                        </ChakraPopover.Arrow>
                        <Box css={styles.head}>
                            <Box as="span" css={styles.headLabel}>{label}</Box>
                            <ChakraPopover.CloseTrigger asChild>
                                <chakra.button type="button" css={styles.headClose} aria-label="Close">
                                    <FontAwesomeIcon icon={faXmark} style={{ fontSize: "13px" }} />
                                </chakra.button>
                            </ChakraPopover.CloseTrigger>
                        </Box>
                        <Box css={styles.body}>{children}</Box>
                        {(footLeft !== undefined || footActions !== undefined) && (
                            <Box css={styles.foot}>
                                {footLeft}
                                <Box css={styles.footActions}>{footActions}</Box>
                            </Box>
                        )}
                    </ChakraPopover.Content>
                </ChakraPopover.Positioner>
            </Portal>
        </ChakraPopover.Root>
    );
}
