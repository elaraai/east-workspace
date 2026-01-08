/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Routes, Route } from 'react-router-dom';
import { Box, Container, Heading, Text } from '@chakra-ui/react';
import { WorkspaceList } from './pages/WorkspaceList';
import { WorkspaceView } from './pages/WorkspaceView';

export function App() {
  const tenant = window.__E3_TENANT__;

  if (!tenant) {
    return (
      <Container maxW="container.md" py={10}>
        <Heading mb={4}>e3 Platform</Heading>
        <Text>Please navigate to /repos/{'<tenant>'} to view a tenant.</Text>
      </Container>
    );
  }

  return (
    <Box minH="100vh">
      <Box as="header" bg="gray.800" color="white" py={4}>
        <Container maxW="container.xl">
          <Heading size="md">e3 / {tenant}</Heading>
        </Container>
      </Box>

      <Container maxW="container.xl" py={6}>
        <Routes>
          <Route path="/" element={<WorkspaceList tenant={tenant} />} />
          <Route path="/workspaces/:name/*" element={<WorkspaceView tenant={tenant} />} />
        </Routes>
      </Container>
    </Box>
  );
}
