/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { cloneElement, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Popover as ChakraPopover, Portal, Box, chakra, usePopoverContext } from "@chakra-ui/react";
import { useSliceDensity } from "../density";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { POPOVER_GUTTER } from "../../overlays/popover/gutter.js";
import { frameBounds } from "../../overlays/popover/frame-bounds.js";
import { FOCUSABLE } from "../../primitives/focusable.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FrameOverlaySlot } from "../../layout/builder-frame/overlay-slot.js";

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
    /**
     * Whether it stays open as the focus leaves it — for one whose action
     * moves the focus to what it is about, as a conflict's Go to does — while
     * a press outside it, Escape and its × still close it. It closes as the
     * focus leaves it by default.
     */
    keepOnFocusOut?: boolean | undefined;
    /**
     * A rect it hangs from in place of its trigger or anchor, read at every
     * placement — `null` for theirs — and with no arrow: the conflicts popover
     * hangs by its frame's other side where it would cover the item a Go to
     * showed. Another function places it again; none, it hangs from its
     * trigger.
     */
    hangFrom?: (() => DOMRectInit | null) | undefined;
    /** It appears and goes at once, with no fade or scale. */
    still?: boolean | undefined;
    /** The editor body. */
    children: ReactNode;
};

/** Places an open popover again as what it hangs from changes: Zag places it again only as its anchor or the page moves. */
function Rehang({ from }: { from: unknown }) {
    const popover = usePopoverContext();
    const last = useRef(from);
    useLayoutEffect(() => {
        if (Object.is(last.current, from)) return;
        last.current = from;
        if (popover.open) popover.reposition();
    });
    return null;
}

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
 *
 * Inside a builder's frame — a rail's chip, its Filters — the popover keeps to
 * the frame's sides while it fits between them (#1393): it slides along its
 * trigger's edge rather than hang past the frame's side, as it slides inside
 * the page anywhere else, and in a frame narrower than it — a phone's — inside
 * the page. Down the page it keeps to the page, flipping above its trigger
 * where there is no room below ({@link frameBounds}).
 *
 * In a phone's frame (560px or narrower), a popover its toolbar opens is a
 * view over the whole builder instead, in the frame's overlay slot, as the
 * rail's Filters view is (ruled 3 Nov 2026): ← back and its label at its
 * head, the same body, its foot's actions at its end ({@link FramePhoneView}).
 */
