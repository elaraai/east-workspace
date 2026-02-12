/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Outlet, Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Container, Heading, HStack, Button } from '@chakra-ui/react';

export function PlatformLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('e3_token');
    navigate('/login');
  };

  return (
    <Box minH="100vh">
      <Box as="header" bg="gray.800" color="white" py={4}>
        <Container maxW="container.xl">
          <HStack justify="space-between">
            <HStack gap={6}>
              <Heading size="md" asChild>
                <RouterLink to="/repos">e3</RouterLink>
              </Heading>
              <Button variant="ghost" color="white" size="sm" asChild>
                <RouterLink to="/repos">Repositories</RouterLink>
              </Button>
              <Button variant="ghost" color="white" size="sm" asChild>
                <RouterLink to="/admin">Admin</RouterLink>
              </Button>
            </HStack>
            <Button variant="outline" color="white" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </HStack>
        </Container>
      </Box>

      <Container maxW="container.xl" py={6}>
        <Outlet />
      </Container>
    </Box>
  );
}
