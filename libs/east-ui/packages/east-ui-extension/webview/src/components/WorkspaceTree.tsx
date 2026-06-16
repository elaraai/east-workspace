/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace nav — the sidebar, scoped to the workspace chosen in the app-bar
 * select. Mirrors the east-ui-showcase Sidebar: a bandless title row, then two
 * section eyebrows (INPUTS / TASKS) over prominent `navList` items. Each item is
 * the recipe's `item` slot directly — label + trailing status dot, with the
 * brand-tint inset active pill — not a quieter sub-item.
 *
 * @packageDocumentation
 */

import { useMemo } from 'react';
import { Box, Flex, Text, HStack, Spinner, chakra, useSlotRecipe, type SystemStyleObject } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faDatabase, faBolt } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useE3Context } from '../context/E3Context';
import { SidebarToggle } from './SidebarToggle';
import { useWorkspaceStatus, formatApiError } from '@elaraai/e3-ui-components';
import type { TaskStatusInfo, DatasetStatusInfo } from '@elaraai/e3-api-client';
import { StatusIndicator, type StatusTone } from './StatusIndicator';

function getTaskStatusTone(status: TaskStatusInfo['status']['type']): StatusTone {
    switch (status) {
        case 'up-to-date': return 'success';
        case 'ready': return 'info';
        case 'waiting': return 'warning';
        case 'in-progress': return 'info';
        case 'failed':
        case 'error': return 'danger';
        case 'stale-running': return 'warning';
        default: return 'neutral';
    }
}

function getInputStatusTone(status: DatasetStatusInfo['status']['type']): StatusTone {
    switch (status) {
        case 'up-to-date': return 'success';
        case 'stale': return 'warning';
        case 'unset': return 'neutral';
        default: return 'neutral';
    }
}

/** A bandless section eyebrow — muted 9.5px mono with a leading type icon, per
 *  the showcase Sidebar (no `eyebrowRow` band/rule). */
function SectionEyebrow({ icon, label }: { icon: IconDefinition; label: string }) {
    return (
        <Flex align="center" gap="8px" pt="16px" pb="10px" pl="14px" pr="10px">
            <Box as="span" w="16px" display="inline-flex" justifyContent="center" color="fg.muted">
                <FontAwesomeIcon icon={icon} style={{ fontSize: '11px' }} />
            </Box>
            <Box
                fontFamily="mono"
                fontSize="9.5px"
                fontWeight="semibold"
                letterSpacing="0.18em"
                textTransform="uppercase"
                color="fg.muted"
            >
                {label}
            </Box>
        </Flex>
    );
}

interface NavItemProps {
    label: string;
    tone: StatusTone;
    statusLabel: string;
    active: boolean;
    itemStyle: SystemStyleObject;
    onClick: () => void;
}

/** A prominent navList item — the recipe `item` slot directly (12px uppercase,
 *  brand-tint active pill); label takes the row, status dot trails. */
function NavItem({ label, tone, statusLabel, active, itemStyle, onClick }: NavItemProps) {
    return (
        <chakra.button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} css={itemStyle} title={label}>
            <Box as="span" flex="1" textAlign="left" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{label}</Box>
            <StatusIndicator tone={tone} label={statusLabel} hideLabel />
        </chakra.button>
    );
}

export function WorkspaceTree() {
    const { apiUrl, currentWorkspace, selection, setSelection, toggleSidebar } = useE3Context();
    const styles = useSlotRecipe({ key: 'navList' })({ surface: 'shell' });

    const { data: status, isLoading, error } = useWorkspaceStatus(apiUrl, 'default', currentWorkspace, undefined, {
        refetchInterval: 1000,
        staleTime: 0,
        gcTime: 0,
        structuralSharing: false,
    });

    const { inputs, tasks } = useMemo(() => {
        if (!status) return { inputs: [] as DatasetStatusInfo[], tasks: [] as TaskStatusInfo[] };
        return {
            inputs: status.datasets.filter(d => !d.isTaskOutput && d.path.startsWith('.inputs')),
            tasks: status.tasks,
        };
    }, [status]);

    return (
        <Box as="nav" css={styles.root}>
            {/* Workspace title row — bandless; the collapse chevron lives here. */}
            <Flex align="center" justify="space-between" gap="2" pt="4px" pb="10px" pl="14px" pr="10px">
                <Box
                    fontFamily="mono"
                    fontSize="11px"
                    fontWeight="bold"
                    letterSpacing="0.12em"
                    textTransform="uppercase"
                    color="fg"
                    minWidth={0}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    title={currentWorkspace ?? undefined}
                >
                    {currentWorkspace ?? 'No workspace'}
                </Box>
                <SidebarToggle aria-label="Collapse sidebar" onClick={toggleSidebar} icon={faChevronLeft} />
            </Flex>

            {!currentWorkspace ? (
                <Text px="14px" py="2" fontSize="xs" color="fg.muted">Select a workspace</Text>
            ) : error ? (
                <Box px="14px" py="2"><Text color="fg.danger" fontSize="xs">{formatApiError(error).message}</Text></Box>
            ) : (
                <>
                    <SectionEyebrow icon={faDatabase} label="Inputs" />
                    {inputs.map(input => (
                        <NavItem
                            key={`input:${input.path}`}
                            label={input.path.replace(/^\.inputs\./, '')}
                            tone={getInputStatusTone(input.status.type)}
                            statusLabel={input.status.type}
                            active={selection.type === 'input' && selection.path === input.path}
                            itemStyle={styles.item}
                            onClick={() => setSelection({ type: 'input', workspace: currentWorkspace, path: input.path })}
                        />
                    ))}
                    {!isLoading && inputs.length === 0 && (
                        <Text pl="14px" py="1" fontFamily="mono" fontSize="2xs" color="fg.subtle">No inputs</Text>
                    )}

                    <SectionEyebrow icon={faBolt} label="Tasks" />
                    {tasks.map(task => (
                        <NavItem
                            key={`task:${task.name}`}
                            label={task.name}
                            tone={getTaskStatusTone(task.status.type)}
                            statusLabel={task.status.type}
                            active={selection.type === 'task' && selection.task === task.name}
                            itemStyle={styles.item}
                            onClick={() => setSelection({ type: 'task', workspace: currentWorkspace, task: task.name })}
                        />
                    ))}
                    {!isLoading && tasks.length === 0 && (
                        <Text pl="14px" py="1" fontFamily="mono" fontSize="2xs" color="fg.subtle">No tasks</Text>
                    )}

                    {isLoading && !status && (
                        <HStack px="14px" py="2"><Spinner size="xs" /><Text fontSize="xs" color="fg.muted">Loading…</Text></HStack>
                    )}
                </>
            )}
        </Box>
    );
}
