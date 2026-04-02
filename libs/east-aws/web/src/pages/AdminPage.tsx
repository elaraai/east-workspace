/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Text, Table, Input, HStack, Button, Checkbox } from '@chakra-ui/react';
import { FiSearch, FiTrash2 } from 'react-icons/fi';
import { LoadingState, ErrorState } from '../components/DisplayStates';
import { useAdminRepos } from '../hooks/useAdminApi';
import { useUser } from '../contexts/UserContext';
import { useRepoRemove } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { toaster } from '../components/Toaster';
import { ConfirmPopover } from '../components/ConfirmPopover';

export function AdminPage() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const user = useUser();
  const qc = useQueryClient();
  const { data: repos, isLoading, error } = useAdminRepos();
  const removeMutation = useRepoRemove(API_URL, getRequestOptions());

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search) return repos;
    const lower = search.toLowerCase();
    return repos.filter((r) => r.toLowerCase().includes(lower));
  }, [repos, search]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === filteredRepos.length) return new Set();
      return new Set(filteredRepos);
    });
  }, [filteredRepos]);

  const selectedName = useMemo(() => selected.size === 1 ? Array.from(selected)[0] : null, [selected]);

  const handleRemoveSelected = useCallback(() => {
    if (!selectedName) return;
    removeMutation.mutate(selectedName, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'repos'] });
        qc.invalidateQueries({ queryKey: ['repoList', API_URL] });
        setSelected(new Set());
        toaster.create({ title: `Repository "${selectedName}" deleted`, type: 'success' });
      },
      onError: (err) => {
        toaster.create({ title: `Failed to delete "${selectedName}": ${err.message}`, type: 'error' });
      },
    });
  }, [selectedName, removeMutation, qc]);

  if (!user.isAdmin) {
    return <ErrorState title="Access Denied" description="You must be an admin to view this page." />;
  }

  if (isLoading) return <LoadingState message="Loading repositories..." />;
  if (error) return <ErrorState title="Failed to load repositories" error={error} />;

  return (
    <Box display="flex" flexDirection="column" h="full">
      {/* Toolbar */}
      <HStack mb={3} gap={3} flexShrink={0} justify="space-between">
        <Box position="relative" flex={1} maxW="400px">
          <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="text.tertiary" zIndex={1}>
            <FiSearch size={14} />
          </Box>
          <Input
            pl={9}
            size="sm"
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            borderColor="border.primary"
            _hover={{ borderColor: 'border.hover' }}
          />
        </Box>
        <HStack gap={2}>
          <ConfirmPopover
            message={`Delete repository "${selectedName}"?`}
            confirmLabel="Delete"
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
                <Text ml={1}>Delete</Text>
              </Button>
            }
          />
        </HStack>
      </HStack>

      {/* Table */}
      <Box flex={1} minH={0} border="1px solid" borderColor="border.primary" borderRadius="md" overflow="auto">
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row bg="bg.tertiary">
              <Table.ColumnHeader w="40px" position="sticky" top={0} bg="bg.tertiary" zIndex={1}>
                <Checkbox.Root
                  size="sm"
                  checked={filteredRepos.length > 0 && selected.size === filteredRepos.length}
                  onCheckedChange={toggleAll}
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Table.ColumnHeader>
              <Table.ColumnHeader color="text.secondary" fontSize="xs" fontWeight={600} position="sticky" top={0} bg="bg.tertiary" zIndex={1}>Name</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filteredRepos.map((repo) => (
              <Table.Row key={repo} _hover={{ bg: 'bg.hover' }}>
                <Table.Cell>
                  <Checkbox.Root
                    size="sm"
                    checked={selected.has(repo)}
                    onCheckedChange={() => toggleSelect(repo)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                </Table.Cell>
                <Table.Cell>
                  <Text asChild color="link.color" fontWeight={500} fontSize="sm" _hover={{ textDecoration: 'underline', color: 'link.hover' }}>
                    <Link to={`/admin/repos/${repo}`}>{repo}</Link>
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
