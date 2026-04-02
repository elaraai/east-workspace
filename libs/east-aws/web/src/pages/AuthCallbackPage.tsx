/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Text, VStack } from '@chakra-ui/react';
import { loadConfig } from '../config';
import { LoadingIcon } from '../components/LoadingIcon';

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received.');
      return;
    }

    loadConfig()
      .then(async (config) => {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.cognitoClientId,
          redirect_uri: config.redirectUri,
          code,
        });

        const res = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Token exchange failed: ${res.status} ${text}`);
        }

        const data = await res.json();
        localStorage.setItem('e3_token', data.access_token);
        if (data.refresh_token) {
          localStorage.setItem('e3_refresh_token', data.refresh_token);
        }
        navigate('/repos', { replace: true });
      })
      .catch((err: Error) => setError(err.message));
  }, [searchParams, navigate]);

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="bg.primary">
      <VStack gap={4}>
        {error ? (
          <Text color="red.500" fontSize="sm">
            Error: {error}
          </Text>
        ) : (
          <>
            <LoadingIcon animate />
            <Text color="text.secondary" fontSize="sm">
              Signing in...
            </Text>
          </>
        )}
      </VStack>
    </Box>
  );
}
