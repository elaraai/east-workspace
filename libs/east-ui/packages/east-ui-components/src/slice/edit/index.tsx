/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ReactNode } from "react";
import { Popover as ChakraPopover, Portal, Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { useSliceDensity } from "../density";
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
    /**
     * Drop the body's own padding and gap, for a body that is a LIST.
     *
     * @remarks
     * The default body is shaped for form content — clause rows and fields —
     * so it insets 14px and gaps its children 12px. A list wants the opposite:
     * rows that run edge to edge, with their own rhythm and hairlines spanning
     * the full width. Without this the list is padded twice and its rules stop
     * short of the border.
     */
    flush?: boolean;
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
    open, onOpenChange, trigger, label, size = "sm", flush, footLeft, footActions, children,
}: SliceEditPopoverProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })({ size, ...(flush === true && { flush: true }) });
    const density = useSliceDensity();
    if (density === "editor") {
        // Inside the sectioned editor the popover is forbidden — the editor
        // is the terminal surface. The same trigger toggles an inline
        // disclosure in flow instead (the editor body scrolls as it grows).
        return (
            <Box display="flex" flexDirection="column" gap="{spacing.1.5}" minWidth="0" width="full">
                <chakra.span display="inline-flex" onClick={() => onOpenChange(!open)}>{trigger}</chakra.span>
                {open && (
                    <Box borderTopWidth="1px" borderColor="border.subtle" paddingTop="{spacing.2}">
                        <Box as="span" textStyle="caption.eyebrow" color="fg.subtle">{label}</Box>
                        <Box css={styles.body} padding="0" paddingTop="{spacing.2}" maxHeight="none">{children}</Box>
                        {(footLeft !== undefined || footActions !== undefined) && (
                            <Box css={styles.foot} padding="0" paddingTop="{spacing.2}" borderTopWidth="0">
                                {footLeft}
                                <Box css={styles.footActions}>{footActions}</Box>
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        );
    }
    return (
        <ChakraPopover.Root
            open={open}
            onOpenChange={(d) => onOpenChange(d.open)}
            positioning={{ placement: "bottom" }}
            lazyMount
            onInteractOutside={(e) => {
                // Portalled select / combobox listboxes render at body level;
                // interacting with them must not dismiss the editor.
                const target = e.detail.originalEvent?.target as Element | null | undefined;
                if (target?.closest?.('[data-scope="select"], [data-scope="combobox"]')) e.preventDefault();
            }}
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
