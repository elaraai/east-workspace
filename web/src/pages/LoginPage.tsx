/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Text, VStack, Alert } from '@chakra-ui/react';
import { loadConfig, type PlatformConfig } from '../config';
import { LogoFull } from '../components/Logo';
import { LoadingIcon } from '../components/LoadingIcon';

export function LoginPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: Error) => setError(err.message));
  }, []);

  const handleLogin = useCallback(() => {
    if (!config) return;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.cognitoClientId,
      redirect_uri: config.redirectUri,
      scope: 'openid',
    });

    window.location.href = `https://${config.cognitoDomain}/oauth2/authorize?${params}`;
  }, [config]);

  if (!config && !error) {
    return (
      <Box height="100vh" width="100vw" display="flex" alignItems="center" justifyContent="center" bg="bg.primary">
        <VStack gap={4}>
          <LoadingIcon animate />
          <Text color="text.secondary" fontSize="sm">Loading...</Text>
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      height="100vh"
      width="100vw"
      bg="bg.primary"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={6}
    >
      <Box
        width="100%"
        maxWidth="420px"
        bg="card.bg"
        borderRadius="lg"
        border="1px solid"
        borderColor="border.primary"
        p={8}
        boxShadow="lg"
      >
        <VStack gap={8} align="stretch">
          {/* Logo */}
          <Box display="flex" justifyContent="center" alignItems="center" width="100%">
            <LogoFull height="64px" />
          </Box>

          {/* Error */}
          {error && (
            <Alert.Root status="error" borderRadius="md">
              <Alert.Indicator />
              <Alert.Description fontSize="sm">Configuration error: {error}</Alert.Description>
            </Alert.Root>
          )}

          {/* SSO button */}
          {!error && (
            <Button
              size="lg"
              width="100%"
              variant="outline"
              borderColor="border.primary"
              color="text.primary"
              fontWeight={600}
              _hover={{
                borderColor: 'brand.500',
                bg: 'bg.hover',
              }}
              onClick={handleLogin}
              disabled={!config}
            >
              Login with SSO
            </Button>
          )}
        </VStack>
      </Box>
    </Box>
  );
}
