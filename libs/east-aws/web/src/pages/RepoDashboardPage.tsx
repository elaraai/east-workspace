/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Box, Text, SimpleGrid, Card, Badge, HStack } from '@chakra-ui/react';
import { FiBox, FiChevronRight } from 'react-icons/fi';
import { useWorkspaceList } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';
import { useCardStyles } from '../hooks/useCardStyles';
import { LoadingState, EmptyState, ErrorState } from '../components/DisplayStates';

export function RepoDashboardPage() {
  const { repo } = useParams<{ repo: string }>();
  const { data: workspaces, isLoading: wsLoading, isFetching: wsFetching, error: wsError } = useWorkspaceList(API_URL, repo!, getRequestOptions(), { refetchInterval: 1000 });
  const cardStyles = useCardStyles();

  const content = useMemo(() => {
    if (wsLoading || (!workspaces && wsFetching)) {
      return <LoadingState message="Loading workspaces..." />;
    }
    if (wsError) {
      return <ErrorState title="Failed to load workspaces" error={wsError} />;
    }
    if (!workspaces || workspaces.length === 0) {
      return (
        <EmptyState
          icon={<FiBox size={24} />}
          heading="No workspaces"
          description="Create a workspace to get started."
        />
      );
    }
    return (
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4} mb={8}>
        {workspaces.map((ws) => (
          <Card.Root key={ws.name} {...cardStyles} asChild>
            <Link to={`/repos/${repo}/workspaces/${ws.name}`}>
              <Card.Body p={5}>
                <HStack justify="space-between" align="center" mb={2}>
                  <Text fontSize="sm" fontWeight={600} color="text.primary">
                    {ws.name}
                  </Text>
                  <HStack gap={2}>
                    {ws.deployed && (
                      <Badge colorPalette="blue" variant="subtle" size="sm">
                        Deployed
                      </Badge>
                    )}
                    <Box color="text.tertiary">
                      <FiChevronRight size={16} />
                    </Box>
                  </HStack>
                </HStack>
                {ws.packageName.type === 'some' && (
                  <Text fontSize="sm" color="text.secondary">
                    {ws.packageName.value}
                    {ws.packageVersion.type === 'some' ? `@${ws.packageVersion.value}` : ''}
                  </Text>
                )}
              </Card.Body>
            </Link>
          </Card.Root>
        ))}
      </SimpleGrid>
    );
  }, [wsLoading, wsFetching, wsError, workspaces, cardStyles, repo]);

  return (
    <Box>
      <Text fontSize="lg" fontWeight={600} color="text.primary" mb={4}>
        Workspaces
      </Text>
      {content}
    </Box>
  );
}
