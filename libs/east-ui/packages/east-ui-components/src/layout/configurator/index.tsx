/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Configurator renderer — a labelled control table beside a live preview and a
 * derived spec readout.
 *
 * The spec column is *derived*, not passed: every control row that carries a
 * `value` contributes a row, then the explicit `spec` entries are appended. A
 * control and its readout therefore cannot disagree, which is the whole reason
 * the value lives on the control row rather than in a parallel list.
 *
 * The control column is collapsible (the Dock chrome): a viewer inspecting a
 * wide preview can hand it the control column's width. Collapsed state is a
 * viewer preference — local, seeded expanded, persisted per instance under the
 * structural storage key when one is provided — never part of the East value.
 * The rows stay mounted (hidden) while collapsed so control state survives.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight, faChevronUp, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Configurator } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useContainerBelow } from "../../contracts/adaptive.js";

const configuratorEqual = equalFor(Configurator.Types.Configurator);

/** East Configurator value type */
export type ConfiguratorValue = ValueTypeOf<typeof Configurator.Types.Configurator>;

/** Below this container width the sidebar stacks under the control table. */
const STACK_BELOW_PX = 640;

interface EastChakraConfiguratorProps {
    value: ConfiguratorValue;
    storageKey?: string;
}

function EastChakraConfiguratorImpl({ value, storageKey }: EastChakraConfiguratorProps): React.JSX.Element {
    const recipe = useSlotRecipe({ key: "configurator" });
    const styles = recipe({});

    const rootRef = useRef<HTMLDivElement>(null);
    const stacked = useContainerBelow(rootRef, STACK_BELOW_PX);
    const stackedAttr = stacked ? { "data-stacked": "" } : {};

    const style = getSomeorUndefined(value.style);
    const aside = getSomeorUndefined(value.aside);

    // Viewer preference: the control column collapses to a rail so the preview
    // takes the width (the Dock pattern). Seeded expanded; persisted per
    // instance when a storage key is provided; hydrated once on mount.
    const persistKey = storageKey === undefined ? undefined : `${storageKey}.controlsCollapsed`;
    const [collapsed, setCollapsed] = useState<boolean>(false);
    useEffect(() => {
        if (persistKey === undefined) return;
        try {
            const raw = window.localStorage.getItem(persistKey);
            if (raw !== null) setCollapsed(raw === "true");
        } catch { /* storage unavailable (SSR / privacy mode) */ }
        // Mount-only hydrate.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setCollapsedState = useCallback((next: boolean) => {
        setCollapsed(next);
        if (persistKey !== undefined) {
            try {
                window.localStorage.setItem(persistKey, String(next));
            } catch { /* storage unavailable */ }
        }
    }, [persistKey]);

    const handleToggle = useCallback(() => { setCollapsedState(!collapsed); }, [collapsed, setCollapsedState]);

    // Derived: control rows that report a value, then the explicit extras.
    const specRows = useMemo(() => {
        const fromControls = value.controls
            .map(c => ({ label: c.label, value: getSomeorUndefined(c.value) }))
            .filter((r): r is { label: string; value: string } => r.value !== undefined);
        return [...fromControls, ...value.spec];
    }, [value.controls, value.spec]);

    const cssVars = {
        ...(getSomeorUndefined(style?.labelWidth) ? { "--cfg-label": getSomeorUndefined(style?.labelWidth) } : {}),
        ...(getSomeorUndefined(style?.sidebarWidth) ? { "--cfg-sidebar": getSomeorUndefined(style?.sidebarWidth) } : {}),
        ...(getSomeorUndefined(style?.previewMinHeight) ? { "--cfg-preview-min": getSomeorUndefined(style?.previewMinHeight) } : {}),
    } as React.CSSProperties;

    // Chevron points toward the controls when expanded (collapse inward) and
    // away when collapsed (expand outward); vertical when stacked.
    const chevron = stacked
        ? (collapsed ? faChevronDown : faChevronUp)
        : (collapsed ? faChevronRight : faChevronLeft);
    const ariaLabel = collapsed ? "Expand controls" : "Collapse controls";
    const toggle = (
        <IconButton
            css={styles.toggle}
            aria-label={ariaLabel}
            aria-expanded={!collapsed}
            onClick={handleToggle}
            variant="ghost"
            size="xs"
        >
            <FontAwesomeIcon icon={chevron} />
        </IconButton>
    );

    const controlRows = value.controls.map((control, i) => {
        const hint = getSomeorUndefined(control.hint);
        return (
            <Box key={`${control.label}-${i}`} css={styles.row} {...stackedAttr}>
                <Box css={styles.rowLabel}>{control.label}</Box>
                <Box css={styles.rowControl}>
                    <EastChakraComponent
                        value={control.control}
                        storageKey={storageKey === undefined ? undefined : `${storageKey}.control.${i}`}
                    />
                    {hint !== undefined && <Box css={styles.rowHint}>{hint}</Box>}
                </Box>
            </Box>
        );
    });

    return (
        <Box
            ref={rootRef}
            css={styles.root}
            style={cssVars}
            {...stackedAttr}
            {...(collapsed ? { "data-controls-collapsed": "" } : {})}
        >
            {/* The chrome and the rows wrapper hold their positions across the
                collapse so React keeps the row nodes mounted (state survives). */}
            <Box css={styles.controls}>
                {collapsed ? (
                    <Box css={styles.controlsRail} {...stackedAttr} onClick={handleToggle} title="Controls">
                        {toggle}
                        <Box css={styles.railLabel} {...stackedAttr}>Controls</Box>
                    </Box>
                ) : (
                    <Box css={styles.controlsHeader}>
                        <Box css={styles.sidebarTitle}>Controls</Box>
                        {toggle}
                    </Box>
                )}
                <Box display={collapsed ? "none" : undefined}>{controlRows}</Box>
            </Box>

            <Box css={styles.sidebar} {...stackedAttr}>
                <Box css={styles.sidebarHeader}>
                    <Box css={styles.sidebarTitle}>Preview</Box>
                    {value.live && (
                        <Box display="flex" alignItems="center" gap="2">
                            <Box css={styles.livePip} />
                            <Box css={styles.liveLabel}>Live</Box>
                        </Box>
                    )}
                </Box>

                <Box css={styles.preview}>
                    <EastChakraComponent
                        value={value.preview}
                        storageKey={storageKey === undefined ? undefined : `${storageKey}.preview`}
                    />
                </Box>

                {aside !== undefined && (
                    <Box css={styles.aside}>
                        <Box css={styles.asideTitle}>{aside.label}</Box>
                        <EastChakraComponent
                            value={aside.body}
                            storageKey={storageKey === undefined ? undefined : `${storageKey}.aside`}
                        />
                    </Box>
                )}

                {specRows.length > 0 && (
                    <Box css={styles.spec}>
                        <Box css={styles.sidebarTitle} marginBottom="1">Spec</Box>
                        {specRows.map((row, i) => (
                            <Box key={`${row.label}-${i}`} css={styles.specRow}>
                                <Box css={styles.specLabel}>{row.label}</Box>
                                <Box css={styles.specValue}>{row.value}</Box>
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

/**
 * Renders a Configurator value.
 *
 * @param props - The Configurator value and an optional storage key prefix
 * @returns The rendered control table, preview and spec readout
 */
export const EastChakraConfigurator = memo(
    EastChakraConfiguratorImpl,
    (prev, next) => configuratorEqual(prev.value, next.value) && prev.storageKey === next.storageKey,
);
