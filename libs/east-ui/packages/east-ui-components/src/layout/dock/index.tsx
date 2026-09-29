/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box as ChakraBox, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faAnglesUp, faAnglesDown } from "@fortawesome/free-solid-svg-icons";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Dock } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { usePersistedState } from "../../hooks/usePersistedState";

// The rail's `icon` is a dynamic Font Awesome name (e.g. "book"); register
// the free-solid set so it resolves by name (idempotent — safe if already added).
library.add(fas);

const dockEqual = equivalentFor(Dock.Types.Dock);

/** East Dock value type. */
export type DockValue = ValueTypeOf<typeof Dock.Types.Dock>;

export interface EastChakraDockProps {
    value: DockValue;
    storageKey: string;
}

/**
 * Renders an East UI Dock — an inline pane that collapses along an axis to a
 * compact icon rail and stays in the document flow (an ordinary flex child; it
 * never overlays, so a stacked drop-target is never covered).
 *
 * Expanded, the pane's one row is its tab row — its tabs, or its label as the
 * only tab — with the collapse control at the row's end. Collapsed, the rail
 * holds the expand control, then the icon tile, the badge, the label and the
 * detail; while the pane is active the tile and the badge are the brand's.
 *
 * Collapsed state follows the interactive-state pattern: local state seeded
 * from the East value, synced when a `collapsed` prop drives it, else toggled
 * by the controls and optionally persisted (keyed by the structural storage
 * key). Every body is kept mounted (hidden) while the pane is collapsed, and
 * every tab's while another is open, so a child's scroll / drag / search state
 * survives; `lazy` defers first mount.
 */
