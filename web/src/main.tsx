/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthError } from '@elaraai/e3-api-client';
import { system } from './theme';
import { ThemeProvider } from './contexts/ThemeProvider';
import { App } from './App';
import { refreshAccessToken, redirectToLogin } from './api';
import { toaster } from './components/Toaster';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof AuthError) {
          if (failureCount === 0) {
            // Trigger token refresh before retry — the refreshed token will be
            // in localStorage when getRequestOptions() is called on the next attempt.
            refreshAccessToken().then((token) => {
              if (!token) redirectToLogin();
            });
            return true;
          }
          // Refresh already attempted and failed, or second failure — give up
          redirectToLogin();
          return false;
        }
        return failureCount < 1;
      },
      retryDelay: (_attemptIndex, error) => {
        // Give the async token refresh time to complete before retrying
        if (error instanceof AuthError) return 2000;
        return 1000;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

// Global error handler for non-auth query errors
queryClient.getQueryCache().config.onError = (_error, query) => {
  if (_error instanceof AuthError) return;
  const queryKey = query.queryKey[0] ?? 'query';
  toaster.create({
    title: `${queryKey} failed`,
    description: _error instanceof Error ? _error.message : String(_error),
    type: 'error',
    duration: 8000,
  });
};

queryClient.getMutationCache().config.onError = (error, _variables, _context, mutation) => {
  const key = mutation.options.mutationKey?.[0] ?? 'mutation';
  toaster.create({
    title: `${key} failed`,
    description: error instanceof Error ? error.message : String(error),
    type: 'error',
    duration: 8000,
  });
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ChakraProvider>
  </React.StrictMode>
);
