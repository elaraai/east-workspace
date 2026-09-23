/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The generalized element overlays (`Plan Data Interface.md` §3.3) — one
 * wrapper every element kind shares. Elements are pure data; rich click /
 * hover surfaces resolve through the ROOT's `popover` / `hover` functions
 * with the element's ref (`run` / `event` / `chip` / `mark` / `cell`, each
 * carrying the row key). Resolution is LAZY: the resolver runs on the open
 * intent, and a `none` result simply never opens — per-element presence is
 * the author's per-ref decision, decided at interaction time. Without
 * declared resolvers the wrapper is a pass-through (no overlay machinery
 * mounts).
 *
 * Which element is open is the canvas controller's state (#815): the intent
 * goes to the controller, which runs the latest root's resolver, and each
 * element reads back only whether IT is the open one — so opening a popover
 * renders the element that opened it and the one that closed.
 *
 * A resolver that THROWS resolves nothing (the controller catches it); a body
 * that throws while RENDERING shows its one-line fallback inside the overlay
 * (#811) — neither ever reaches the canvas around it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Box, HoverCard, Popover, Portal } from "@chakra-ui/react";
import { equalFor } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanResolvers, type PlanElementRefValue } from "../context.js";
import { usePlanController, usePlanSelector } from "../controller/react.js";
import type { PlanOverlayBody, PlanSnapshot } from "../controller/index.js";
import { EastChakraComponent } from "../../../component.js";
import { PlanPartBoundary } from "./PartBoundary.js";

const refEqual = equalFor(Plan.Types.ElementRef);

export interface ElementOverlaysProps {
    /** The wrapped element's ref — build with `variant("run", { row, run })` etc. */
    elementRef: PlanElementRefValue;
    /** The resolved `plan` recipe styles — the overlay body geometry lives on
     *  the `elementOverlay` slot, never inline (#617). */
    styles: Record<string, Record<string, unknown>>;
    storageKey: string;
    /** The trigger element (the bar / tile / chip / mark). */
    children: ReactNode;
}

/**
 * Wraps one element with the root's resolver-driven popover (click) and
 * hovercard (hover). Both are CONTROLLED: the open intent runs the resolver
 * first and only a `some` body opens — an empty surface never flashes.
 */
export function ElementOverlays(props: ElementOverlaysProps) {
    const { popover, hover } = usePlanResolvers();
    if (!popover && !hover) return <>{props.children}</>;
    return <OpenableElement {...props} popover={popover} hover={hover} />;
}

/** An element with at least one declared surface — subscribed to whether it is the open one. */
function OpenableElement({ elementRef, styles, storageKey, children, popover, hover }: ElementOverlaysProps & {
    popover: boolean;
    hover: boolean;
}) {
    const controller = usePlanController();
    // This element's open body, if it is the open one — `null` otherwise, so
    // another element opening re-renders nothing here.
    const pop = usePlanSelector(useCallback((s: PlanSnapshot): PlanOverlayBody | null => {
        const open = s.overlay.popover;
        return open !== null && refEqual(open.ref, elementRef) ? open.body : null;
    }, [elementRef]));
    const hov = usePlanSelector(useCallback((s: PlanSnapshot): PlanOverlayBody | null => {
        const open = s.overlay.hover;
        return open !== null && refEqual(open.ref, elementRef) ? open.body : null;
    }, [elementRef]));
    // An element that leaves the canvas — scrolled out of the virtual window,
    // its row gone — takes its open surface with it; left open, it would
    // reappear when the element next mounted.
    const latestRef = useRef(elementRef);
    useLayoutEffect(() => { latestRef.current = elementRef; });
    useEffect(() => () => {
        controller.overlayIntent("popover", latestRef.current, false);
        controller.overlayIntent("hover", latestRef.current, false);
    }, [controller]);
    // Close unmounts the body (never a stale hidden surface); open runs the
    // resolver FIRST and only a some body opens.
    const onPopIntent = (open: boolean) => controller.overlayIntent("popover", elementRef, open);
    const onHoverIntent = (open: boolean) => controller.overlayIntent("hover", elementRef, open);

    const hoverBody = hov !== null ? (
        <Portal>
            <HoverCard.Positioner>
                <HoverCard.Content css={styles.elementOverlay}>
                    <PlanPartBoundary part="hover card" resetKey={hov} styles={styles}>
                        <EastChakraComponent value={hov} storageKey={`${storageKey}.hover`} />
                    </PlanPartBoundary>
                </HoverCard.Content>
            </HoverCard.Positioner>
        </Portal>
    ) : null;
    const popBody = pop !== null ? (
        <Portal>
            <Popover.Positioner>
                <Popover.Content css={styles.elementOverlay}>
                    <Popover.Body padding={0}>
                        <PlanPartBoundary part="popover" resetKey={pop} styles={styles}>
                            <EastChakraComponent value={pop} storageKey={`${storageKey}.popover`} />
                        </PlanPartBoundary>
                    </Popover.Body>
                </Popover.Content>
            </Popover.Positioner>
        </Portal>
    ) : null;

    if (popover && hover) {
        return (
            <Box as="span" display="contents">
                <Popover.Root open={pop !== null} onOpenChange={(d) => onPopIntent(d.open)} positioning={{ placement: "top" }}>
                    <HoverCard.Root open={hov !== null} onOpenChange={(d) => onHoverIntent(d.open)}
                        openDelay={150} positioning={{ placement: "top" }}>
                        <Popover.Trigger asChild>
                            <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
                        </Popover.Trigger>
                        {hoverBody}
                    </HoverCard.Root>
                    {popBody}
                </Popover.Root>
            </Box>
        );
    }
    if (hover) {
        return (
            <Box as="span" display="contents">
                <HoverCard.Root open={hov !== null} onOpenChange={(d) => onHoverIntent(d.open)}
                    openDelay={150} positioning={{ placement: "top" }}>
                    <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
                    {hoverBody}
                </HoverCard.Root>
            </Box>
        );
    }
    return (
        <Box as="span" display="contents">
            <Popover.Root open={pop !== null} onOpenChange={(d) => onPopIntent(d.open)} positioning={{ placement: "top" }}>
                <Popover.Trigger asChild>{children}</Popover.Trigger>
                {popBody}
            </Popover.Root>
        </Box>
    );
}