export const EastChakraDock = memo(function EastChakraDock({ value, storageKey }: EastChakraDockProps) {
    const collapsedProp = getSomeorUndefined(value.collapsed);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const orientation = (style ? getSomeorUndefined(style.orientation)?.type : undefined) ?? "horizontal";
    const side = (style ? getSomeorUndefined(style.side)?.type : undefined) ?? "start";
    const persist = (style ? getSomeorUndefined(style.persist)?.type : undefined) ?? "none";
    const surface = (style ? getSomeorUndefined(style.surface)?.type : undefined) ?? "card";
    const expandedSize = (style ? getSomeorUndefined(style.expandedSize) : undefined) ?? "280px";
    const railSize = (style ? getSomeorUndefined(style.railSize) : undefined) ?? "44px";
    const icon = style ? getSomeorUndefined(style.icon) : undefined;
    const label = style ? getSomeorUndefined(style.label) : undefined;
    const badge = style ? getSomeorUndefined(style.badge) : undefined;
    const active = (style ? getSomeorUndefined(style.active) : undefined) ?? false;
    const detail = style ? getSomeorUndefined(style.detail) : undefined;
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

    // The open tab, kept by the structural storage key; the first when none is.
    const tabs = value.tabs;
    const { state: tabState, setState: setTabState } = usePersistedState<{ key: string | undefined }>(
        `${storageKey}.dock.tab`,
        { key: tabs[0]?.key },
    );
    const openTab = tabs.find(tab => tab.key === tabState.key) ?? tabs[0];
    const ids = useId();
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const onTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const last = tabs.length - 1;
        const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
            : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
                : event.key === "Home" ? 0
                    : event.key === "End" ? last
                        : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setTabState({ key: tabs[next]!.key });
        tabRefs.current[next]?.focus();
    }, [tabs, setTabState]);

    const styles = useSlotRecipe({ key: "dock" })();

    // The control points where the pane goes: collapsing, toward the edge it
    // pins to; expanding, away from it.
    const pointsToStart = !collapsed === (side === "start");
    const angles = horizontal
        ? (pointsToStart ? faAnglesLeft : faAnglesRight)
        : (pointsToStart ? faAnglesUp : faAnglesDown);

    const name = label ?? "panel";
    const ariaLabel = collapsed ? `Expand ${name}` : `Collapse ${name}`;

    // Size along the collapse axis; the cross axis fills. flexShrink 0 so the
    // pane holds its size and the sibling (flex:1) reclaims the freed space.
    const sizeProps = horizontal
        ? { width: collapsed ? railSize : expandedSize, height: "100%", flexShrink: 0 }
        : { height: collapsed ? railSize : expandedSize, width: "100%", flexShrink: 0 };
    const transition = animated
        ? { transitionProperty: horizontal ? "width" : "height", transitionDuration: "0.18s", transitionTimingFunction: "ease" }
        : {};
    const rootAttrs = {
        "data-orientation": orientation,
        "data-side": side,
        "data-surface": surface,
        ...(collapsed ? { "data-collapsed": "" } : {}),
    };

    const toggle = (
        <chakra.button
            type="button"
            css={styles.toggle}
            aria-label={ariaLabel}
            aria-expanded={!collapsed}
            title={ariaLabel}
            onClick={handleToggle}
        >
            <FontAwesomeIcon icon={angles} />
        </chakra.button>
    );

    // Bodies mount when expanded, or stay mounted (hidden) while collapsed;
    // `lazy` defers until first expand. With tabs, each tab is a panel and
    // only the open one shows. The rail and the tab row sit before the
    // panels, so every child is keyed: a toggle keeps the panels mounted.
    const bodyMounted = (!collapsed || keepMounted) && (everExpanded || !lazy);
    const panels = !bodyMounted ? null : tabs.length > 0
        ? tabs.map((tab, index) => (
            <ChakraBox
                key={tab.key}
                css={styles.body}
                role="tabpanel"
                id={`${ids}-panel-${index}`}
                aria-labelledby={`${ids}-tab-${index}`}
                hidden={collapsed || tab.key !== openTab?.key}
            >
                {tab.body.map((child, i) => (
                    <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.tab.${tab.key}.${i}`} />
                ))}
            </ChakraBox>
        ))
        : (
            <ChakraBox css={styles.body} hidden={collapsed}>
                {value.body.map((child, i) => (
                    <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.body.${i}`} />
                ))}
            </ChakraBox>
        );

    if (collapsed) {
        return (
            <ChakraBox css={styles.root} {...rootAttrs} {...sizeProps} {...transition}>
                <ChakraBox key="railBar" css={styles.railBar}>{toggle}</ChakraBox>
                <ChakraBox key="rail" css={styles.rail} onClick={handleToggle} title={label} data-active={active ? "" : undefined}>
                    {icon !== undefined && (
                        <ChakraBox as="span" css={styles.iconTile}>
                            <FontAwesomeIcon icon={icon as IconName} />
                        </ChakraBox>
                    )}
                    {badge !== undefined && badge !== "" && <ChakraBox as="span" css={styles.badge}>{badge}</ChakraBox>}
                    {label !== undefined && <ChakraBox as="span" css={styles.railLabel}>{label}</ChakraBox>}
                    {detail !== undefined && <ChakraBox as="span" css={styles.railDetail} data-dock-detail="">{detail}</ChakraBox>}
                </ChakraBox>
                <Fragment key="panels">{panels}</Fragment>
            </ChakraBox>
        );
    }

    return (
        <ChakraBox css={styles.root} {...rootAttrs} {...sizeProps} {...transition}>
            <ChakraBox key="header" css={styles.header}>
                {tabs.length > 0 ? (
                    <ChakraBox css={styles.tabList} role="tablist" {...(label !== undefined ? { "aria-label": label } : {})}>
                        {tabs.map((tab, index) => {
                            const open = tab.key === openTab?.key;
                            return (
                                <chakra.button
                                    key={tab.key}
                                    ref={(el: HTMLButtonElement | null) => { tabRefs.current[index] = el; }}
                                    type="button"
                                    role="tab"
                                    id={`${ids}-tab-${index}`}
                                    aria-controls={`${ids}-panel-${index}`}
                                    aria-selected={open}
                                    tabIndex={open ? 0 : -1}
                                    css={styles.tab}
                                    {...(open ? { "data-selected": "" } : {})}
                                    onClick={() => setTabState({ key: tab.key })}
                                    onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => onTabKeyDown(event, index)}
                                >
                                    {tab.label}
                                </chakra.button>
                            );
                        })}
                    </ChakraBox>
                ) : label !== undefined ? (
                    <ChakraBox as="span" css={styles.tab} data-selected="">{label}</ChakraBox>
                ) : null}
                {toggle}
            </ChakraBox>
            <Fragment key="panels">{panels}</Fragment>
        </ChakraBox>
    );
}, (prev, next) => dockEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