export function SliceEditPopover({
    open, onOpenChange, trigger, anchor, label, size = "sm", flush, footLeft, footActions, initialFocusEl, keepOnFocusOut = false, hangFrom, still = false, children,
}: SliceEditPopoverProps) {
    // Its styles made once for the theme and its variants (#1398, CL9): its trigger draws again with what it shows — a
    // timeline's date navigator's with each day its view crosses — and its recipe would work every slot out again.
    const styles = useSlotStyles("sliceEdit", { size, ...(flush === true && { flush: true }) });
    const density = useSliceDensity();
    // A phone's frame's overlay slot, where its toolbar's popovers open as views over the builder.
    const overlay = useContext(FrameOverlaySlot);
    const anchored = trigger === undefined;
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    // Below its trigger, kept across the page to the builder's frame it opens in — its trigger's or its anchor's — while
    // it fits there, read at every placement; below the rect it hangs from in their place, where it is given one. Its
    // bounds are made as it is placed: Zag copies the positioning it is given as the popover draws, which would keep what
    // the bounds read then — the page's, the first time it opens, its content not there yet.
    const hangRef = useRef(hangFrom);
    hangRef.current = hangFrom;
    const positioning = useMemo(() => ({
        placement: "bottom" as const,
        gutter: POPOVER_GUTTER,
        boundary: () => frameBounds(() => (anchored ? anchorRef.current : triggerRef.current), () => contentRef.current),
        getAnchorRect: () => hangRef.current?.() ?? null,
    }), [anchored]);
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
            <Box css={styles.disclosure}>
                {toggle}
                {open && (
                    <Box id={regionId} css={styles.disclosureRegion}>
                        <Box as="span" css={styles.disclosureLabel}>{label}</Box>
                        <Box css={[styles.body, styles.disclosureBody]}>{children}</Box>
                        {(footLeft !== undefined || footActions !== undefined) && (
                            <Box css={[styles.foot, styles.disclosureFoot]}>
                                {footLeft}
                                <Box css={styles.footActions}>{footActions}</Box>
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        );
    }
    if (overlay !== null) {
        return (
            <FramePhoneView slot={overlay} open={open} onOpenChange={onOpenChange} toggle={trigger === undefined ? anchor : trigger} anchored={anchored}
                label={label} footLeft={footLeft} footActions={footActions} initialFocusEl={initialFocusEl}>
                {children}
            </FramePhoneView>
        );
    }
    return (
        <ChakraPopover.Root
            open={open}
            onOpenChange={(d) => onOpenChange(d.open)}
            positioning={positioning}
            lazyMount
            {...(initialFocusEl !== undefined && { initialFocusEl })}
            onInteractOutside={(e) => {
                // Portalled select / combobox listboxes render at body level;
                // interacting with them must not dismiss the editor.
                const target = e.detail.originalEvent?.target as Element | null | undefined;
                if (target?.closest?.('[data-scope="select"], [data-scope="combobox"]')) e.preventDefault();
            }}
            {...(keepOnFocusOut && { onFocusOutside: (e: { preventDefault: () => void }) => { e.preventDefault(); } })}
        >
            {anchored
                ? <ChakraPopover.Anchor ref={anchorRef} css={styles.anchor}>{anchor}</ChakraPopover.Anchor>
                : <ChakraPopover.Trigger ref={triggerRef} asChild>{trigger}</ChakraPopover.Trigger>}
            <Rehang from={hangFrom} />
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content ref={contentRef} css={styles.content} data-still={still ? "" : undefined}>
                        {hangFrom === undefined && (
                            <ChakraPopover.Arrow>
                                <ChakraPopover.ArrowTip />
                            </ChakraPopover.Arrow>
                        )}
                        <Box css={styles.head}>
                            <Box as="span" css={styles.headLabel}>{label}</Box>
                            <ChakraPopover.CloseTrigger asChild>
                                <chakra.button type="button" css={styles.headClose} aria-label="Close">
                                    <FontAwesomeIcon icon={faXmark} />
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

/** Props of {@link FramePhoneView}. */
interface FramePhoneViewProps {
    /** The frame's overlay slot it is drawn in. */
    slot: HTMLElement;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The trigger, which toggles it — or the anchor, which its host opens it from. */
    toggle: ReactNode;
    anchored: boolean;
    label: ReactNode;
    footLeft: ReactNode;
    footActions: ReactNode;
    initialFocusEl: (() => HTMLElement | null) | undefined;
    children: ReactNode;
}

/**
 * A toolbar's popover in a phone's frame (ruled 3 Nov 2026): a view over the
 * whole builder in the frame's overlay slot — ← back and its label at its
 * head, its body, its foot's actions at its end. Its trigger toggles it, as
 * the popover's does; ←, Esc and the foot's actions close it; the focus moves
 * in as it opens and back to its trigger, or its anchor's first control, as
 * it closes.
 */
function FramePhoneView({ slot, open, onOpenChange, toggle, anchored, label, footLeft, footActions, initialFocusEl, children }: FramePhoneViewProps) {
    const styles = useSlotStyles("frameView");
    const holdRef = useRef<HTMLSpanElement | null>(null);
    const viewRef = useRef<HTMLDivElement | null>(null);
    const wasOpen = useRef(open);
    useEffect(() => {
        const opened = wasOpen.current;
        wasOpen.current = open;
        if (open === opened) return undefined;
        const frame = requestAnimationFrame(() => {
            if (open) (initialFocusEl?.() ?? viewRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
            else {
                const active = document.activeElement;
                if (active !== null && active !== document.body && active.isConnected) return;
                holdRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [open, initialFocusEl]);
    const own = anchored ? undefined : toggle as ReactElement<DisclosureTriggerProps>;
    const trigger = own === undefined ? toggle : cloneElement(own, {
        "aria-expanded": open,
        onClick: (e: MouseEvent<HTMLElement>) => {
            own.props.onClick?.(e);
            onOpenChange(!open);
        },
    });
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
    };
    return (
        <>
            <chakra.span ref={holdRef} css={styles.hold}>{trigger}</chakra.span>
            {open && createPortal(
                <Box ref={viewRef} css={styles.root} role="region" aria-label={typeof label === "string" ? label : undefined} data-frame-view="" onKeyDown={onKeyDown}>
                    <Box css={styles.head}>
                        <chakra.button type="button" css={styles.back} aria-label="Back" data-frame-view-back="" onClick={() => onOpenChange(false)}>
                            <FontAwesomeIcon icon={faArrowLeft} aria-hidden />
                        </chakra.button>
                        <Box as="span" css={styles.title}>{label}</Box>
                    </Box>
                    <Box css={styles.body}>{children}</Box>
                    {(footLeft !== undefined || footActions !== undefined) && (
                        <Box css={styles.foot}>
                            {footLeft}
                            <Box css={styles.footActions}>{footActions}</Box>
                        </Box>
                    )}
                </Box>,
                slot,
            )}
        </>
    );
}
