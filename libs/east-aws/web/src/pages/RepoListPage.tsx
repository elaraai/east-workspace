/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Text, Card, SimpleGrid, Input, HStack, Button, Checkbox } from '@chakra-ui/react';
import { FiDatabase, FiTrash2, FiSearch, FiChevronRight } from 'react-icons/fi';
import { useRepoList, useRepoRemove } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { useCardStyles } from '../hooks/useCardStyles';
import { LoadingState, EmptyState, ErrorState } from '../components/DisplayStates';
import { toaster } from '../components/Toaster';
import { ConfirmPopover } from '../components/ConfirmPopover';

export function RepoListPage() {
  const { data: repos, isLoading, isFetching, error } = useRepoList(API_URL, getRequestOptions());
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const removeMutation = useRepoRemove(API_URL, getRequestOptions());
  const cardStyles = useCardStyles();
  const navigate = useNavigate();

  const showLoading = useMemo(() => isLoading || (!repos && isFetching), [isLoading, repos, isFetching]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    return repos
      .filter((name) => name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [repos, filter]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectedName = useMemo(() => selected.size === 1 ? Array.from(selected)[0] : null, [selected]);

  const handleRemoveSelected = useCallback(() => {
    if (!selectedName) return;
    removeMutation.mutate(selectedName, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['repoList', API_URL] });
        setSelected(new Set());
        toaster.create({ title: `Repository "${selectedName}" deleted`, type: 'success' });
      },
      onError: (err) => {
        toaster.create({ title: `Failed to delete "${selectedName}": ${err.message}`, type: 'error' });
      },
    });
  }, [selectedName, removeMutation, qc]);

  const content = useMemo(() => {
    if (error) {
      return <ErrorState title="Failed to load repositories" error={error} />;
    }
    if (showLoading) {
      return <LoadingState message="Loading repositories..." />;
    }
    if (!repos || repos.length === 0) {
      return (
        <EmptyState
          icon={<FiDatabase size={24} />}
          heading="No repositories"
          description="No repositories have been created yet."
        />
      );
    }
    if (filtered.length === 0) {
      return <EmptyState heading="No matches" description="No repositories match your search." />;
    }
    return (
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
        {filtered.map((name) => (
          <Card.Root
            key={name}
            {...cardStyles}
            borderColor={selected.has(name) ? 'border.hover' : cardStyles.borderColor}
            cursor="pointer"
            onClick={() => navigate(`/repos/${name}`)}
          >
            <Card.Body p={5} position="relative">
              <HStack gap={3} align="start">
                <Box pt="2px" onClick={(e) => e.stopPropagation()}>
                  <Checkbox.Root
                    size="sm"
                    checked={selected.has(name)}
                    onCheckedChange={() => toggleSelect(name)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                </Box>
                <Box flex={1}>
                  <Text fontSize="sm" fontWeight={600} color="text.primary">
                    {name}
                  </Text>
                  <Text fontSize="sm" color="text.secondary">
                    Repository
                  </Text>
                </Box>
              </HStack>
              <Box position="absolute" top={4} right={4} color="text.tertiary">
                <FiChevronRight size={16} />
              </Box>
            </Card.Body>
          </Card.Root>
        ))}
      </SimpleGrid>
    );
  }, [error, showLoading, repos, filtered, selected, toggleSelect, cardStyles, navigate]);

  return (
    <Box>
      {/* Toolbar */}
      <HStack mb={4} justify="space-between">
        <Box position="relative" flex={1} maxW="400px">
          <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="text.tertiary" zIndex={1}>
            <FiSearch size={14} />
          </Box>
          <Input
            pl={9}
            placeholder="Search repositories..."
            value={filter}
            onChange={handleFilterChange}
            borderColor="border.primary"
            _hover={{ borderColor: 'border.hover' }}
            size="sm"
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

      {content}
    </Box>
  );
}
