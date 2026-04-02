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
import { installAuthInterceptor, redirectToLogin } from './api';
import { toaster } from './components/Toaster';

// Intercept 401s at the fetch layer — refresh token and retry before React Query sees the error
installAuthInterceptor();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof AuthError) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

// Global error handlers — AuthError here means the fetch interceptor already tried refreshing and failed
queryClient.getQueryCache().config.onError = (error, query) => {
  if (error instanceof AuthError) return redirectToLogin();
  const queryKey = query.queryKey[0] ?? 'query';
  toaster.create({
    title: `${queryKey} failed`,
    description: error instanceof Error ? error.message : String(error),
    type: 'error',
    duration: 8000,
  });
};

queryClient.getMutationCache().config.onError = (error, _variables, _context, mutation) => {
  if (error instanceof AuthError) return redirectToLogin();
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
