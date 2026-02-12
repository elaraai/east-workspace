/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Box, Button, Container, Heading, Text, VStack } from '@chakra-ui/react';

export function LoginPage() {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI;

  const handleLogin = () => {
    if (!domain || !clientId || !redirectUri) {
      alert('Cognito environment variables are not configured. Set VITE_COGNITO_DOMAIN, VITE_COGNITO_CLIENT_ID, and VITE_COGNITO_REDIRECT_URI.');
      return;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid',
    });

    window.location.href = `https://${domain}/oauth2/authorize?${params}`;
  };

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center">
      <Container maxW="sm">
        <VStack gap={6}>
          <Heading size="2xl">e3 Platform</Heading>
          <Text color="gray.500">Sign in to manage your repositories and workspaces.</Text>
          <Button colorPalette="blue" size="lg" width="full" onClick={handleLogin}>
            Login with SSO
          </Button>
        </VStack>
      </Container>
    </Box>
  );
}
