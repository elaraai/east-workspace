/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { cloneElement, useEffect, useId, useRef, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Popover as ChakraPopover, Portal, Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { useSliceDensity } from "../density";
import { POPOVER_GUTTER } from "../../overlays/popover/gutter.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

/** A control the focus can go back to, in an anchored popover's anchor. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What a {@link SliceEditPopover} hangs from: its trigger, or an anchor. */
export type SliceEditPopoverAnchor =
    | {
        /**
         * The compact trigger the popover anchors to: ONE button — a chip, a
         * pill, an icon — that the popover's trigger props land on (#1231), so the
         * keyboard reaches it and Enter or Space opens it. It holds no other
         * control: a clause chip's ×, which is the pointer's alone, is a span.
         */
        trigger: ReactElement;
        anchor?: undefined;
    }
    | {
        trigger?: undefined;
        /**
         * What it hangs from when something other than a trigger opens it — the
         * chip whose menu item opened it (#1229): wrapped in an element of its
         * own, the popover's anchor, and given none of a trigger's props, so a
         * menu's trigger in it stays the menu's. Its host opens it and holds the
         * toolbar item it sits in while it is open; as it closes, the focus goes
         * back to the first control in it.
         */
        anchor: ReactNode;
    };

/** What the sectioned editor's disclosure sets on its trigger (#1253). */
interface DisclosureTriggerProps {
    onClick?: ((e: MouseEvent<HTMLElement>) => void) | undefined;
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
}

/** Props of {@link SliceEditPopover}: what it hangs from, and the rest. */
export type SliceEditPopoverProps = SliceEditPopoverAnchor & {
    /** Controlled open state (seeded from the affordance's `editOpen` IR flag). */
    open: boolean;
    /** Fired on Esc / click-outside / trigger toggle. Apply / Cancel call this with `false`. */
    onOpenChange: (open: boolean) => void;
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
    /** The element the focus goes to as it opens — the first focusable in it
     *  (its head's ×) when omitted, or when this finds none. */
    initialFocusEl?: (() => HTMLElement | null) | undefined;
    /** The editor body. */
    children: ReactNode;
};

/**
 * The single overlay shape every compact `Slice.*` affordance opens to edit.
 * Anchored to its trigger, fixed width, body scrolls internally (`maxH 50vh`);
 * head + foot stay pinned. Floats over content — opening it never resizes the
 * parent. Styled entirely by the `sliceEdit` slot recipe; only the foot's
 * action grammar varies per edit case. See `design/slice.html#slice-edit`.
 *
 * The trigger is the affordance's own button, the popover's trigger props
 * merged onto it (#1231): a tab stop that Enter or Space opens, its
 * `aria-expanded` the popover's. A popover something else opens — a toolbar
 * chip's menu item (#1229) — hangs from an `anchor` instead. Inside the
 * sectioned editor the same button opens an inline disclosure, its
 * `aria-expanded` the disclosure's (#1253).
 */
export function SliceEditPopover({
    open, onOpenChange, trigger, anchor, label, size = "sm", flush, footLeft, footActions, initialFocusEl, children,
}: SliceEditPopoverProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })({ size, ...(flush === true && { flush: true }) });
    const density = useSliceDensity();
    const anchored = trigger === undefined;
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const regionId = useId();
    // An anchored popover has no trigger for Zag to give the focus back to: as
    // it closes, the focus goes back to its anchor's first control — unless it
    // went to a control of its own choosing (a click on another).
    const wasOpen = useRef(open);
    useEffect(() => {
        const opened = wasOpen.current;
        wasOpen.current = open;
        if (!anchored || open || !opened) return undefined;
        const frame = requestAnimationFrame(() => {
            const active = document.activeElement;
            if (active !== null && active !== document.body && contentRef.current?.contains(active) !== true) return;
            anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, anchored]);
    if (density === "editor") {
        // Inside the sectioned editor the popover is forbidden — the editor
        // is the terminal surface. The same trigger toggles an inline
        // disclosure in flow instead (the editor body scrolls as it grows):
        // the trigger is the button itself, its own click kept, so Enter and
        // Space open it and it says it expands (#1253).
        const own = trigger as ReactElement<DisclosureTriggerProps> | undefined;
        const toggle = own === undefined ? anchor : cloneElement(own, {
            "aria-expanded": open,
            ...(open && { "aria-controls": regionId }),
            onClick: (e: MouseEvent<HTMLElement>) => {
                own.props.onClick?.(e);
                onOpenChange(!open);
            },
        });
        // The trigger keeps its own width; the disclosure under it spans the
        // column. On a touch screen its row is 44px tall, the trigger in its
        // middle: the triggers the editor stacks one to a row each keep a whole
        // 44px target, which their halos fill (#1253).
        return (
            <Box display="flex" flexDirection="column" alignItems="flex-start" justifyContent="center" minHeight={{ _coarse: "44px" }}
                gap="{spacing.1.5}" minWidth="0" width="full">
                {toggle}
                {open && (
                    <Box id={regionId} alignSelf="stretch" borderTopWidth="1px" borderColor="border.subtle" paddingTop="{spacing.2}">
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
            positioning={{ placement: "bottom", gutter: POPOVER_GUTTER }}
            lazyMount
            {...(initialFocusEl !== undefined && { initialFocusEl })}
            onInteractOutside={(e) => {
                // Portalled select / combobox listboxes render at body level;
                // interacting with them must not dismiss the editor.
                const target = e.detail.originalEvent?.target as Element | null | undefined;
                if (target?.closest?.('[data-scope="select"], [data-scope="combobox"]')) e.preventDefault();
            }}
        >
            {anchored
                ? <ChakraPopover.Anchor ref={anchorRef} display="inline-flex">{anchor}</ChakraPopover.Anchor>
                : <ChakraPopover.Trigger asChild>{trigger}</ChakraPopover.Trigger>}
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content ref={contentRef} css={styles.content} padding="0" minWidth="0" maxWidth="none" width={size === "lg" ? "380px" : "320px"}>
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
