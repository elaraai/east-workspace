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
import { faChevronLeft, faDatabase, faBolt, faSpinner, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useE3Context } from '../context/E3Context';
import { SidebarToggle } from './SidebarToggle';
import { useWorkspaceStatus, formatApiError } from '@elaraai/e3-ui-components';
import type { TaskStatusInfo, DatasetStatusInfo } from '@elaraai/e3-api-client';
import { StatusIndicator, type StatusTone } from './StatusIndicator';

/**
 * Tone per task status.
 *
 * `info` is reserved for the one task state that is actually doing something,
 * so a blue dot always means "running now". `ready` is idle — it may never run
 * — and reads as neutral. `stale-running` is a dead process, a failure rather
 * than the healthy blocked-on-upstream that `waiting` describes.
 */
function getTaskStatusTone(status: TaskStatusInfo['status']['type']): StatusTone {
    switch (status) {
        case 'up-to-date': return 'success';
        case 'in-progress': return 'info';
        case 'ready': return 'neutral';
        case 'waiting': return 'warning';
        case 'failed':
        case 'error':
        case 'stale-running': return 'danger';
        default: return 'neutral';
    }
}

/**
 * Glyph for the two states worth interrupting a scan for, or undefined to keep
 * the dot.
 *
 * A dot can only vary in hue, and hue is the first channel lost to a glance or
 * to colour-blindness — a fading 6px circle is not enough to say "this one is
 * running" or "this one is broken". Shape carries those two; everything else
 * stays a dot, because a list where every row shouts says nothing.
 */
function getTaskStatusIcon(status: TaskStatusInfo['status']['type']): IconDefinition | undefined {
    switch (status) {
        case 'in-progress': return faSpinner;
        case 'failed':
        case 'error':
        case 'stale-running': return faTriangleExclamation;
        default: return undefined;
    }
}

/** The spinner turns only while the task is actually executing. */
function isTaskRunning(status: TaskStatusInfo['status']['type']): boolean {
    return status === 'in-progress';
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
    /** Glyph in place of the dot, for running / broken rows. */
    icon?: IconDefinition | undefined;
    /** Spin the glyph — the row is doing work right now. */
    running?: boolean;
    active: boolean;
    itemStyle: SystemStyleObject;
    onClick: () => void;
}

/** A prominent navList item — the recipe `item` slot directly (12px uppercase,
 *  brand-tint active pill); label takes the row, status dot trails.
 *
 *  A dot alone is enough for the states you scan past, but not for the one you
 *  came to find: failures spell themselves out (the status pattern's own
 *  dot-plus-word form), so a broken task is readable rather than a red speck. */
function NavItem({ label, tone, statusLabel, icon, running = false, active, itemStyle, onClick }: NavItemProps) {
    const failed = tone === 'danger';
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            css={itemStyle}
            title={`${label} — ${statusLabel}`}
        >
            <Box as="span" flex="1" textAlign="left" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{label}</Box>
            <StatusIndicator
                tone={tone}
                label={statusLabel}
                size={failed ? 'md' : 'sm'}
                hideLabel={!failed}
                {...(icon !== undefined && { icon })}
                spinning={running}
            />
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
                            icon={getTaskStatusIcon(task.status.type)}
                            running={isTaskRunning(task.status.type)}
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
