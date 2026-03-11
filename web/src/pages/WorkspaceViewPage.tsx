/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Box, Text, Button, HStack, VStack, SimpleGrid, Badge, Table, HoverCard, Portal } from '@chakra-ui/react';
import { FiPlay, FiSquare } from 'react-icons/fi';
import type { DataflowEvent, DataflowExecutionState, TaskStatusInfo } from '@elaraai/e3-api-client';
import {
  useWorkspaceStatus,
  useDataflowExecution,
  useDataflowStart,
  useDataflowCancel,
} from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState, ErrorState } from '../components/DisplayStates';
import { toaster } from '../components/Toaster';
import { CopyablePath } from '../components/CopyablePath';
import { useNow, formatTimeAgo, formatDurationMs } from '../utils/time';

export function WorkspaceViewPage() {
  const { repo, workspace } = useParams<{ repo: string; workspace: string }>();
  const qc = useQueryClient();
  const { data: status, isLoading, isFetching, error: statusError } = useWorkspaceStatus(API_URL, repo!, workspace!, getRequestOptions(), { refetchInterval: 1000 });
  const { data: execution } = useDataflowExecution(API_URL, repo!, workspace!, undefined, getRequestOptions(), { refetchInterval: 1000 });
  const startMutation = useDataflowStart(API_URL, repo!, workspace!, getRequestOptions());
  const cancelMutation = useDataflowCancel(API_URL, repo!, workspace!, getRequestOptions());
  const now = useNow(10_000);

  const execStatus = useMemo(() => execution?.status.type, [execution]);
  const isRunning = useMemo(() => execStatus === 'running', [execStatus]);

  const handleStart = useCallback(() => {
    startMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['workspaceStatus', API_URL, repo!, workspace!] });
        qc.invalidateQueries({ queryKey: ['dataflowExecution', API_URL, repo!, workspace!] });
        toaster.create({ title: 'Dataflow started', type: 'success' });
      },
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  }, [startMutation, qc, repo, workspace]);

  const handleCancel = useCallback(() => {
    cancelMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['workspaceStatus', API_URL, repo!, workspace!] });
        toaster.create({ title: 'Dataflow cancelled', type: 'info' });
      },
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  }, [cancelMutation, qc, repo, workspace]);

  const statusContent = useMemo(() => {
    if (isLoading || (!status && isFetching)) {
      return <LoadingState message="Loading workspace status..." />;
    }
    if (statusError) {
      return <ErrorState title="Failed to load workspace status" error={statusError} />;
    }
    if (!status) {
      return <Text color="text.secondary">No status data available.</Text>;
    }
    return (
      <VStack gap={6} align="stretch">
        {/* Stat cards */}
        <SimpleGrid columns={{ base: 2, md: 3, lg: 6 }} gap={4}>
          <StatCard label="Tasks" value={Number(status.summary.tasks.total)} helpText="Total tasks in workspace" />
          <StatCard label="Up to Date" value={Number(status.summary.tasks.upToDate)} helpText="Tasks with current outputs" />
          <StatCard label="Failed" value={Number(status.summary.tasks.failed) + Number(status.summary.tasks.error)} helpText="Tasks that need attention" />
          <StatCard label="Datasets" value={Number(status.summary.datasets.total)} helpText="Total datasets in workspace" />
          <StatCard label="Up to Date" value={Number(status.summary.datasets.upToDate)} helpText="Datasets with current data" />
          <StatCard label="Stale" value={Number(status.summary.datasets.stale)} helpText="Datasets needing refresh" />
        </SimpleGrid>

        {/* Execution panel */}
        <ExecutionPanel execution={execution ?? null} now={now} />

        {/* Tasks table */}
        <Box>
          <Text fontSize="md" fontWeight={600} color="text.primary" mb={3}>
            Tasks
          </Text>
          {status.tasks.length > 0 ? (
            <Box border="1px solid" borderColor="border.primary" borderRadius="md" overflow="auto" maxH="400px">
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row bg="bg.tertiary">
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Name</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Status</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Dependencies</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Inputs</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Output</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {status.tasks.map((task) => (
                    <Table.Row key={task.name} _hover={{ bg: 'bg.hover' }}>
                      <Table.Cell>
                        <Text asChild fontSize="sm" fontWeight={500} color="link.color" _hover={{ textDecoration: 'underline', color: 'link.hover' }}>
                          <Link to={`/repos/${repo}/workspaces/${workspace}/tasks/${task.name}`}>{task.name}</Link>
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <TaskStatusCell status={task.status} />
                      </Table.Cell>
                      <Table.Cell>
                        <ItemListCell items={task.dependsOn} />
                      </Table.Cell>
                      <Table.Cell>
                        <ItemListCell items={task.inputs} />
                      </Table.Cell>
                      <Table.Cell>
                        <CopyablePath path={task.output} copyValue={`${workspace}${task.output}`} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          ) : (
            <Text fontSize="sm" color="text.tertiary">No tasks.</Text>
          )}
        </Box>

        {/* Datasets table */}
        <Box>
          <Text fontSize="md" fontWeight={600} color="text.primary" mb={3}>
            Datasets
          </Text>
          {status.datasets.length > 0 ? (
            <Box border="1px solid" borderColor="border.primary" borderRadius="md" overflow="auto" maxH="400px">
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row bg="bg.tertiary">
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Path</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Status</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Producer</Table.ColumnHeader>
                    <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Hash</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {status.datasets.map((ds) => (
                    <Table.Row key={ds.path} _hover={{ bg: 'bg.hover' }}>
                      <Table.Cell>
                        <Text asChild fontSize="sm" color="link.color" _hover={{ textDecoration: 'underline', color: 'link.hover' }}>
                          <Link to={`/repos/${repo}/workspaces/${workspace}/data/${ds.path.replace(/^\./, '').replace(/\./g, '/')}`}>
                            {ds.path}
                          </Link>
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <StatusBadge status={ds.status.type} />
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="text.secondary">{ds.producedBy.type === 'some' ? ds.producedBy.value : '—'}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="text.secondary" fontFamily="mono">
                          {ds.hash.type === 'some' ? ds.hash.value.slice(0, 12) : '—'}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          ) : (
            <Text fontSize="sm" color="text.tertiary">No datasets.</Text>
          )}
        </Box>
      </VStack>
    );
  }, [isLoading, isFetching, statusError, status, execution, now, repo, workspace]);

  return (
    <Box>
      {/* Header */}
      <HStack justify="space-between" mb={6}>
        <Text fontSize="lg" fontWeight={600} color="text.primary">
          {workspace}
        </Text>
        <HStack gap={2}>
          <Button
            size="sm"
            bg="brand.700"
            color="white"
            _hover={{ bg: 'brand.600' }}
            onClick={handleStart}
            disabled={startMutation.isPending || isRunning}
          >
            <FiPlay /> Start Dataflow
          </Button>
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              borderColor="border.primary"
              color="text.secondary"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              <FiSquare /> Cancel
            </Button>
          )}
        </HStack>
      </HStack>

      {statusContent}
    </Box>
  );
}

// --- Task Status Cell (badge with hover card for details) ---

function formatStatusDetail(status: TaskStatusInfo['status']): string | null {
  switch (status.type) {
    case 'failed':
      return `Exit code: ${Number(status.value.exitCode)}`;
    case 'error':
      return status.value.message;
    case 'waiting':
      return status.value.reason;
    case 'in-progress': {
      const parts: string[] = [];
      if (status.value.pid.type === 'some') parts.push(`PID: ${Number(status.value.pid.value)}`);
      if (status.value.startedAt.type === 'some') parts.push(`Started: ${status.value.startedAt.value}`);
      return parts.length > 0 ? parts.join('\n') : null;
    }
    case 'up-to-date':
      return status.value.cached ? 'Cached (inputs unchanged)' : null;
    default:
      return null;
  }
}

function TaskStatusCell({ status }: { status: TaskStatusInfo['status'] }) {
  const detail = formatStatusDetail(status);
  const hasDetail = detail != null;

  if (!hasDetail) {
    return <StatusBadge status={status.type} />;
  }

  return (
    <HoverCard.Root>
      <HoverCard.Trigger asChild>
        <Box display="inline-block" cursor="pointer">
          <StatusBadge status={status.type} />
        </Box>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content maxW="350px" p={3}>
            <HoverCard.Arrow />
            <VStack gap={1} align="start">
              <StatusBadge status={status.type} />
              <Text fontSize="xs" color="text.primary" whiteSpace="pre-wrap" wordBreak="break-word">
                {detail}
              </Text>
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

// --- Item List Cell (compact display with hover card for long lists) ---

const ITEM_LIST_THRESHOLD = 3;

function ItemListCell({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <Text fontSize="sm" color="text.secondary">—</Text>;
  }

  if (items.length <= ITEM_LIST_THRESHOLD) {
    return (
      <Text fontSize="sm" color="text.secondary">{items.join(', ')}</Text>
    );
  }

  return (
    <HoverCard.Root>
      <HoverCard.Trigger asChild>
        <Text as="span" fontSize="sm" color="link.color" cursor="pointer" _hover={{ textDecoration: 'underline' }}>
          {items.length} items
        </Text>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content maxW="300px" p={3}>
            <HoverCard.Arrow />
            <Box maxH="200px" overflowY="auto">
              <VStack gap={1} align="start">
                {items.map((item) => (
                  <Text key={item} fontSize="xs" color="text.primary" fontFamily="mono">{item}</Text>
                ))}
              </VStack>
            </Box>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

// --- Execution Panel ---

function ExecutionPanel({ execution, now }: { execution: DataflowExecutionState | null; now: number }) {
  const summary = useMemo(
    () => (execution?.summary.type === 'some' ? execution.summary.value : null),
    [execution]
  );
  const completedAt = useMemo(
    () => (execution?.completedAt.type === 'some' ? execution.completedAt.value : null),
    [execution]
  );
  const isRunning = execution?.status.type === 'running';
  const events = useMemo(
    () => (execution?.events ?? []).slice().reverse(),
    [execution]
  );

  return (
    <Box>
      <Text fontSize="md" fontWeight={600} color="text.primary" mb={3}>
        Last Execution
      </Text>
      {!execution ? (
        <Box border="1px solid" borderColor="border.primary" borderRadius="md" bg="card.bg" p={4}>
          <Text fontSize="sm" color="text.tertiary">No executions yet.</Text>
        </Box>
      ) : (
        <Box border="1px solid" borderColor="border.primary" borderRadius="md" bg="card.bg">
          {/* Summary */}
          <HStack p={4} gap={4} flexWrap="wrap">
            <StatusBadge status={execution.status.type} />
            <Text fontSize="xs" color="text.secondary">
              Started {formatTimeAgo(execution.startedAt, now)}
            </Text>
            {completedAt && (
              <Text fontSize="xs" color="text.secondary">
                Completed {formatTimeAgo(completedAt, now)}
              </Text>
            )}
            {summary && (
              <>
                <HStack gap={2}>
                  <Badge variant="subtle" colorPalette="green" size="sm">{Number(summary.executed)} executed</Badge>
                  <Badge variant="subtle" colorPalette="blue" size="sm">{Number(summary.cached)} cached</Badge>
                  <Badge variant="subtle" colorPalette="red" size="sm">{Number(summary.failed)} failed</Badge>
                  <Badge variant="subtle" colorPalette="gray" size="sm">{Number(summary.skipped)} skipped</Badge>
                </HStack>
                <Text fontSize="xs" color="text.secondary">
                  Duration: {formatDurationMs(summary.duration)}
                </Text>
              </>
            )}
          </HStack>

          {/* Live progress — only shown while running */}
          {isRunning && events.length > 0 && (
            <Box borderTop="1px solid" borderColor="border.primary">
              <Text fontSize="xs" fontWeight={600} color="text.secondary" px={3} pt={2} pb={1}>
                Progress
              </Text>
              <Box maxH="300px" overflowY="auto" px={2} pb={2}>
                <VStack gap={0} align="stretch">
                  {events.map((event, i) => (
                    <EventRow key={i} event={event} now={now} />
                  ))}
                </VStack>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// --- Event Row ---

const eventColors: Record<string, string> = {
  start: 'cyan',
  complete: 'green',
  cached: 'green',
  failed: 'red',
  error: 'red',
  input_unavailable: 'yellow',
};

function formatEventMessage(event: DataflowEvent): string {
  switch (event.type) {
    case 'start':
      return `${event.value.task} started`;
    case 'complete':
      return `${event.value.task} completed in ${formatDurationMs(event.value.duration)}`;
    case 'cached':
      return `${event.value.task} cached`;
    case 'failed':
      return `${event.value.task} failed (exit ${Number(event.value.exitCode)}) in ${formatDurationMs(event.value.duration)}`;
    case 'error':
      return `${event.value.task} error: ${event.value.message}`;
    case 'input_unavailable':
      return `${event.value.task} skipped: ${event.value.reason}`;
    default:
      return '';
  }
}

function EventRow({ event, now }: { event: DataflowEvent; now: number }) {
  const colorPalette = eventColors[event.type] ?? 'gray';

  return (
    <HStack gap={3} px={2} py={1} borderRadius="sm">
      <Text fontSize="xs" color="text.tertiary" flexShrink={0} fontFamily="mono" w="55px">
        {formatTimeAgo(event.value.timestamp, now)}
      </Text>
      <Badge variant="subtle" colorPalette={colorPalette} size="sm" flexShrink={0}>
        {event.type}
      </Badge>
      <Text fontSize="xs" color="text.primary" truncate>
        {formatEventMessage(event)}
      </Text>
    </HStack>
  );
}
