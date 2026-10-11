/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** The shared disclosure and persisted fold state for scheduling builders. */
import type { ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { usePersistedState } from "@elaraai/east-ui-components";

/** A group's fold follows its surface through layouts, resizes and remounts. */
export function useGroupCollapse(surface: string) {
    const { state: collapsed, setState: setCollapsed } = usePersistedState<string[]>(`${surface}.collapsed-groups`, []);
    const toggle = (group: string) => setCollapsed(current => current.includes(group) ? current.filter(key => key !== group) : [...current, group]);
    return { collapsed, toggle };
}

/** Native button semantics keep Enter/Space and focus identical in both builders. */
export function GroupHeading({ scope, group, styles, collapsed, toggle, children }: {
    scope: "calendar" | "roster"; group: { key: string; label: string }; styles: Record<string, Record<string, unknown>>;
    collapsed: boolean; toggle: (group: string) => void; children?: ReactNode;
}) {
    return <chakra.button type="button" css={styles.group} data-schedule-group={group.key}
        data-roster-group={scope === "roster" ? group.key : undefined} data-calendar-group={scope === "calendar" ? group.key : undefined}
        aria-expanded={!collapsed} onClick={() => toggle(group.key)}>
        <Box as="span" css={styles.groupContent} data-schedule-group-content="">
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} /><Box as="span" css={styles.groupLabel} data-schedule-group-label="">{group.label}</Box>{children}
        </Box>
    </chakra.button>;
}
