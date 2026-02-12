/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { ReactNode } from 'react';
import { Box, VStack, Text, Button, Alert, HStack } from '@chakra-ui/react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { LoadingIcon } from './LoadingIcon';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <VStack gap={4} align="center" justify="center" py={16}>
      <LoadingIcon animate />
      <Text color="text.secondary" fontSize="sm">
        {message}
      </Text>
    </VStack>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  heading: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, heading, description, action }: EmptyStateProps) {
  return (
    <VStack gap={4} align="center" justify="center" py={16}>
      {icon && (
        <Box color="text.tertiary" fontSize="2xl">
          {icon}
        </Box>
      )}
      <VStack gap={1} align="center">
        <Text fontSize="md" fontWeight={600} color="text.primary">
          {heading}
        </Text>
        {description && (
          <Text fontSize="sm" color="text.secondary" textAlign="center" maxW="400px">
            {description}
          </Text>
        )}
      </VStack>
      {action && (
        <Button size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </VStack>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  error,
  onRetry,
}: ErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;

  return (
    <VStack gap={4} align="center" justify="center" py={16}>
      <Box p={3} borderRadius="full" bg="status.error.bg" border="2px solid" borderColor="status.error.border">
        <Box as={FiAlertTriangle} boxSize={6} color="red.500" />
      </Box>
      <VStack gap={1} align="center">
        <Text fontSize="md" fontWeight={600} color="text.primary">
          {title}
        </Text>
        {description && (
          <Text fontSize="sm" color="text.secondary" textAlign="center" maxW="400px">
            {description}
          </Text>
        )}
      </VStack>
      {errorMessage && (
        <Alert.Root status="error" variant="subtle" maxW="500px" fontSize="sm">
          <Alert.Indicator />
          <Alert.Description fontSize="sm">{errorMessage}</Alert.Description>
        </Alert.Root>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <HStack gap={2} align="center">
            <FiRefreshCw size={14} />
            <Text fontSize="sm">Retry</Text>
          </HStack>
        </Button>
      )}
    </VStack>
  );
}
