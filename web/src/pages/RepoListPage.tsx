/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Text, SimpleGrid, Card, Input } from '@chakra-ui/react';
import { FiDatabase } from 'react-icons/fi';
import { useRepoList } from '../hooks/useApi';
import { useCardStyles } from '../hooks/useCardStyles';
import { LoadingState, EmptyState, ErrorState } from '../components/DisplayStates';

export function RepoListPage() {
  const { data: repos, isLoading, error } = useRepoList();
  const [filter, setFilter] = useState('');
  const cardStyles = useCardStyles();

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    return repos
      .filter((name) => name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [repos, filter]);

  if (error) {
    return <ErrorState title="Failed to load repositories" error={error} />;
  }

  if (isLoading) {
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

  return (
    <Box>
      {/* Search */}
      <Box mb={4} maxW="400px">
        <Input
          placeholder="Search repositories..."
          value={filter}
          onChange={handleFilterChange}
          bg="input.bg"
          borderColor="input.border"
          _focus={{ borderColor: 'brand.500' }}
          size="sm"
        />
      </Box>

      {filtered.length === 0 ? (
        <EmptyState heading="No matches" description="No repositories match your search." />
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
          {filtered.map((name) => (
            <Card.Root key={name} {...cardStyles} asChild>
              <Link to={`/repos/${name}`}>
                <Card.Body p={5}>
                  <Text fontSize="sm" fontWeight={600} color="text.primary" mb={1}>
                    {name}
                  </Text>
                  <Text fontSize="xs" color="text.secondary" textTransform="uppercase" letterSpacing="0.05em">
                    Repository
                  </Text>
                </Card.Body>
              </Link>
            </Card.Root>
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}
