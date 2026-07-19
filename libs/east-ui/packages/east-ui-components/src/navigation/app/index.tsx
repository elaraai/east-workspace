/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraApp` — renderer for the `<App>` application shell (#367).
 *
 * Dumb layout + chrome: it lays out the pre-built rail / breadcrumb / body nodes
 * (rendered through the recursive dispatcher) into the bsys shell (the `app` slot
 * recipe), owns the collapse state (`[` hotkey, persisted per nav key), renders
 * the logo `ImageSource`, and merges host-injected slots from `AppProvider` with
 * the IR `barStart` / `barEnd` nodes (host content trails author content).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, type ReactNode } from "react";
import { Box, Flex, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { equalFor, none, type ValueTypeOf } from "@elaraai/east";
import { AppValueType } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { EastChakraImage } from "../../display/image";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useAppSlots } from "../app-provider";

/** Decoded `App` value — derived from the `AppValueType` mirror in east-ui. */
export type AppValue = ValueTypeOf<typeof AppValueType>;

export interface EastChakraAppProps {
    value: AppValue;
    storageKey: string;
}

const appEqual = equalFor(AppValueType);

/**
 * Renders an East UI `App` shell — collapsible rail + breadcrumb app bar + routed
 * body, with host-injected app-bar / rail slots.
 */
export const EastChakraApp = memo(function EastChakraApp({ value, storageKey }: EastChakraAppProps) {
    const recipe = useSlotRecipe({ key: "app" });
    const slots = useAppSlots();

    // Collapse state persists per nav key; only meaningful when collapsible.
    const { state: persistedCollapsed, setState: setCollapsed } = usePersistedState<boolean>(`${storageKey}.app.collapsed`, false);
    const collapsed = value.collapsible && persistedCollapsed;
    const toggle = useCallback(() => setCollapsed(prev => !prev), [setCollapsed]);

    // `[` toggles collapse globally (bsys Sidebar recipe) — ignored while typing.
    useEffect(() => {
        if (!value.collapsible) return;
        function onKey(e: KeyboardEvent) {
            if (e.key !== "[") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            setCollapsed(prev => !prev);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [value.collapsible, setCollapsed]);

    const styles = recipe({ collapsed });

    const title = getSomeorUndefined(value.title);
    const logoSource = collapsed
        ? (getSomeorUndefined(value.logoCollapsed) ?? getSomeorUndefined(value.logo))
        : getSomeorUndefined(value.logo);
    const logoNode: ReactNode = slots.logo ?? (logoSource !== undefined
        ? <Box css={styles.logo}><EastChakraImage value={{ source: logoSource, style: none } as never} /></Box>
        : null);

    const hasLeading = value.barStart.length > 0 || slots.barStart != null;

    return (
        <Box css={styles.root}>
            {/* Rail — logo region, nav list (hidden when collapsed), collapse toggle, host footer. */}
            <Box as="aside" css={styles.rail}>
                <Box css={styles.railHeader}>{logoNode}</Box>
                {!collapsed && (
                    <Box css={styles.railBody}>
                        <EastChakraComponent value={value.rail} storageKey={`${storageKey}.rail`} />
                    </Box>
                )}
                {value.collapsible && (
                    <Box css={styles.collapseToggleRow}>
                        <chakra.button
                            type="button"
                            css={styles.collapseToggle}
                            onClick={toggle}
                            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        >
                            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
                        </chakra.button>
                    </Box>
                )}
                {slots.railFooter != null && <Box css={styles.railFooter}>{slots.railFooter}</Box>}
            </Box>

            {/* Content — optional top banner, sticky header (breadcrumb + bars), scrolling main. */}
            <Box css={styles.content}>
                {slots.bannerTop != null && <Box css={styles.bannerTop}>{slots.bannerTop}</Box>}
                <Box as="header" css={styles.header}>
                    <Flex css={styles.headerRow}>
                        <Box css={styles.breadcrumb}>
                            <EastChakraComponent value={value.breadcrumb} storageKey={`${storageKey}.breadcrumb`} />
                        </Box>
                        {hasLeading && (
                            <Box css={styles.barStart}>
                                {value.barStart.map((c, i) => (
                                    <EastChakraComponent key={i} value={c} storageKey={`${storageKey}.barStart.${i}`} />
                                ))}
                                {slots.barStart}
                            </Box>
                        )}
                        <Box css={styles.barCenter}>{slots.barCenter}</Box>
                        <Box css={styles.barEnd}>
                            {value.barEnd.map((c, i) => (
                                <EastChakraComponent key={i} value={c} storageKey={`${storageKey}.barEnd.${i}`} />
                            ))}
                            {slots.barEnd}
                        </Box>
                    </Flex>
                    {title !== undefined && <Box css={styles.title}>{title}</Box>}
                </Box>
                <Box as="main" css={styles.main}>
                    <EastChakraComponent value={value.body} storageKey={`${storageKey}.body`} />
                </Box>
            </Box>
        </Box>
    );
    // Structural equality over the whole value: the rail's active row + the
    // breadcrumb change on navigation → not equal → re-render. The body (a Pages
    // node whose render fn compares equal) self-remounts via its own store
    // subscription regardless.
}, (prev, next) => prev.storageKey === next.storageKey && appEqual(prev.value, next.value));
