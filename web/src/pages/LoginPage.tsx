/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useState } from 'react';
import { Box, Button, Container, Heading, Text, VStack } from '@chakra-ui/react';
import { loadConfig, type PlatformConfig } from '../config';

export function LoginPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: Error) => setError(err.message));
  }, []);

  const handleLogin = () => {
    if (!config) return;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.cognitoClientId,
      redirect_uri: config.redirectUri,
      scope: 'openid',
    });

    window.location.href = `https://${config.cognitoDomain}/oauth2/authorize?${params}`;
  };

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center">
      <Container maxW="sm">
        <VStack gap={6}>
          <Heading size="2xl">e3 Cloud</Heading>
          <Text color="gray.500">Sign in to manage your repositories and workspaces.</Text>
          {error ? (
            <Text color="red.500">Configuration error: {error}</Text>
          ) : (
            <Button colorPalette="blue" size="lg" width="full" onClick={handleLogin} disabled={!config}>
              Login with SSO
            </Button>
          )}
        </VStack>
      </Container>
    </Box>
  );
}
