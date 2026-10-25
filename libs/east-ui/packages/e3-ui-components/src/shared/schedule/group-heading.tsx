/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** The shared disclosure and persisted fold state for scheduling builders. */
import { useCallback, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { usePersistedState } from "@elaraai/east-ui-components";

/**
 * A group's fold follows its surface through layouts, resizes and remounts. Its `toggle` is the same function while the
 * fold's store is, so a row that draws a band draws again only as its fold changes (#1398, CL9).
 */
export function useGroupCollapse(surface: string) {
    const { state: collapsed, setState: setCollapsed } = usePersistedState<string[]>(`${surface}.collapsed-groups`, []);
    const toggle = useCallback((group: string) => setCollapsed(current => current.includes(group) ? current.filter(key => key !== group) : [...current, group]), [setCollapsed]);
    return { collapsed, toggle };
}

/**
 * Native button semantics keep Enter/Space and focus identical in both builders. `measure` is handed the band's element
 * as it mounts: what a virtual list measures its bands' estimate from (#1398, CL8).
 */
export function GroupHeading({ scope, group, styles, collapsed, toggle, measure, children }: {
    scope: "calendar" | "roster" | "allocation"; group: { key: string; label: string }; styles: Record<string, Record<string, unknown>>;
    collapsed: boolean; toggle: (group: string) => void; measure?: ((el: HTMLElement | null) => void) | undefined; children?: ReactNode;
}) {
    return <chakra.button ref={measure} type="button" css={styles.group} data-schedule-group={group.key}
        data-roster-group={scope === "roster" ? group.key : undefined} data-calendar-group={scope === "calendar" ? group.key : undefined}
        data-allocation-band={scope === "allocation" ? group.key : undefined}
        aria-expanded={!collapsed} onClick={() => toggle(group.key)}>
        <Box as="span" css={styles.groupContent} data-schedule-group-content="">
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} /><Box as="span" css={styles.groupLabel} data-schedule-group-label="">{group.label}</Box>{children}
        </Box>
    </chakra.button>;
}
