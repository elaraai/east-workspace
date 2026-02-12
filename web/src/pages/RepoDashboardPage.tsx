/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Link, useParams } from 'react-router-dom';
import { Box, Text, SimpleGrid, Card, Badge, VStack, HStack } from '@chakra-ui/react';
import { FiBox, FiPackage } from 'react-icons/fi';
import { useWorkspaceList, usePackageList } from '../hooks/useApi';
import { useCardStyles } from '../hooks/useCardStyles';
import { LoadingState, EmptyState } from '../components/DisplayStates';

export function RepoDashboardPage() {
  const { repo } = useParams<{ repo: string }>();
  const { data: workspaces, isLoading: wsLoading } = useWorkspaceList(repo!);
  const { data: packages, isLoading: pkgLoading } = usePackageList(repo!);
  const cardStyles = useCardStyles();

  return (
    <Box>
      {/* Workspaces */}
      <Text fontSize="lg" fontWeight={600} color="text.primary" mb={4}>
        Workspaces
      </Text>

      {wsLoading ? (
        <LoadingState message="Loading workspaces..." />
      ) : !workspaces || workspaces.length === 0 ? (
        <EmptyState
          icon={<FiBox size={24} />}
          heading="No workspaces"
          description="Create a workspace to get started."
        />
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4} mb={8}>
          {workspaces.map((ws) => (
            <Card.Root key={ws.name} {...cardStyles} asChild>
              <Link to={`/repos/${repo}/workspaces/${ws.name}`}>
                <Card.Body p={5}>
                  <HStack justify="space-between" mb={2}>
                    <Text fontSize="sm" fontWeight={600} color="text.primary">
                      {ws.name}
                    </Text>
                    {ws.deployed && (
                      <Badge colorPalette="blue" variant="subtle" size="sm">
                        Deployed
                      </Badge>
                    )}
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
      )}

      {/* Packages */}
      <Text fontSize="lg" fontWeight={600} color="text.primary" mb={4}>
        Packages
      </Text>

      {pkgLoading ? (
        <LoadingState message="Loading packages..." />
      ) : !packages || packages.length === 0 ? (
        <EmptyState
          icon={<FiPackage size={24} />}
          heading="No packages"
          description="Import a package to deploy it to a workspace."
        />
      ) : (
        <VStack gap={2} align="stretch">
          {packages.map((pkg) => (
            <HStack
              key={`${pkg.name}@${pkg.version}`}
              p={3}
              border="1px solid"
              borderColor="border.primary"
              borderRadius="md"
              bg="card.bg"
              gap={3}
            >
              <Text fontWeight={600} color="text.primary" fontSize="sm">
                {pkg.name}
              </Text>
              <Badge variant="outline" size="sm" colorPalette="gray">
                {pkg.version}
              </Badge>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}
