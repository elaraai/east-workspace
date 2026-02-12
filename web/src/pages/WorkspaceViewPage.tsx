/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Text, Button, HStack, VStack, Card, SimpleGrid } from '@chakra-ui/react';
import { FiPlay, FiSquare } from 'react-icons/fi';
import { useWorkspaceStatus, useDataflowStartMutation, useDataflowCancelMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState } from '../components/DisplayStates';
import { toaster } from '../components/Toaster';

export function WorkspaceViewPage() {
  const { repo, workspace } = useParams<{ repo: string; workspace: string }>();
  const { data: status, isLoading } = useWorkspaceStatus(repo!, workspace!);
  const startMutation = useDataflowStartMutation(repo!, workspace!);
  const cancelMutation = useDataflowCancelMutation(repo!, workspace!);

  const handleStart = useCallback(() => {
    startMutation.mutate(undefined, {
      onSuccess: () => toaster.create({ title: 'Dataflow started', type: 'success' }),
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  }, [startMutation]);

  const handleCancel = useCallback(() => {
    cancelMutation.mutate(undefined, {
      onSuccess: () => toaster.create({ title: 'Dataflow cancelled', type: 'info' }),
      onError: (err) => toaster.create({ title: `Error: ${err.message}`, type: 'error' }),
    });
  }, [cancelMutation]);

  return (
    <Box>
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
            disabled={startMutation.isPending}
          >
            <FiPlay /> Start Dataflow
          </Button>
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
        </HStack>
      </HStack>

      {isLoading ? (
        <LoadingState message="Loading workspace status..." />
      ) : status ? (
        <VStack gap={6} align="stretch">
          {/* Summary */}
          <SimpleGrid columns={{ base: 2, md: 4 }} gap={4}>
            <SummaryCard label="Tasks" value={Number(status.summary.tasks.total)} />
            <SummaryCard label="Up to date" value={Number(status.summary.tasks.upToDate)} color="green" />
            <SummaryCard label="In progress" value={Number(status.summary.tasks.inProgress)} color="brand" />
            <SummaryCard
              label="Failed"
              value={Number(status.summary.tasks.failed) + Number(status.summary.tasks.error)}
              color="red"
            />
          </SimpleGrid>

          {/* Task list */}
          <Box>
            <Text fontSize="md" fontWeight={600} color="text.primary" mb={3}>
              Tasks
            </Text>
            <VStack gap={2} align="stretch">
              {status.tasks.map((task) => {
                const statusKey = Object.keys(task.status)[0] as string;
                return (
                  <HStack
                    key={task.name}
                    p={3}
                    border="1px solid"
                    borderColor="border.primary"
                    borderRadius="md"
                    bg="card.bg"
                    justify="space-between"
                  >
                    <Text fontWeight={500} fontSize="sm" color="text.primary">
                      {task.name}
                    </Text>
                    <StatusBadge status={statusKey} />
                  </HStack>
                );
              })}
            </VStack>
          </Box>

          {/* Datasets */}
          <Box>
            <Text fontSize="md" fontWeight={600} color="text.primary" mb={3}>
              Datasets
            </Text>
            <VStack gap={2} align="stretch">
              {status.datasets.map((ds) => {
                const statusKey = Object.keys(ds.status)[0] as string;
                return (
                  <HStack
                    key={ds.path}
                    p={3}
                    border="1px solid"
                    borderColor="border.primary"
                    borderRadius="md"
                    bg="card.bg"
                    justify="space-between"
                  >
                    <Text fontSize="sm" color="text.primary">
                      {ds.path}
                    </Text>
                    <StatusBadge status={statusKey} />
                  </HStack>
                );
              })}
            </VStack>
          </Box>
        </VStack>
      ) : (
        <Text color="text.secondary">No status data available.</Text>
      )}
    </Box>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card.Root variant="outline" borderColor="border.primary" borderRadius="md" bg="card.bg">
      <Card.Body p={4} textAlign="center">
        <Text fontSize="2xl" fontWeight={700} color={color ? `${color}.500` : 'text.primary'}>
          {value}
        </Text>
        <Text fontSize="xs" color="text.secondary" textTransform="uppercase" letterSpacing="0.05em">
          {label}
        </Text>
      </Card.Body>
    </Card.Root>
  );
}
