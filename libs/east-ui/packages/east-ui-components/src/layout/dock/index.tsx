/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Box as ChakraBox, chakra, Menu as ChakraMenu, Portal, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faAnglesUp, faAnglesDown, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Dock } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { usePersistedState } from "../../hooks/usePersistedState";
import { fitTabs, type TabRowMeasure } from "./fold.js";

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
 * never overlays, so a stacked drop-target is never covered). The pane is
 * {@link DockPane}'s; this renderer hands it the East value's bodies.
 */
export const EastChakraDock = memo(function EastChakraDock({ value, storageKey }: EastChakraDockProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const onCollapsedChange = useMemo(() => getSomeorUndefined(value.onCollapsedChange), [value.onCollapsedChange]);
    const tabs = useMemo(() => value.tabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        body: tab.body.map((child, i) => (
            <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.tab.${tab.key}.${i}`} />
        )),
    })), [value.tabs, storageKey]);
    const body = useMemo(() => value.body.map((child, i) => (
        <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.body.${i}`} />
    )), [value.body, storageKey]);
    return (
        <DockPane
            storageKey={storageKey}
            tabs={tabs}
            body={body}
            collapsed={getSomeorUndefined(value.collapsed)}
            defaultCollapsed={getSomeorUndefined(value.defaultCollapsed)}
            onCollapsedChange={onCollapsedChange}
            orientation={style ? getSomeorUndefined(style.orientation)?.type : undefined}
            side={style ? getSomeorUndefined(style.side)?.type : undefined}
            persist={style ? getSomeorUndefined(style.persist)?.type : undefined}
            surface={style ? getSomeorUndefined(style.surface)?.type : undefined}
            expandedSize={style ? getSomeorUndefined(style.expandedSize) : undefined}
            railSize={style ? getSomeorUndefined(style.railSize) : undefined}
            icon={style ? getSomeorUndefined(style.icon) : undefined}
            label={style ? getSomeorUndefined(style.label) : undefined}
            badge={style ? getSomeorUndefined(style.badge) : undefined}
            active={style ? getSomeorUndefined(style.active) : undefined}
            detail={style ? getSomeorUndefined(style.detail) : undefined}
            keepMounted={style ? getSomeorUndefined(style.keepMounted) : undefined}
            lazy={style ? getSomeorUndefined(style.lazy) : undefined}
            animated={style ? getSomeorUndefined(style.animated) : undefined}
        />
    );
}, (prev, next) => dockEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link DockPane}. */
export interface DockPaneProps {
    /** Where the pane keeps its open tab, and its collapsed state when persisted. */
    storageKey: string;
    /** The tabs, each with its body and, after its label, any count of what it holds; with none, `body` is the pane's one body under its label. */
    tabs?: ReadonlyArray<{ key: string; label: string; count?: string | undefined; body: ReactNode }> | undefined;
    /** The body, when the pane has no tabs. */
    body?: ReactNode;
    /** Whether it collapses at all: `false`, it never collapses — no rail, and no collapse control. `true` by default. */
    collapsible?: boolean | undefined;
    /** Collapsed, driven by the host; omitted, the pane keeps its own state. */
    collapsed?: boolean | undefined;
    /** Collapsed at first, when the pane keeps its own state. */
    defaultCollapsed?: boolean | undefined;
    /** Told each time the pane collapses or expands. */
    onCollapsedChange?: ((collapsed: boolean) => unknown) | undefined;
    /** The open tab's key, driven by the host; omitted, the pane keeps its own, persisted by its storage key. */
    tab?: string | undefined;
    /** Told each time a tab is opened from the pane — a click, an arrow key, Home or End — with its key. */
    onTabChange?: ((key: string) => unknown) | undefined;
    /** The axis it collapses along; `horizontal` by default. */
    orientation?: "horizontal" | "vertical" | undefined;
    /** The edge it pins to; `start` by default. */
    side?: "start" | "end" | undefined;
    /** Where its own collapsed state persists; `none` by default. */
    persist?: "none" | "local" | "session" | undefined;
    /** `card` (its own frame, the default) or `shell` (a host's frame). */
    surface?: "card" | "shell" | undefined;
    /** Its size along the axis, expanded — a CSS length. */
    expandedSize?: string | undefined;
    /** Its size along the axis, collapsed to its rail — a CSS length. */
    railSize?: string | undefined;
    /** A Font Awesome solid icon name, on the rail. */
    icon?: string | undefined;
    /** Its name: the only tab without tabs, the rail's label, the control's words. */
    label?: string | undefined;
    /** A badge on the rail. */
    badge?: string | undefined;
    /** Whether the rail's tile and badge are the brand's — what the pane shows is live. */
    active?: boolean | undefined;
    /** A line on the rail under its label. */
    detail?: string | undefined;
    /** Keep the body mounted while collapsed; `true` by default. */
    keepMounted?: boolean | undefined;
    /** Mount the body only once first expanded. */
    lazy?: boolean | undefined;
    /** Animate the size along the axis. */
    animated?: boolean | undefined;
}

