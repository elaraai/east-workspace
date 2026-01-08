/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Heading, Text, VStack, Card } from '@chakra-ui/react';
import { getApiClient } from '../api';

interface WorkspaceListProps {
  tenant: string;
}

export function WorkspaceList({ tenant }: WorkspaceListProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getApiClient(tenant);
    client.listWorkspaces()
      .then(setWorkspaces)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenant]);

  if (loading) {
    return <Text>Loading workspaces...</Text>;
  }

  if (error) {
    return <Text color="red.500">Error: {error}</Text>;
  }

  if (workspaces.length === 0) {
    return (
      <Box>
        <Heading size="lg" mb={4}>Workspaces</Heading>
        <Text color="gray.500">No workspaces found.</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="lg" mb={4}>Workspaces</Heading>
      <VStack gap={3} align="stretch">
        {workspaces.map((ws) => (
          <Card.Root key={ws} asChild>
            <Link to={`/workspaces/${ws}`}>
              <Card.Body>
                <Heading size="sm">{ws}</Heading>
              </Card.Body>
            </Link>
          </Card.Root>
        ))}
      </VStack>
    </Box>
  );
}
