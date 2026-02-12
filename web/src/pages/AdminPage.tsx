/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Box, Heading, Text, VStack } from '@chakra-ui/react';

export function AdminPage() {
  return (
    <Box>
      <Heading size="lg" mb={6}>Administration</Heading>

      <VStack gap={6} align="stretch">
        <Box>
          <Heading size="md" mb={2}>Repository Management</Heading>
          <Text color="gray.500">TODO: Create, delete, and configure repositories.</Text>
        </Box>

        <Box>
          <Heading size="md" mb={2}>User Management</Heading>
          <Text color="gray.500">TODO: Manage users and access control.</Text>
        </Box>

        <Box>
          <Heading size="md" mb={2}>Monitoring</Heading>
          <Text color="gray.500">TODO: System health, execution logs, and metrics.</Text>
        </Box>
      </VStack>
    </Box>
  );
}
