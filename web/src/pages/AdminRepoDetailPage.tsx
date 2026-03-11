/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Box, SimpleGrid, Text, Table, Tabs, HStack, Badge, Button, Checkbox,
  Input, VStack, Popover, Portal, Combobox, createListCollection, Field, Wrap,
} from '@chakra-ui/react';
import { FiBox, FiUsers, FiPlus, FiTrash2, FiPlay, FiExternalLink, FiEdit2, FiX } from 'react-icons/fi';
import { ConfirmPopover } from '../components/ConfirmPopover';
import cronstrue from 'cronstrue';
import { variant } from '@elaraai/east';
import { StatCard } from '../components/StatCard';
import { LoadingState, ErrorState } from '../components/DisplayStates';
import { StatusBadge } from '../components/StatusBadge';
import {
  useAdminRepoUsers,
  useRepoSchedules,
  useAddRepoUser,
  useRemoveRepoUser,
  useToggleSchedule,
  useRemoveSchedule,
  useSetSchedule,
  useWorkspaceExecution,
  useRepoTaskConfigs,
  useSetCompute,
  useRemoveCompute,
  useSetTaskTimeout,
  useRemoveTimeout,
} from '../hooks/useAdminApi';
import type { WorkspaceInfo } from '@elaraai/e3-api-client';
import type { Schedule, ScheduleRequest, RepoRole, ComputeSize, TaskTimeout } from '@elaraai/e3-cloud-client';
import { DEFAULT_TIMEOUT_SERVERLESS, DEFAULT_TIMEOUT_FARGATE } from '@elaraai/e3-cloud-types';
import { useWorkspaceList, usePackageList, useDataflowStart, useWorkspaceRemove, useTaskList } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '../contexts/UserContext';
import { toaster } from '../components/Toaster';
import { InfoTip } from '../components/InfoTip';
import { useNow, formatTimeAgo } from '../utils/time';

