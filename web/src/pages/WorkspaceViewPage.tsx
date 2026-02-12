/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Link, useParams } from 'react-router-dom';
import { Box, Heading, Text, Button, HStack } from '@chakra-ui/react';
import { dataflowStart } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';

export function WorkspaceViewPage() {
  const { repo, workspace } = useParams<{ repo: string; workspace: string }>();

  const handleStart = async () => {
    try {
      await dataflowStart(API_URL, repo!, workspace!, undefined, getRequestOptions());
      alert('Dataflow started');
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <Box>
      <Text fontSize="sm" color="gray.500" mb={2}>
        <Link to={`/repos/${repo}`}>{repo}</Link> / {workspace}
      </Text>

      <HStack justify="space-between" mb={6}>
        <Heading size="lg">{workspace}</Heading>
        <Button colorPalette="blue" onClick={handleStart}>
          Start Dataflow
        </Button>
      </HStack>

      <Text color="gray.500">
        TODO: Render UIComponentType datasets from this workspace using east-ui-components.
      </Text>
    </Box>
  );
}
