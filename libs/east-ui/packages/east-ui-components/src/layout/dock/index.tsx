/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box as ChakraBox, IconButton, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faChevronLeft, faChevronRight, faChevronUp, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Dock } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

// The rail/header `icon` is a dynamic Font Awesome name (e.g. "book"); register
// the free-solid set so it resolves by name (idempotent — safe if already added).
library.add(fas);

const dockEqual = equalFor(Dock.Types.Dock);

/** East Dock value type. */
export type DockValue = ValueTypeOf<typeof Dock.Types.Dock>;

export interface EastChakraDockProps {
    value: DockValue;
    storageKey: string;
}

/**
 * Renders an East UI Dock — an inline panel that collapses along an axis to a
 * compact icon rail and stays in the document flow (an ordinary flex child; it
 * never overlays, so a stacked drop-target is never covered).
 *
 * Collapsed state follows the interactive-state pattern: local state seeded
 * from the East value, synced when a `collapsed` prop drives it, else toggled
 * by the built-in control and optionally persisted (keyed by the structural
 * storage key). The body is kept mounted (hidden) while collapsed by default so
 * a child's scroll / drag / search state survives; `lazy` defers first mount.
 */
export const EastChakraDock = memo(function EastChakraDock({ value, storageKey }: EastChakraDockProps) {
    const collapsedProp = getSomeorUndefined(value.collapsed);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const orientation = (style ? getSomeorUndefined(style.orientation)?.type : undefined) ?? "horizontal";
    const side = (style ? getSomeorUndefined(style.side)?.type : undefined) ?? "start";
    const persist = (style ? getSomeorUndefined(style.persist)?.type : undefined) ?? "none";
    const expandedSize = (style ? getSomeorUndefined(style.expandedSize) : undefined) ?? "280px";
    const railSize = (style ? getSomeorUndefined(style.railSize) : undefined) ?? "44px";
    const icon = style ? getSomeorUndefined(style.icon) : undefined;
    const label = style ? getSomeorUndefined(style.label) : undefined;
    const badge = style ? getSomeorUndefined(style.badge) : undefined;
    const keepMounted = (style ? getSomeorUndefined(style.keepMounted) : undefined) ?? true;
    const lazy = (style ? getSomeorUndefined(style.lazy) : undefined) ?? false;
    const animated = (style ? getSomeorUndefined(style.animated) : undefined) ?? false;
    const onCollapsedChangeFn = useMemo(() => getSomeorUndefined(value.onCollapsedChange), [value.onCollapsedChange]);

    const defaultCollapsed = getSomeorUndefined(value.defaultCollapsed) ?? false;
    const horizontal = orientation === "horizontal";
    const persistKey = `${storageKey}.dock.collapsed`;

    // Interactive-state: local state seeded from collapsed ?? defaultCollapsed.
    const [collapsed, setCollapsed] = useState<boolean>(collapsedProp ?? defaultCollapsed);
    // Controlled: a State-driven `collapsed` prop pushes into local state.
    useEffect(() => { if (collapsedProp !== undefined) setCollapsed(collapsedProp); }, [collapsedProp]);
    // Uncontrolled + persist: hydrate once from storage on mount.
    useEffect(() => {
        if (collapsedProp !== undefined || persist === "none") return;
        try {
            const store = persist === "session" ? window.sessionStorage : window.localStorage;
            const raw = store.getItem(persistKey);
            if (raw !== null) setCollapsed(raw === "true");
        } catch { /* storage unavailable (SSR / privacy mode) */ }
        // Mount-only hydrate.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // `lazy`: mount the body only after the first expand.
    const [everExpanded, setEverExpanded] = useState<boolean>(!(collapsedProp ?? defaultCollapsed) || !lazy);
    const controlRef = useRef<HTMLButtonElement | null>(null);

    const setCollapsedState = useCallback((next: boolean) => {
        setCollapsed(next);
        if (!next) setEverExpanded(true);
        if (collapsedProp === undefined && persist !== "none") {
            try {
                const store = persist === "session" ? window.sessionStorage : window.localStorage;
                store.setItem(persistKey, String(next));
            } catch { /* storage unavailable */ }
        }
        if (onCollapsedChangeFn) queueMicrotask(() => onCollapsedChangeFn(next));
    }, [collapsedProp, persist, persistKey, onCollapsedChangeFn]);

    const handleToggle = useCallback(() => { setCollapsedState(!collapsed); }, [collapsed, setCollapsedState]);

    const styles = useSlotRecipe({ key: "dock" })();

    // Chevron points AWAY from `side` when collapsed (expand outward) and TOWARD
    // `side` when expanded (collapse inward).
    const pointToStart = collapsed ? side === "start" : side === "end";
    const chevron = horizontal
        ? (pointToStart ? faChevronRight : faChevronLeft)
        : (pointToStart ? faChevronDown : faChevronUp);

    const name = label ?? "panel";
    const ariaLabel = collapsed ? `Expand ${name}` : `Collapse ${name}`;

    // Size along the collapse axis; the cross axis fills. flexShrink 0 so the
    // panel holds its size and the sibling (flex:1) reclaims the freed space.
    const sizeProps = horizontal
        ? { width: collapsed ? railSize : expandedSize, height: "100%", flexShrink: 0 }
        : { height: collapsed ? railSize : expandedSize, width: "100%", flexShrink: 0 };
    const transition = animated
        ? { transitionProperty: horizontal ? "width" : "height", transitionDuration: "0.18s", transitionTimingFunction: "ease" }
        : {};

    const badgeEl = badge !== undefined ? <ChakraBox as="span" css={styles.badge}>{badge}</ChakraBox> : null;
    const iconEl = icon !== undefined ? <FontAwesomeIcon icon={icon as IconName} /> : null;
    const toggle = (expanded: boolean) => (
        <IconButton
            ref={controlRef}
            css={styles.toggle}
            aria-label={ariaLabel}
            aria-expanded={expanded}
            onClick={handleToggle}
            variant="ghost"
            size="xs"
        >
            <FontAwesomeIcon icon={chevron} />
        </IconButton>
    );

    // Body mounts when expanded, or kept mounted (hidden) while collapsed;
    // `lazy` defers until first expand.
    const bodyMounted = (!collapsed || keepMounted) && (everExpanded || !lazy);
    const body = bodyMounted
        ? value.body.map((child, i) => (
            <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.body.${i}`} />
        ))
        : null;

    if (collapsed) {
        return (
            <ChakraBox css={styles.root} {...sizeProps} {...transition} title={label}>
                <ChakraBox
                    css={styles.rail}
                    flex={1}
                    flexDirection={horizontal ? "column" : "row"}
                    onClick={handleToggle}
                >
                    {toggle(false)}
                    {iconEl}
                    {badgeEl}
                </ChakraBox>
                {body !== null && <ChakraBox css={styles.body} display="none">{body}</ChakraBox>}
            </ChakraBox>
        );
    }

    return (
        <ChakraBox css={styles.root} {...sizeProps} {...transition}>
            <ChakraBox css={styles.header}>
                <ChakraBox css={styles.title}>
                    {iconEl}
                    {label !== undefined && <ChakraBox as="span" css={styles.label}>{label}</ChakraBox>}
                    {badgeEl}
                </ChakraBox>
                {toggle(true)}
            </ChakraBox>
            <ChakraBox css={styles.body}>{body}</ChakraBox>
        </ChakraBox>
    );
}, (prev, next) => dockEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
