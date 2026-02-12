/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Heading, Text, VStack, Card } from '@chakra-ui/react';
import { repoList } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';

export function RepoListPage() {
  const [repos, setRepos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repoList(API_URL, getRequestOptions())
      .then(setRepos)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Text>Loading repositories...</Text>;
  }

  if (error) {
    return <Text color="red.500">Error: {error}</Text>;
  }

  if (repos.length === 0) {
    return (
      <Box>
        <Heading size="lg" mb={4}>Repositories</Heading>
        <Text color="gray.500">No repositories found.</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="lg" mb={4}>Repositories</Heading>
      <VStack gap={3} align="stretch">
        {repos.map((name) => (
          <Card.Root key={name} asChild>
            <Link to={`/repos/${name}`}>
              <Card.Body>
                <Heading size="sm">{name}</Heading>
              </Card.Body>
            </Link>
          </Card.Root>
        ))}
      </VStack>
    </Box>
  );
}