export function AdminRepoDetailPage() {
  const { repo } = useParams<{ repo: string }>();
  const user = useUser();

  if (!user.isAdmin) {
    return <ErrorState title="Access Denied" description="You must be an admin to view this page." />;
  }

  if (!repo) {
    return <ErrorState title="Repository not found" />;
  }

  return (
    <Box display="flex" flexDirection="column" h="full" mx={-6} mt={-3} mb={-6}>
      <Tabs.Root defaultValue="infrastructure" variant="line" flex={1} display="flex" flexDirection="column">
        <Tabs.List borderBottomColor="border.primary" flexShrink={0} px={6}>
          <Tabs.Trigger value="infrastructure" fontSize="sm" fontWeight={500} color="text.secondary" _selected={{ color: 'text.primary', fontWeight: 600 }}>
            <FiBox size={14} />
            <Text ml={2}>Infrastructure</Text>
          </Tabs.Trigger>
          <Tabs.Trigger value="users" fontSize="sm" fontWeight={500} color="text.secondary" _selected={{ color: 'text.primary', fontWeight: 600 }}>
            <FiUsers size={14} />
            <Text ml={2}>Users</Text>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="infrastructure" p={6} flex={1} display="flex" flexDirection="column" minH={0}>
          <InfrastructureTab repo={repo} />
        </Tabs.Content>
        <Tabs.Content value="users" p={6} flex={1} display="flex" flexDirection="column" minH={0}>
          <UsersTab repo={repo} />
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}

// --- Add User Popover ---

function AddUserPopover({ repo }: { repo: string }) {
  const addMutation = useAddRepoUser(repo);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');

  const handleAdd = async () => {
    if (!email.trim()) return;
    const repoRole: RepoRole = variant(role, null) as RepoRole;
    try {
      await addMutation.mutateAsync({ email: email.trim(), role: repoRole });
      setEmail('');
      setRole('member');
      setOpen(false);
    } catch {
      // error shown in popover
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="outline" borderColor="border.primary" color="text.primary" _hover={{ bg: 'bg.hover' }}>
          <FiPlus size={14} />
          <Text ml={1}>Add User</Text>
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Body display="flex" flexDirection="column" gap={3}>
                <Field.Root>
                  <Field.Label fontSize="xs" fontWeight={600}>
                    Email
                    <InfoTip content="Must be the email of an existing platform user." />
                  </Field.Label>
                  <Input size="sm" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field.Root>
                <Field.Root>
                  <Field.Label fontSize="xs" fontWeight={600}>Role</Field.Label>
                  <HStack gap={2}>
                    <Button size="xs" variant={role === 'member' ? 'solid' : 'outline'} colorPalette={role === 'member' ? 'teal' : 'gray'} onClick={() => setRole('member')}>Member</Button>
                    <Button size="xs" variant={role === 'owner' ? 'solid' : 'outline'} colorPalette={role === 'owner' ? 'teal' : 'gray'} onClick={() => setRole('owner')}>Owner</Button>
                  </HStack>
                </Field.Root>
                {addMutation.error && (
                  <Text fontSize="xs" color="red.500">{addMutation.error instanceof Error ? addMutation.error.message : 'Failed to add user'}</Text>
                )}
                <HStack gap={2} justify="flex-end">
                  <Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="xs" colorPalette="teal" onClick={handleAdd} disabled={!email.trim() || addMutation.isPending}>
                    {addMutation.isPending ? 'Adding...' : 'Add'}
                  </Button>
                </HStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

// --- Schedule Edit/Create Popover ---

function ScheduleFormPopover({
  repo,
  trigger,
  schedule,
  workspaces,
}: {
  repo: string;
  trigger: React.ReactNode;
  schedule?: Schedule;
  workspaces?: string[];
}) {
  const setScheduleMutation = useSetSchedule(repo);
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState(schedule?.workspace ?? '');
  const [cron, setCron] = useState(schedule?.cronExpression ?? '0 0 * * *');
  const [timezone, setTimezone] = useState(schedule?.timezone ?? 'UTC');
  const [forcePatterns, setForcePatterns] = useState(schedule?.forceTasks.join(', ') ?? '');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [description, setDescription] = useState(
    schedule?.description.type === 'some' ? schedule.description.value : ''
  );

  const isEdit = !!schedule;
  const formDisabled = !isEdit && !workspace.trim();

  const resetForm = () => {
    setWorkspace(schedule?.workspace ?? '');
    setCron(schedule?.cronExpression ?? '0 0 * * *');
    setTimezone(schedule?.timezone ?? 'UTC');
    setForcePatterns(schedule?.forceTasks.join(', ') ?? '');
    setEnabled(schedule?.enabled ?? true);
    setDescription(schedule?.description.type === 'some' ? schedule.description.value : '');
  };

  const handleSubmit = async () => {
    const ws = isEdit ? schedule.workspace : workspace.trim();
    if (!ws) return;

    const patterns = forcePatterns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const request: ScheduleRequest = {
      cronExpression: cron,
      timezone: variant('some', timezone) as ScheduleRequest['timezone'],
      forceTasks: patterns,
      enabled,
      description: description.trim()
        ? (variant('some', description.trim()) as ScheduleRequest['description'])
        : (variant('none', null) as ScheduleRequest['description']),
    };

    try {
      await setScheduleMutation.mutateAsync({ workspace: ws, request });
      setOpen(false);
      if (!isEdit) resetForm();
      toaster.create({ title: `Schedule ${isEdit ? 'updated' : 'created'} for ${ws}`, type: 'success' });
    } catch (err) {
      toaster.create({ title: `Error: ${err instanceof Error ? err.message : 'Failed'}`, type: 'error' });
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) resetForm();
      }}
    >
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Body display="flex" flexDirection="column" gap={2} overflow="auto">
                {!isEdit && (
                  <Field.Root>
                    <Field.Label fontSize="xs" fontWeight={600}>Workspace</Field.Label>
                    {workspaces && workspaces.length > 0 ? (
                      <WorkspaceCombobox workspaces={workspaces} value={workspace} onChange={setWorkspace} />
                    ) : (
                      <Input size="sm" placeholder="workspace-name" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
                    )}
                  </Field.Root>
                )}
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>
                    Cron Expression
                    <InfoTip content={"Standard 5-field cron: minute hour day month weekday\n\nExamples:\n0 0 * * *  = daily at midnight\n0 */6 * * *  = every 6 hours\n30 9 * * 1-5  = weekdays at 9:30am\n0 0 1 * *  = first of each month"} />
                  </Field.Label>
                  <Input size="sm" placeholder="0 0 * * *" value={cron} onChange={(e) => setCron(e.target.value)} fontFamily="mono" />
                  <CronHint expression={cron} />
                </Field.Root>
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>Timezone</Field.Label>
                  <TimezoneCombobox value={timezone} onChange={setTimezone} />
                </Field.Root>
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>
                    Force Task Patterns
                    <InfoTip content={"Glob patterns to force cache bypass. Uses * as wildcard.\n\nExamples:\n*  = all tasks\ninput*  = tasks starting with \"input\"\n*_load  = tasks ending with \"_load\"\n\nSelect tasks or type custom patterns."} />
                  </Field.Label>
                  <TaskPatternInput
                    repo={repo}
                    workspace={isEdit ? schedule.workspace : workspace}
                    value={forcePatterns}
                    onChange={setForcePatterns}
                    disabled={formDisabled}
                  />
                  <GlobHint patterns={forcePatterns} />
                </Field.Root>
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>Description</Field.Label>
                  <Input size="sm" placeholder="Optional description" value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field.Root>
                <HStack gap={2}>
                  <Button size="xs" variant={enabled ? 'solid' : 'outline'} colorPalette={enabled ? 'green' : 'gray'} onClick={() => setEnabled(true)} disabled={formDisabled}>Enabled</Button>
                  <Button size="xs" variant={!enabled ? 'solid' : 'outline'} colorPalette={!enabled ? 'gray' : 'gray'} onClick={() => setEnabled(false)} disabled={formDisabled}>Paused</Button>
                </HStack>
                <HStack gap={2} justify="flex-end">
                  <Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="xs" colorPalette="teal" onClick={handleSubmit} disabled={formDisabled || !cron.trim() || setScheduleMutation.isPending}>
                    {setScheduleMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
                  </Button>
                </HStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

// --- Users Tab ---

function UsersTab({ repo }: { repo: string }) {
  const { data: users, isLoading, error } = useAdminRepoUsers(repo);
  const removeMutation = useRemoveRepoUser(repo);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (isLoading) return <LoadingState message="Loading users..." />;
  if (error) return <ErrorState title="Failed to load users" error={error} />;

  const userList = users ?? [];

  const toggleSelect = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === userList.length) return new Set();
      return new Set(userList.map((u) => u.userId));
    });
  };

  const selectedUserId = selected.size === 1 ? Array.from(selected)[0] : null;
  const selectedUserEmail = selectedUserId ? userList.find((u) => u.userId === selectedUserId)?.email ?? selectedUserId : null;

  const handleRemoveSelected = () => {
    if (!selectedUserId) return;
    removeMutation.mutate(selectedUserId, {
      onSuccess: () => setSelected(new Set()),
    });
  };

  return (
    <Box display="flex" flexDirection="column" flex={1} minH={0}>
      <HStack justify="space-between" mb={3} flexShrink={0}>
        <Text fontSize="sm" color="text.secondary">
          {userList.length} users
        </Text>
        <HStack gap={2}>
          <ConfirmPopover
            message={`Remove user "${selectedUserEmail}"?`}
            confirmLabel="Remove"
            loading={removeMutation.isPending}
            onConfirm={handleRemoveSelected}
            trigger={
              <Button
                size="sm"
                variant="outline"
                borderColor="border.primary"
                color="text.tertiary"
                _hover={{ color: 'red.500', borderColor: 'red.500' }}
                disabled={selected.size !== 1}
              >
                <FiTrash2 size={14} />
                <Text ml={1}>Remove</Text>
              </Button>
            }
          />
          <AddUserPopover repo={repo} />
        </HStack>
      </HStack>

      <Box flex={1} minH={0} border="1px solid" borderColor="border.primary" borderRadius="md" overflow="auto">
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row bg="bg.tertiary">
              <Table.ColumnHeader w="40px" position="sticky" top={0} bg="bg.tertiary" zIndex={1}>
                <Checkbox.Root
                  size="sm"
                  checked={userList.length > 0 && selected.size === userList.length}
                  onCheckedChange={toggleAll}
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Email</Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Name</Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Role</Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Added By</Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Added At</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {userList.map((u) => (
              <Table.Row key={u.userId} _hover={{ bg: 'bg.hover' }}>
                <Table.Cell>
                  <Checkbox.Root
                    size="sm"
                    checked={selected.has(u.userId)}
                    onCheckedChange={() => toggleSelect(u.userId)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="text.primary">{u.email}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="text.secondary">{u.name.type === 'some' ? u.name.value : '—'}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant="subtle" colorPalette={u.role.type === 'owner' ? 'purple' : 'blue'} size="sm">
                    {u.role.type}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="text.secondary">{u.addedBy}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="text.secondary">
                    {new Date(u.addedAt).toLocaleDateString()}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Box>
  );
}

// --- Infrastructure Tab ---

function InfrastructureTab({ repo }: { repo: string }) {
  const { data: workspaces, isLoading: wsLoading, isFetching: wsFetching, error: wsError } = useWorkspaceList(API_URL, repo, getRequestOptions(), { refetchInterval: 1000 });
  const { data: packages, isLoading: pkgLoading, isFetching: pkgFetching, error: pkgError } = usePackageList(API_URL, repo, getRequestOptions());
  const { data: schedules, isLoading: schedLoading, isFetching: schedFetching, error: schedError } = useRepoSchedules(repo);
  const toggleSchedule = useToggleSchedule(repo);
  const removeScheduleMutation = useRemoveSchedule(repo);
  const [selectedSchedules, setSelectedSchedules] = useState<Set<string>>(new Set());

  // Only show full-page loading on first fetch (no cached data yet)
  const isInitialLoading = useMemo(
    () => (wsLoading || (!workspaces && wsFetching))
      && (pkgLoading || (!packages && pkgFetching))
      && (schedLoading || (!schedules && schedFetching)),
    [wsLoading, wsFetching, workspaces, pkgLoading, pkgFetching, packages, schedLoading, schedFetching, schedules]
  );

  const workspaceNames = useMemo(() => (workspaces ?? []).map((ws) => ws.name), [workspaces]);
  const { data: taskConfigData } = useRepoTaskConfigs(repo, workspaceNames);
  const taskConfigCount = useMemo(() => {
    let count = 0;
    for (const configs of taskConfigData.values()) {
      const tasks = new Set([...configs.compute.keys(), ...configs.timeout.keys()]);
      count += tasks.size;
    }
    return count;
  }, [taskConfigData]);

  const activeSchedules = useMemo(() => (schedules ?? []).filter((s) => s.enabled).length, [schedules]);
  const scheduledWorkspaces = useMemo(() => new Set((schedules ?? []).map((s) => s.workspace)), [schedules]);
  const unscheduledWorkspaces = useMemo(
    () => workspaceNames.filter((name) => !scheduledWorkspaces.has(name)),
    [workspaceNames, scheduledWorkspaces]
  );

  const firstError = useMemo(() => wsError || pkgError || schedError, [wsError, pkgError, schedError]);
  const hasNoData = useMemo(() => !workspaces && !packages && !schedules, [workspaces, packages, schedules]);

  if (isInitialLoading) return <LoadingState message="Loading infrastructure..." />;
  if (firstError && hasNoData) return <ErrorState title="Failed to load infrastructure" error={firstError} />;

  return (
    <Box display="flex" flexDirection="column" flex={1} minH={0}>
      {/* Stats */}
      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={4} mb={4} flexShrink={0}>
        <StatCard label="Workspaces" value={workspaces?.length ?? 0} helpText="Deployed environments" />
        <StatCard label="Packages" value={packages?.length ?? 0} helpText="Imported packages" />
        <StatCard label="Active Schedules" value={`${activeSchedules} / ${schedules?.length ?? 0}`} helpText="Enabled / total" />
        <StatCard label="Task Configs" value={taskConfigCount} helpText="Custom compute/timeout" />
      </SimpleGrid>

      {/* Workspaces */}
      {workspaces && workspaces.length > 0 && (
        <Box mb={4} flexShrink={0}>
          <Text fontSize="sm" fontWeight={600} color="text.primary" mb={2}>Workspaces</Text>
          <Box border="1px solid" borderColor="border.primary" borderRadius="md" overflow="hidden">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row bg="bg.tertiary">
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Name</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Package</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Status</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Last Execution</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} w="120px">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {workspaces.map((ws) => (
                  <WorkspaceRow key={ws.name} repo={repo} workspace={ws} />
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </Box>
      )}

      {/* Schedules */}
      <Box flexShrink={0}>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight={600} color="text.primary">Schedules</Text>
          <HStack gap={2}>
            <ConfirmPopover
              message={`Delete schedule for "${selectedSchedules.size === 1 ? Array.from(selectedSchedules)[0] : ''}"?`}
              confirmLabel="Delete"
              loading={removeScheduleMutation.isPending}
              onConfirm={() => {
                if (selectedSchedules.size !== 1) return;
                const ws = Array.from(selectedSchedules)[0];
                removeScheduleMutation.mutate(ws, {
                  onSuccess: () => setSelectedSchedules(new Set()),
                });
              }}
              trigger={
                <Button
                  size="xs"
                  variant="outline"
                  borderColor="border.primary"
                  color="text.tertiary"
                  _hover={{ color: 'red.500', borderColor: 'red.500' }}
                  disabled={selectedSchedules.size !== 1}
                >
                  <FiTrash2 size={12} />
                  <Text ml={1}>Delete</Text>
                </Button>
              }
            />
            <ScheduleFormPopover
              repo={repo}
              workspaces={unscheduledWorkspaces}
              trigger={
                <Button size="xs" variant="outline" borderColor="border.primary" color="text.primary" _hover={{ bg: 'bg.hover' }} disabled={unscheduledWorkspaces.length === 0}>
                  <FiPlus size={12} />
                  <Text ml={1}>Add Schedule</Text>
                </Button>
              }
            />
          </HStack>
        </HStack>
        {schedules && schedules.length > 0 ? (
          <Box border="1px solid" borderColor="border.primary" borderRadius="md" overflow="hidden">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row bg="bg.tertiary">
                  <Table.ColumnHeader w="40px" position="sticky" top={0} bg="bg.tertiary" zIndex={1}>
                    <Checkbox.Root
                      size="sm"
                      checked={schedules.length > 0 && selectedSchedules.size === schedules.length}
                      onCheckedChange={() => {
                        setSelectedSchedules((prev) => {
                          if (prev.size === schedules.length) return new Set();
                          return new Set(schedules.map((s) => s.workspace));
                        });
                      }}
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                    </Checkbox.Root>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Workspace</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Cron</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Timezone</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Status</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Force Patterns</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Updated</Table.ColumnHeader>
                  <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} w="100px">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {schedules.map((sched) => (
                  <Table.Row key={`${sched.repo}-${sched.workspace}`} _hover={{ bg: 'bg.hover' }}>
                    <Table.Cell>
                      <Checkbox.Root
                        size="sm"
                        checked={selectedSchedules.has(sched.workspace)}
                        onCheckedChange={() => {
                          setSelectedSchedules((prev) => {
                            const next = new Set(prev);
                            if (next.has(sched.workspace)) next.delete(sched.workspace);
                            else next.add(sched.workspace);
                            return next;
                          });
                        }}
                      >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                      </Checkbox.Root>
                    </Table.Cell>
                    <Table.Cell><Text fontSize="sm" color="text.primary">{sched.workspace}</Text></Table.Cell>
                    <Table.Cell><Text fontSize="sm" color="text.primary" fontFamily="mono">{sched.cronExpression}</Text></Table.Cell>
                    <Table.Cell><Text fontSize="sm" color="text.secondary">{sched.timezone}</Text></Table.Cell>
                    <Table.Cell>
                      <Badge variant="subtle" colorPalette={sched.enabled ? 'green' : 'gray'} size="sm">
                        {sched.enabled ? 'active' : 'paused'}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="text.secondary">
                        {sched.forceTasks.length > 0 ? sched.forceTasks.join(', ') : '—'}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="text.secondary">
                        {new Date(sched.updatedAt).toLocaleDateString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <HStack gap={1}>
                        <ScheduleFormPopover
                          repo={repo}
                          schedule={sched}
                          trigger={
                            <Button size="xs" variant="ghost" color="text.tertiary" _hover={{ color: 'link.color' }}>
                              <FiEdit2 size={12} />
                            </Button>
                          }
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          borderColor="border.primary"
                          onClick={() => toggleSchedule.mutate(sched)}
                          disabled={toggleSchedule.isPending}
                        >
                          {sched.enabled ? 'Pause' : 'Enable'}
                        </Button>
                      </HStack>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        ) : (
          <Text fontSize="sm" color="text.tertiary">No schedules configured.</Text>
        )}
      </Box>

      {/* Task Configs */}
      <Box mt={4}>
        <TaskConfigsSection repo={repo} workspaces={workspaceNames} />
      </Box>
    </Box>
  );
}

// --- Workspace Row ---

function WorkspaceRow({ repo, workspace: ws }: { repo: string; workspace: WorkspaceInfo }) {
  const qc = useQueryClient();
  const { data: execution } = useWorkspaceExecution(repo, ws.name);
  const startMutation = useDataflowStart(API_URL, repo, ws.name, getRequestOptions());
  const removeMutation = useWorkspaceRemove(API_URL, repo, getRequestOptions());
  const now = useNow();

  const handleStart = () => {
    startMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['workspaceStatus', API_URL, repo, ws.name] });
        qc.invalidateQueries({ queryKey: ['dataflowExecution', API_URL, repo, ws.name] });
        toaster.create({ title: `Dataflow started on ${ws.name}`, type: 'success' });
      },
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  };

  const handleRemove = () => {
    removeMutation.mutate(ws.name, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['workspaceList', API_URL, repo] });
        qc.invalidateQueries({ queryKey: ['workspaces', repo] });
        toaster.create({ title: `Workspace "${ws.name}" deleted`, type: 'success' });
      },
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  };

  const execStatus = useMemo(() => execution?.status.type, [execution]);
  const execStarted = useMemo(() => execution?.startedAt, [execution]);
  const execCompleted = useMemo(() => execution?.completedAt.type === 'some' ? execution.completedAt.value : null, [execution]);
  const execSummary = useMemo(() => execution?.summary.type === 'some' ? execution.summary.value : null, [execution]);

  return (
    <Table.Row _hover={{ bg: 'bg.hover' }}>
      <Table.Cell>
        <Text asChild fontSize="sm" color="link.color" fontWeight={500} _hover={{ textDecoration: 'underline', color: 'link.hover' }}>
          <Link to={`/repos/${repo}/workspaces/${ws.name}`}>{ws.name}</Link>
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="text.secondary">
          {ws.packageName.type === 'some'
            ? `${ws.packageName.value}${ws.packageVersion.type === 'some' ? `@${ws.packageVersion.value}` : ''}`
            : '—'}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {ws.deployed ? <StatusBadge status="deployed" /> : <StatusBadge status="unset" />}
      </Table.Cell>
      <Table.Cell>
        {execution === undefined ? (
          <Text fontSize="sm" color="text.tertiary">...</Text>
        ) : execution === null ? (
          <Text fontSize="sm" color="text.tertiary">None</Text>
        ) : (
          <VStack gap={0} align="start">
            <HStack gap={2}>
              <StatusBadge status={execStatus ?? 'unknown'} />
              {execSummary && (
                <Text fontSize="xs" color="text.tertiary">
                  {Number(execSummary.executed)} run, {Number(execSummary.cached)} cached, {Number(execSummary.failed)} failed
                </Text>
              )}
            </HStack>
            <Text fontSize="xs" color="text.tertiary">
              {execCompleted
                ? formatTimeAgo(execCompleted, now)
                : execStarted
                  ? `Started ${formatTimeAgo(execStarted, now)}`
                  : ''}
            </Text>
          </VStack>
        )}
      </Table.Cell>
      <Table.Cell>
        <HStack gap={1}>
          {ws.deployed && (
            <Button
              size="xs"
              variant="outline"
              borderColor="border.primary"
              onClick={handleStart}
              disabled={startMutation.isPending || execStatus === 'running'}
            >
              <FiPlay size={10} />
              <Text ml={1}>Run</Text>
            </Button>
          )}
          <Button size="xs" variant="ghost" color="text.tertiary" asChild>
            <Link to={`/repos/${repo}/workspaces/${ws.name}`}>
              <FiExternalLink size={12} />
            </Link>
          </Button>
          <ConfirmPopover
            message={`Delete workspace "${ws.name}"? This cannot be undone.`}
            confirmLabel="Delete"
            loading={removeMutation.isPending}
            onConfirm={handleRemove}
            trigger={
              <Button size="xs" variant="ghost" color="text.tertiary" _hover={{ color: 'red.500' }}>
                <FiTrash2 size={12} />
              </Button>
            }
          />
        </HStack>
      </Table.Cell>
    </Table.Row>
  );
}

// --- Task Pattern Input ---

function TaskPatternInput({
  repo,
  workspace,
  value,
  onChange,
  disabled,
}: {
  repo: string;
  workspace: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { data: tasks } = useTaskList(API_URL, repo, workspace || null, getRequestOptions());
  const [inputValue, setInputValue] = useState('');

  const patterns = useMemo(
    () => value.split(',').map((s) => s.trim()).filter(Boolean),
    [value]
  );

  const taskNames = useMemo(() => (tasks ?? []).map((t) => t.name), [tasks]);

  const suggestions = useMemo(() => {
    if (!inputValue) return taskNames;
    const lower = inputValue.toLowerCase();
    return taskNames.filter((n) => n.toLowerCase().includes(lower));
  }, [inputValue, taskNames]);

  const collection = useMemo(
    () => createListCollection({ items: suggestions.map((s) => ({ label: s, value: s })) }),
    [suggestions]
  );

  const updatePatterns = useCallback(
    (newPatterns: string[]) => onChange(newPatterns.join(', ')),
    [onChange]
  );

  const addPattern = useCallback(
    (pattern: string) => {
      const trimmed = pattern.trim();
      if (!trimmed || patterns.includes(trimmed)) return;
      updatePatterns([...patterns, trimmed]);
      setInputValue('');
    },
    [patterns, updatePatterns]
  );

  const removePattern = useCallback(
    (pattern: string) => updatePatterns(patterns.filter((p) => p !== pattern)),
    [patterns, updatePatterns]
  );

  return (
    <VStack gap={1} align="stretch">
      {patterns.length > 0 && (
        <Wrap gap={1}>
          {patterns.map((p) => (
            <Badge key={p} variant="subtle" colorPalette="teal" size="sm">
              <HStack gap={1}>
                <Text>{p}</Text>
                <Button
                  size="2xs"
                  variant="ghost"
                  onClick={() => removePattern(p)}
                  minW="auto"
                  h="auto"
                  p={0}
                  disabled={disabled}
                >
                  <FiX size={10} />
                </Button>
              </HStack>
            </Badge>
          ))}
        </Wrap>
      )}
      <Combobox.Root
        size="sm"
        collection={collection}
        inputValue={inputValue}
        onInputValueChange={(e) => setInputValue(e.inputValue)}
        value={[]}
        onValueChange={(e) => {
          if (e.value[0]) addPattern(e.value[0]);
        }}
        openOnClick
        disabled={disabled}
      >
        <Combobox.Control>
          <Combobox.Input
            placeholder="Type pattern or select task..."
            borderColor="border.primary"
            bg="input.bg"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                e.preventDefault();
                addPattern(inputValue);
              }
            }}
          />
          <Combobox.Trigger />
        </Combobox.Control>
        <Combobox.Positioner>
          <Combobox.Content bg="modal.bg" border="1px solid" borderColor="border.primary" borderRadius="md" maxH="200px" overflowY="auto" zIndex="popover">
            {suggestions.length > 0 ? suggestions.map((name) => (
              <Combobox.Item key={name} item={{ label: name, value: name }} fontSize="sm">
                <Combobox.ItemText>{name}</Combobox.ItemText>
              </Combobox.Item>
            )) : (
              <Text fontSize="sm" color="text.tertiary" p={2}>
                {inputValue ? 'Press Enter to add as pattern' : 'No tasks found'}
              </Text>
            )}
          </Combobox.Content>
        </Combobox.Positioner>
      </Combobox.Root>
    </VStack>
  );
}

// --- Compute Size Helpers ---

const COMPUTE_TIERS = ['serverless', 'small', 'medium', 'large', 'xlarge'] as const;
type ComputeTier = typeof COMPUTE_TIERS[number];

const COMPUTE_COLORS: Record<ComputeTier, string> = {
  serverless: 'blue',
  small: 'green',
  medium: 'yellow',
  large: 'orange',
  xlarge: 'red',
};

function computeSizeTier(size: ComputeSize): ComputeTier {
  return Object.keys(size)[0] as ComputeTier;
}

function tierToComputeSize(tier: ComputeTier): ComputeSize {
  return variant(tier, null) as ComputeSize;
}

// --- Task Combobox ---

function TaskCombobox({ tasks, value, onChange }: { tasks: string[]; value: string; onChange: (v: string) => void }) {
  const [inputValue, setInputValue] = useState(value);

  const items = useMemo(() => tasks.map((t) => ({ label: t, value: t })), [tasks]);

  const filteredItems = useMemo(() => {
    if (!inputValue) return items;
    const lower = inputValue.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower));
  }, [inputValue, items]);

  const collection = useMemo(
    () => createListCollection({ items: filteredItems }),
    [filteredItems]
  );

  return (
    <Combobox.Root
      size="sm"
      collection={collection}
      inputValue={inputValue}
      onInputValueChange={(e) => setInputValue(e.inputValue)}
      value={value ? [value] : []}
      onValueChange={(e) => {
        onChange(e.value[0] ?? '');
        setInputValue(e.value[0] ?? '');
      }}
      openOnClick
    >
      <Combobox.Control>
        <Combobox.Input placeholder="Search task..." borderColor="border.primary" bg="input.bg" />
        <Combobox.Trigger />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content bg="modal.bg" border="1px solid" borderColor="border.primary" borderRadius="md" maxH="200px" overflowY="auto" zIndex="popover">
          {filteredItems.length > 0 ? filteredItems.map((item) => (
            <Combobox.Item key={item.value} item={item} fontSize="sm">
              <Combobox.ItemText>{item.label}</Combobox.ItemText>
            </Combobox.Item>
          )) : (
            <Text fontSize="sm" color="text.tertiary" p={2}>No tasks found</Text>
          )}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

// --- Task Config Form Popover ---

function TaskConfigFormPopover({
  repo,
  trigger,
  workspaces,
  existing,
}: {
  repo: string;
  trigger: React.ReactNode;
  workspaces: string[];
  existing?: { workspace: string; task: string; compute?: ComputeSize; timeout?: TaskTimeout };
}) {
  const setComputeMutation = useSetCompute(repo);
  const setTimeoutMutation = useSetTaskTimeout(repo);
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState(existing?.workspace ?? '');
  const [task, setTask] = useState(existing?.task ?? '');
  const [tier, setTier] = useState<ComputeTier>(existing?.compute ? computeSizeTier(existing.compute) : 'serverless');
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    existing?.timeout ? Number(existing.timeout.minutes).toString() : ''
  );

  const { data: tasks } = useTaskList(API_URL, repo, workspace || null, getRequestOptions());
  const taskNames = useMemo(() => (tasks ?? []).map((t) => t.name), [tasks]);

  const isEdit = !!existing;
  const formDisabled = !isEdit && (!workspace.trim() || !task.trim());
  const isPending = setComputeMutation.isPending || setTimeoutMutation.isPending;

  const defaultTimeout = tier === 'serverless' ? DEFAULT_TIMEOUT_SERVERLESS : DEFAULT_TIMEOUT_FARGATE;

  const resetForm = () => {
    setWorkspace(existing?.workspace ?? '');
    setTask(existing?.task ?? '');
    setTier(existing?.compute ? computeSizeTier(existing.compute) : 'serverless');
    setTimeoutMinutes(existing?.timeout ? Number(existing.timeout.minutes).toString() : '');
  };

  const handleSubmit = async () => {
    const ws = isEdit ? existing.workspace : workspace.trim();
    const taskName = isEdit ? existing.task : task.trim();
    if (!ws || !taskName) return;

    try {
      await setComputeMutation.mutateAsync({ workspace: ws, task: taskName, size: tierToComputeSize(tier) });
      if (timeoutMinutes.trim()) {
        const mins = parseInt(timeoutMinutes, 10);
        if (!isNaN(mins) && mins > 0) {
          await setTimeoutMutation.mutateAsync({ workspace: ws, task: taskName, timeout: { minutes: BigInt(mins) } });
        }
      }
      setOpen(false);
      if (!isEdit) resetForm();
      toaster.create({ title: `Task config ${isEdit ? 'updated' : 'created'} for ${taskName}`, type: 'success' });
    } catch (err) {
      toaster.create({ title: `Error: ${err instanceof Error ? err.message : 'Failed'}`, type: 'error' });
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) resetForm();
      }}
    >
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Body display="flex" flexDirection="column" gap={2} overflow="auto">
                {!isEdit && (
                  <>
                    <Field.Root>
                      <Field.Label fontSize="xs" fontWeight={600}>Workspace</Field.Label>
                      <WorkspaceCombobox workspaces={workspaces} value={workspace} onChange={setWorkspace} />
                    </Field.Root>
                    <Field.Root disabled={!workspace.trim()}>
                      <Field.Label fontSize="xs" fontWeight={600}>Task</Field.Label>
                      <TaskCombobox tasks={taskNames} value={task} onChange={setTask} />
                    </Field.Root>
                  </>
                )}
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>
                    Compute Size
                    {!formDisabled && <InfoTip portalled={false} content={"serverless: Lambda (~1.8 GB RAM, 15 min max)\nsmall: Fargate 1 vCPU / 2 GB\nmedium: Fargate 2 vCPU / 8 GB\nlarge: Fargate 4 vCPU / 16 GB\nxlarge: Fargate 8 vCPU / 32 GB"} />}
                  </Field.Label>
                  <HStack gap={1} flexWrap="wrap">
                    {COMPUTE_TIERS.map((t) => (
                      <Button
                        key={t}
                        size="xs"
                        variant={tier === t ? 'solid' : 'outline'}
                        colorPalette={tier === t ? COMPUTE_COLORS[t] : 'gray'}
                        onClick={() => setTier(t)}
                        disabled={formDisabled}
                      >
                        {t}
                      </Button>
                    ))}
                  </HStack>
                </Field.Root>
                <Field.Root disabled={formDisabled}>
                  <Field.Label fontSize="xs" fontWeight={600}>
                    Timeout (minutes)
                    {!formDisabled && <InfoTip portalled={false} content={`Leave empty for default (${defaultTimeout} min)`} />}
                  </Field.Label>
                  <Input
                    size="sm"
                    type="number"
                    placeholder={`Default: ${defaultTimeout}`}
                    value={timeoutMinutes}
                    onChange={(e) => setTimeoutMinutes(e.target.value)}
                  />
                </Field.Root>
                <HStack gap={2} justify="flex-end">
                  <Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="xs" colorPalette="teal" onClick={handleSubmit} disabled={formDisabled || isPending}>
                    {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
                  </Button>
                </HStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

// --- Task Configs Section ---

interface TaskConfigRow {
  workspace: string;
  task: string;
  compute?: ComputeSize;
  timeout?: TaskTimeout;
}

function TaskConfigsSection({ repo, workspaces }: { repo: string; workspaces: string[] }) {
  const { data: taskConfigData, isLoading } = useRepoTaskConfigs(repo, workspaces);
  const removeComputeMutation = useRemoveCompute(repo);
  const removeTimeoutMutation = useRemoveTimeout(repo);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const configs = useMemo(() => {
    const result: TaskConfigRow[] = [];
    for (const [ws, data] of taskConfigData) {
      const tasks = new Set([...data.compute.keys(), ...data.timeout.keys()]);
      for (const task of tasks) {
        result.push({ workspace: ws, task, compute: data.compute.get(task), timeout: data.timeout.get(task) });
      }
    }
    return result;
  }, [taskConfigData]);

  const configKey = (c: TaskConfigRow) => `${c.workspace}:${c.task}`;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === configs.length) return new Set();
      return new Set(configs.map(configKey));
    });
  };

  const handleDeleteSelected = async () => {
    const toDelete = configs.filter((c) => selected.has(configKey(c)));
    try {
      await Promise.all(
        toDelete.flatMap((c) => {
          const ops: Promise<void>[] = [];
          if (c.compute) ops.push(removeComputeMutation.mutateAsync({ workspace: c.workspace, task: c.task }));
          if (c.timeout) ops.push(removeTimeoutMutation.mutateAsync({ workspace: c.workspace, task: c.task }));
          return ops;
        })
      );
      setSelected(new Set());
      toaster.create({ title: `Deleted ${toDelete.length} task config(s)`, type: 'success' });
    } catch (err) {
      toaster.create({ title: `Error: ${err instanceof Error ? err.message : 'Failed'}`, type: 'error' });
    }
  };

  const isDeleting = removeComputeMutation.isPending || removeTimeoutMutation.isPending;

  return (
    <Box flexShrink={0}>
      <HStack justify="space-between" mb={2}>
        <Text fontSize="sm" fontWeight={600} color="text.primary">Task Configs</Text>
        <HStack gap={2}>
          <ConfirmPopover
            message={`Delete ${selected.size} task config(s)?`}
            confirmLabel="Delete"
            loading={isDeleting}
            onConfirm={handleDeleteSelected}
            trigger={
              <Button
                size="xs"
                variant="outline"
                borderColor="border.primary"
                color="text.tertiary"
                _hover={{ color: 'red.500', borderColor: 'red.500' }}
                disabled={selected.size === 0}
              >
                <FiTrash2 size={12} />
                <Text ml={1}>Delete</Text>
              </Button>
            }
          />
          <TaskConfigFormPopover
            repo={repo}
            workspaces={workspaces}
            trigger={
              <Button size="xs" variant="outline" borderColor="border.primary" color="text.primary" _hover={{ bg: 'bg.hover' }}>
                <FiPlus size={12} />
                <Text ml={1}>Add Config</Text>
              </Button>
            }
          />
        </HStack>
      </HStack>
      {isLoading ? (
        <Text fontSize="sm" color="text.tertiary">Loading task configs...</Text>
      ) : configs.length > 0 ? (
        <Box border="1px solid" borderColor="border.primary" borderRadius="md" overflow="hidden">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row bg="bg.tertiary">
                <Table.ColumnHeader w="40px" position="sticky" top={0} bg="bg.tertiary" zIndex={1}>
                  <Checkbox.Root
                    size="sm"
                    checked={configs.length > 0 && selected.size === configs.length}
                    onCheckedChange={toggleAll}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                </Table.ColumnHeader>
                <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Workspace</Table.ColumnHeader>
                <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Task</Table.ColumnHeader>
                <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Compute</Table.ColumnHeader>
                <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600}>Timeout</Table.ColumnHeader>
                <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} w="80px">Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {configs.map((cfg) => {
                const key = configKey(cfg);
                const tier = cfg.compute ? computeSizeTier(cfg.compute) : undefined;
                return (
                  <Table.Row key={key} _hover={{ bg: 'bg.hover' }}>
                    <Table.Cell>
                      <Checkbox.Root
                        size="sm"
                        checked={selected.has(key)}
                        onCheckedChange={() => toggleSelect(key)}
                      >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                      </Checkbox.Root>
                    </Table.Cell>
                    <Table.Cell><Text fontSize="sm" color="text.primary">{cfg.workspace}</Text></Table.Cell>
                    <Table.Cell><Text fontSize="sm" color="text.primary" fontFamily="mono">{cfg.task}</Text></Table.Cell>
                    <Table.Cell>
                      {tier ? (
                        <Badge variant="subtle" colorPalette={COMPUTE_COLORS[tier]} size="sm">{tier}</Badge>
                      ) : (
                        <Text fontSize="sm" color="text.tertiary">—</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="text.secondary">
                        {cfg.timeout ? `${Number(cfg.timeout.minutes)} min` : '—'}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <TaskConfigFormPopover
                        repo={repo}
                        workspaces={workspaces}
                        existing={cfg}
                        trigger={
                          <Button size="xs" variant="ghost" color="text.tertiary" _hover={{ color: 'link.color' }}>
                            <FiEdit2 size={12} />
                          </Button>
                        }
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Box>
      ) : (
        <Text fontSize="sm" color="text.tertiary">No task configs configured.</Text>
      )}
    </Box>
  );
}

// --- Cron Hint ---

function CronHint({ expression }: { expression: string }) {
  if (!expression.trim()) return null;
  try {
    const desc = cronstrue.toString(expression, { throwExceptionOnParseError: true });
    return <Text fontSize="xs" color="text.tertiary" mt={1}>{desc}</Text>;
  } catch {
    return <Text fontSize="xs" color="red.400" mt={1}>Invalid cron expression</Text>;
  }
}

// --- Glob Hint ---
// Matches backend globToRegex in e3-aws-runner/src/handlers/schedule-trigger.ts
// Only `*` wildcard is supported (matches zero or more characters)

function describeGlob(pattern: string): string {
  if (pattern === '*') return 'all tasks';
  if (!pattern.includes('*')) return `task "${pattern}" (exact)`;
  if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) return `tasks starting with "${pattern.slice(0, -1)}"`;
  if (pattern.startsWith('*') && !pattern.slice(1).includes('*')) return `tasks ending with "${pattern.slice(1)}"`;
  return `tasks matching "${pattern}"`;
}

function GlobHint({ patterns }: { patterns: string }) {
  if (!patterns.trim()) return null;
  const parts = patterns.split(',').map((s) => s.trim()).filter(Boolean);
  const desc = parts.map(describeGlob).join('; ');
  return <Text fontSize="xs" color="text.tertiary" mt={1}>Force cache bypass for {desc}</Text>;
}

// --- Timezone validation ---

const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');
const ALL_TZ_ITEMS = ALL_TIMEZONES.map((tz) => ({ label: tz, value: tz }));

function TimezoneCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [inputValue, setInputValue] = useState(value);

  const filteredItems = useMemo(() => {
    if (!inputValue) return ALL_TZ_ITEMS;
    const lower = inputValue.toLowerCase();
    return ALL_TZ_ITEMS.filter((item) => item.label.toLowerCase().includes(lower));
  }, [inputValue]);

  const collection = useMemo(
    () => createListCollection({ items: filteredItems }),
    [filteredItems]
  );

  return (
    <Combobox.Root
      size="sm"
      collection={collection}
      inputValue={inputValue}
      onInputValueChange={(e) => setInputValue(e.inputValue)}
      value={value ? [value] : []}
      onValueChange={(e) => {
        onChange(e.value[0] ?? '');
        setInputValue(e.value[0] ?? '');
      }}
      openOnClick
    >
      <Combobox.Control>
        <Combobox.Input placeholder="Search timezone..." borderColor="border.primary" bg="input.bg" />
        <Combobox.Trigger />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content bg="modal.bg" border="1px solid" borderColor="border.primary" borderRadius="md" maxH="200px" overflowY="auto" zIndex="popover">
          {filteredItems.length > 0 ? filteredItems.map((item) => (
            <Combobox.Item key={item.value} item={item} fontSize="sm">
              <Combobox.ItemText>{item.label}</Combobox.ItemText>
            </Combobox.Item>
          )) : (
            <Text fontSize="sm" color="text.tertiary" p={2}>No timezones found</Text>
          )}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

function WorkspaceCombobox({ workspaces, value, onChange }: { workspaces: string[]; value: string; onChange: (v: string) => void }) {
  const [inputValue, setInputValue] = useState(value);

  const items = useMemo(() => workspaces.map((ws) => ({ label: ws, value: ws })), [workspaces]);

  const filteredItems = useMemo(() => {
    if (!inputValue) return items;
    const lower = inputValue.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower));
  }, [inputValue, items]);

  const collection = useMemo(
    () => createListCollection({ items: filteredItems }),
    [filteredItems]
  );

  return (
    <Combobox.Root
      size="sm"
      collection={collection}
      inputValue={inputValue}
      onInputValueChange={(e) => setInputValue(e.inputValue)}
      value={value ? [value] : []}
      onValueChange={(e) => {
        onChange(e.value[0] ?? '');
        setInputValue(e.value[0] ?? '');
      }}
      openOnClick
    >
      <Combobox.Control>
        <Combobox.Input placeholder="Search workspace..." borderColor="border.primary" bg="input.bg" />
        <Combobox.Trigger />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content bg="modal.bg" border="1px solid" borderColor="border.primary" borderRadius="md" maxH="200px" overflowY="auto" zIndex="popover">
          {filteredItems.length > 0 ? filteredItems.map((item) => (
            <Combobox.Item key={item.value} item={item} fontSize="sm">
              <Combobox.ItemText>{item.label}</Combobox.ItemText>
            </Combobox.Item>
          )) : (
            <Text fontSize="sm" color="text.tertiary" p={2}>No workspaces found</Text>
          )}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

