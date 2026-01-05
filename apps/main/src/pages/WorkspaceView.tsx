/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useParams } from 'react-router-dom';
import { Box, Heading, Text, Button, HStack } from '@chakra-ui/react';
import { getApiClient } from '../api';

interface WorkspaceViewProps {
  tenant: string;
}

export function WorkspaceView({ tenant }: WorkspaceViewProps) {
  const { name } = useParams<{ name: string }>();

  const handleStart = async () => {
    const client = getApiClient(tenant);
    try {
      await client.startDataflow(name!);
      alert('Dataflow started');
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <Box>
      <HStack justify="space-between" mb={6}>
        <Heading size="lg">Workspace: {name}</Heading>
        <Button colorScheme="blue" onClick={handleStart}>
          Start Dataflow
        </Button>
      </HStack>

      <Text color="gray.500">
        TODO: Render UIComponentType datasets from this workspace using east-ui-components.
      </Text>
    </Box>
  );
}
