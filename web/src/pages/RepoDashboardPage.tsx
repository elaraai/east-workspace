/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Box, Heading, Text, VStack, HStack, Card, Badge } from '@chakra-ui/react';
import { workspaceList, packageList } from '@elaraai/e3-api-client';
import type { WorkspaceInfo, PackageListItem } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';

export function RepoDashboardPage() {
  const { repo } = useParams<{ repo: string }>();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    const opts = getRequestOptions();

    Promise.all([
      workspaceList(API_URL, repo, opts),
      packageList(API_URL, repo, opts),
    ])
      .then(([ws, pkgs]) => {
        setWorkspaces(ws);
        setPackages(pkgs);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repo]);

  if (loading) {
    return <Text>Loading repository...</Text>;
  }

  if (error) {
    return <Text color="red.500">Error: {error}</Text>;
  }

  return (
    <Box>
      <HStack mb={6} gap={3}>
        <Heading size="lg">{repo}</Heading>
        <Badge colorPalette="green">Active</Badge>
      </HStack>

      <Heading size="md" mb={3}>Workspaces</Heading>
      {workspaces.length === 0 ? (
        <Text color="gray.500" mb={6}>No workspaces found.</Text>
      ) : (
        <VStack gap={3} align="stretch" mb={6}>
          {workspaces.map((ws) => (
            <Card.Root key={ws.name} asChild>
              <Link to={`/repos/${repo}/workspaces/${ws.name}`}>
                <Card.Body>
                  <HStack justify="space-between">
                    <Heading size="sm">{ws.name}</Heading>
                    {ws.deployed && <Badge colorPalette="blue">Deployed</Badge>}
                  </HStack>
                  {ws.packageName.type === 'some' && (
                    <Text fontSize="sm" color="gray.500">
                      {ws.packageName.value}@{ws.packageVersion.type === 'some' ? ws.packageVersion.value : '?'}
                    </Text>
                  )}
                </Card.Body>
              </Link>
            </Card.Root>
          ))}
        </VStack>
      )}

      <Heading size="md" mb={3}>Packages</Heading>
      {packages.length === 0 ? (
        <Text color="gray.500">No packages found.</Text>
      ) : (
        <VStack gap={2} align="stretch">
          {packages.map((pkg) => (
            <Text key={`${pkg.name}@${pkg.version}`}>{pkg.name}@{pkg.version}</Text>
          ))}
        </VStack>
      )}
    </Box>
  );
}