/**
 * The Dock's pane as React — an inline pane that collapses along an axis to a
 * compact icon rail and stays in the document flow; the Dock's renderer, and
 * the pane a host renderer holds its own React in.
 *
 * Expanded, the pane's one row is its tab row — its tabs, each with any count
 * after its label, or its label as the only tab — with the collapse control at
 * the row's end. A row narrower than its tabs folds them (#1210), as the
 * Sheet's view tabs fold (#952): the counts leave the row first, kept in each
 * tab's name; then the trailing tabs fold into a `+n` menu after the last
 * that fits, the open tab always on the row, so no tab runs under the collapse
 * control. The row measures its tabs drawn whole, before it paints, again as
 * its room or its tabs change or fonts arrive ({@link fitTabs}); meanwhile the
 * `+n` menu keeps its fold, so a measure never closes it (#1235). Collapsed,
 * the rail holds the expand control, then the icon tile, the badge, the label
 * and the detail; while the pane is active the tile and the badge are the
 * brand's.
 *
 * Collapsed state follows the interactive-state pattern: local state seeded
 * from `collapsed` / `defaultCollapsed`, synced when `collapsed` drives it,
 * else toggled by the controls and optionally persisted (keyed by the storage
 * key). A pane that is not `collapsible` is always expanded, with no collapse
 * control. The open tab follows it too: seeded from `tab` and synced when `tab`
 * drives it, else kept by the storage key; either way a tab opened from the
 * pane is reported through `onTabChange`. Every body is kept mounted (hidden)
 * while the pane is collapsed, and every tab's while another is open, so a
 * child's scroll / drag / search state survives; `lazy` defers first mount.
 *
 * @param props - The pane's tabs or body, and its options ({@link DockPaneProps})
 * @returns The pane
 */
