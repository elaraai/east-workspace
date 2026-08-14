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
 */

import { useState, type ReactNode } from "react";
import { Box, HoverCard, Popover, Portal } from "@chakra-ui/react";
import { usePlanResolvers, type PlanElementRefValue, type PlanElementResolver } from "../context.js";
import { EastChakraComponent } from "../../../component.js";

/** A resolved overlay body (the resolver's some-value). */
type BodyValue = Extract<ReturnType<PlanElementResolver>, { type: "some" }>["value"];

/** Run a resolver for a ref; `undefined` when it resolves none (or throws). */
function resolveBody(
    resolver: PlanElementResolver,
    ref: PlanElementRefValue,
    what: "popover" | "hover",
): BodyValue | undefined {
    try {
        const res = resolver(ref);
        return res.type === "some" ? res.value : undefined;
    } catch (err) {
        console.error(`[Plan] ${what} resolver failed:`, err);
        return undefined;
    }
}

export interface ElementOverlaysProps {
    /** The wrapped element's ref — build with `variant("run", { row, run })` etc. */
    elementRef: PlanElementRefValue;
    storageKey: string;
    /** The trigger element (the bar / tile / chip / mark). */
    children: ReactNode;
}

/**
 * Wraps one element with the root's resolver-driven popover (click) and
 * hovercard (hover). Both are CONTROLLED: the open intent runs the resolver
 * first and only a `some` body opens — an empty surface never flashes.
 */
export function ElementOverlays({ elementRef, storageKey, children }: ElementOverlaysProps) {
    const { popover, hover } = usePlanResolvers();
    const [pop, setPop] = useState<{ open: boolean; body: BodyValue | null }>({ open: false, body: null });
    const [hov, setHov] = useState<{ open: boolean; body: BodyValue | null }>({ open: false, body: null });
    if (popover === undefined && hover === undefined) return <>{children}</>;

    // Close unmounts the body (never a stale hidden surface); open runs the
    // resolver FIRST and only a some body opens.
    const onPopIntent = (open: boolean) => {
        if (!open) { setPop({ open: false, body: null }); return; }
        const body = popover !== undefined ? resolveBody(popover, elementRef, "popover") : undefined;
        if (body !== undefined) setPop({ open: true, body });
    };
    const onHoverIntent = (open: boolean) => {
        if (!open) { setHov({ open: false, body: null }); return; }
        const body = hover !== undefined ? resolveBody(hover, elementRef, "hover") : undefined;
        if (body !== undefined) setHov({ open: true, body });
    };

    const hoverBody = hov.body !== null ? (
        <Portal>
            <HoverCard.Positioner>
                <HoverCard.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                    <EastChakraComponent value={hov.body} storageKey={`${storageKey}.hover`} />
                </HoverCard.Content>
            </HoverCard.Positioner>
        </Portal>
    ) : null;
    const popBody = pop.body !== null ? (
        <Portal>
            <Popover.Positioner>
                <Popover.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                    <Popover.Body padding={0}>
                        <EastChakraComponent value={pop.body} storageKey={`${storageKey}.popover`} />
                    </Popover.Body>
                </Popover.Content>
            </Popover.Positioner>
        </Portal>
    ) : null;

    if (popover !== undefined && hover !== undefined) {
        return (
            <Box as="span" display="contents">
                <Popover.Root open={pop.open} onOpenChange={(d) => onPopIntent(d.open)} positioning={{ placement: "top" }}>
                    <HoverCard.Root open={hov.open} onOpenChange={(d) => onHoverIntent(d.open)}
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
    if (hover !== undefined) {
        return (
            <Box as="span" display="contents">
                <HoverCard.Root open={hov.open} onOpenChange={(d) => onHoverIntent(d.open)}
                    openDelay={150} positioning={{ placement: "top" }}>
                    <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
                    {hoverBody}
                </HoverCard.Root>
            </Box>
        );
    }
    return (
        <Box as="span" display="contents">
            <Popover.Root open={pop.open} onOpenChange={(d) => onPopIntent(d.open)} positioning={{ placement: "top" }}>
                <Popover.Trigger asChild>{children}</Popover.Trigger>
                {popBody}
            </Popover.Root>
        </Box>
    );
}