export function DockPane(props: DockPaneProps) {
    const { storageKey } = props;
    const collapsedProp = props.collapsed;
    const orientation = props.orientation ?? "horizontal";
    const side = props.side ?? "start";
    const persist = props.persist ?? "none";
    const surface = props.surface ?? "card";
    const expandedSize = props.expandedSize ?? "280px";
    const railSize = props.railSize ?? "44px";
    const { icon, label, badge, detail } = props;
    const active = props.active ?? false;
    const keepMounted = props.keepMounted ?? true;
    const lazy = props.lazy ?? false;
    const animated = props.animated ?? false;
    const collapsible = props.collapsible ?? true;
    const onCollapsedChangeFn = props.onCollapsedChange;

    const defaultCollapsed = props.defaultCollapsed ?? false;
    const horizontal = orientation === "horizontal";
    const persistKey = `${storageKey}.dock.collapsed`;

    // Interactive-state: local state seeded from collapsed ?? defaultCollapsed.
    const [collapsedState, setCollapsed] = useState<boolean>(collapsedProp ?? defaultCollapsed);
    // Controlled: a State-driven `collapsed` prop pushes into local state as
    // it changes — in the render it arrives in, so the pane is never drawn a
    // frame in its old state (a host frame placing it by that state, #1125).
    const [drivenCollapsed, setDrivenCollapsed] = useState<boolean | undefined>(collapsedProp);
    if (collapsedProp !== drivenCollapsed) {
        setDrivenCollapsed(collapsedProp);
        if (collapsedProp !== undefined) setCollapsed(collapsedProp);
    }
    // A pane that never collapses is expanded whatever its state says.
    const collapsed = collapsible && collapsedState;
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

    // The open tab: driven by the host's `tab`, else kept by the structural
    // storage key; the first when none is.
    const tabsProp = props.tabs;
    const tabs = useMemo(() => tabsProp ?? [], [tabsProp]);
    const tabProp = props.tab;
    const onTabChangeFn = props.onTabChange;
    const { state: tabState, setState: setTabState } = usePersistedState<{ key: string | undefined }>(
        `${storageKey}.dock.tab`,
        { key: tabs[0]?.key },
    );
    // Interactive-state: local state seeded from `tab`; a host-driven `tab` pushes into it.
    const [drivenTab, setDrivenTab] = useState<string | undefined>(tabProp);
    useEffect(() => { if (tabProp !== undefined) setDrivenTab(tabProp); }, [tabProp]);
    const openKey = tabProp !== undefined ? drivenTab : tabState.key;
    const openTab = tabs.find(tab => tab.key === openKey) ?? tabs[0];
    const openTabKey = useCallback((key: string) => {
        if (tabProp !== undefined) setDrivenTab(key);
        else setTabState({ key });
        if (onTabChangeFn) queueMicrotask(() => onTabChangeFn(key));
    }, [tabProp, setTabState, onTabChangeFn]);
    const ids = useId();
    const tabRefs = useRef(new Map<string, HTMLButtonElement>());

    // ── The tab row's fold (#1210) ──────────────────────────────────────
    // Measured with every tab drawn whole, and the menu's stand-in, in a
    // layout effect: the row folds before it paints.
    const foldable = !collapsed && tabs.length > 0;
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [measuring, setMeasuring] = useState(true);
    const [measure, setMeasure] = useState<TabRowMeasure | undefined>(undefined);
    const signature = tabs.map((tab) => `${tab.key}\u0000${tab.label}\u0000${tab.count ?? ""}`).join("\u0001");
    // Other tabs, or the row back from the rail, are measured again.
    useLayoutEffect(() => { if (foldable) setMeasuring(true); }, [signature, foldable]);
    // So is a change of the row's room, before the pane paints at it. The row
    // is as wide as its pane leaves it, whatever it holds, so folding never
    // changes what it observes.
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!foldable || row === null || typeof ResizeObserver === "undefined") return undefined;
        let room = row.clientWidth;
        const ro = new ResizeObserver(() => {
            if (Math.abs(row.clientWidth - room) <= 0.5) return;
            room = row.clientWidth;
            flushSync(() => setMeasuring(true));
        });
        ro.observe(row);
        return () => ro.disconnect();
    }, [foldable]);
    // Fonts arriving change the tabs' widths, not the row's room.
    useEffect(() => {
        const fonts = typeof document === "undefined" ? undefined : document.fonts;
        if (!foldable || fonts === undefined) return undefined;
        const again = () => setMeasuring(true);
        fonts.addEventListener("loadingdone", again);
        return () => fonts.removeEventListener("loadingdone", again);
    }, [foldable]);
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!foldable || !measuring || row === null) return;
        const width = (el: Element | null) => (el === null ? 0 : el.getBoundingClientRect().width);
        const gapOf = (el: Element | null) => (el === null ? 0 : Number.parseFloat(getComputedStyle(el).columnGap) || 0);
        const drawn = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
        setMeasure({
            room: row.clientWidth,
            tabs: drawn.map(width),
            counts: drawn.map((tab) => {
                const count = tab.querySelector("[data-tab-count]");
                return count === null ? 0 : width(count) + gapOf(tab);
            }),
            gap: gapOf(row.querySelector('[role="tablist"]')),
            more: width(row.querySelector("[data-dock-more-measure]")) + gapOf(row),
        });
        setMeasuring(false);
    }, [measuring, foldable, signature]);
    const openIndex = Math.max(0, tabs.findIndex(tab => tab.key === openTab?.key));
    // The fold the last measure gave; the row draws every tab while it measures again.
    const measured = !foldable || measure === undefined || measure.tabs.length !== tabs.length
        ? undefined
        : fitTabs(measure, openIndex);
    const fit = measuring ? undefined : measured;
    // The tabs on the row, in order, and the ones in the `+n` menu. The menu
    // keeps the last measure's fold while the row measures again, so it stays
    // mounted: a font arriving, or the room or a count changing, never closes
    // it (#1235).
    const onRow = fit === undefined ? tabs.map((tab, index) => ({ tab, index })) : fit.shown.map(index => ({ tab: tabs[index]!, index }));
    const inMenu = measured?.form === "folded" ? tabs.filter((_, index) => !measured.shown.includes(index)) : [];

    // The arrow keys, Home and End move among the tabs on the row; the menu holds the rest.
    const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
        const keys = onRow.map(({ tab }) => tab.key);
        const at = keys.indexOf(key);
        const last = keys.length - 1;
        const next = event.key === "ArrowRight" ? (at === last ? 0 : at + 1)
            : event.key === "ArrowLeft" ? (at === 0 ? last : at - 1)
                : event.key === "Home" ? 0
                    : event.key === "End" ? last
                        : undefined;
        if (next === undefined) return;
        event.preventDefault();
        openTabKey(keys[next]!);
        tabRefs.current.get(keys[next]!)?.focus();
    };

    const styles = useSlotRecipe({ key: "dock" })();
    const menuStyles = useSlotRecipe({ key: "menu" })();

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
    // `lazy` defers until first expand — a pane that never collapses is
    // expanded from the first. With tabs, each tab is a panel and only the
    // open one shows. The rail and the tab row sit before the panels, so
    // every child is keyed: a toggle keeps the panels mounted.
    const bodyMounted = (!collapsed || keepMounted) && (everExpanded || !lazy || !collapsible);
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
                {tab.body}
            </ChakraBox>
        ))
        : (
            <ChakraBox css={styles.body} hidden={collapsed}>
                {props.body}
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
                    <ChakraBox ref={rowRef} css={styles.tabs} data-dock-tabs="">
                        <ChakraBox css={styles.tabList} role="tablist" {...(label !== undefined ? { "aria-label": label } : {})}
                            data-fold={fit === undefined || fit.form === "full" ? undefined : fit.form}>
                            {onRow.map(({ tab, index }) => {
                                const open = tab.key === openTab?.key;
                                const squeezed = open && fit?.squeezed === true;
                                return (
                                    <chakra.button
                                        key={tab.key}
                                        ref={(el: HTMLButtonElement | null) => { if (el === null) tabRefs.current.delete(tab.key); else tabRefs.current.set(tab.key, el); }}
                                        type="button"
                                        role="tab"
                                        id={`${ids}-tab-${index}`}
                                        aria-controls={`${ids}-panel-${index}`}
                                        aria-selected={open}
                                        tabIndex={open ? 0 : -1}
                                        css={styles.tab}
                                        {...(open ? { "data-selected": "" } : {})}
                                        {...(squeezed ? { "data-squeezed": "", title: tab.label } : {})}
                                        onClick={() => openTabKey(tab.key)}
                                        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => onTabKeyDown(event, tab.key)}
                                    >
                                        <ChakraBox as="span" css={styles.tabLabel}>{tab.label}</ChakraBox>
                                        {/* The space keeps the label and the count apart in the tab's name; the row's gap spaces them on screen. */}
                                        {tab.count !== undefined && <>{" "}<ChakraBox as="span" css={styles.tabCount} data-tab-count="">{tab.count}</ChakraBox></>}
                                    </chakra.button>
                                );
                            })}
                        </ChakraBox>
                        {measuring && (
                            // The menu's stand-in, measured beside the tabs drawn whole: beside
                            // the menu, never in its place, so an open menu stays open (#1235).
                            <ChakraBox as="span" css={styles.tabMore} data-dock-more-measure="" aria-hidden>
                                +{Math.max(1, tabs.length - 1)}
                                <FontAwesomeIcon icon={faChevronDown} />
                            </ChakraBox>
                        )}
                        {inMenu.length > 0 && (
                            <ChakraMenu.Root positioning={{ placement: "bottom-end" }} onSelect={(detail) => openTabKey(detail.value)}>
                                <ChakraMenu.Trigger asChild>
                                    <chakra.button type="button" css={styles.tabMore} data-dock-more=""
                                        aria-label={`${inMenu.length} more ${inMenu.length === 1 ? "tab" : "tabs"}`} title="More tabs">
                                        +{inMenu.length}
                                        <FontAwesomeIcon icon={faChevronDown} />
                                    </chakra.button>
                                </ChakraMenu.Trigger>
                                <Portal>
                                    <ChakraMenu.Positioner>
                                        <ChakraMenu.Content>
                                            {inMenu.map(tab => (
                                                <ChakraMenu.Item key={tab.key} value={tab.key}>
                                                    {tab.label}
                                                    {/* As on a tab: the space keeps the label and the count apart in the item's name. */}
                                                    {tab.count !== undefined && <>{" "}<ChakraBox as="span" css={menuStyles.itemCommand}>{tab.count}</ChakraBox></>}
                                                </ChakraMenu.Item>
                                            ))}
                                        </ChakraMenu.Content>
                                    </ChakraMenu.Positioner>
                                </Portal>
                            </ChakraMenu.Root>
                        )}
                    </ChakraBox>
                ) : label !== undefined ? (
                    <ChakraBox as="span" css={styles.tab} data-selected="">{label}</ChakraBox>
                ) : null}
                {collapsible && toggle}
            </ChakraBox>
            <Fragment key="panels">{panels}</Fragment>
        </ChakraBox>
    );
}
