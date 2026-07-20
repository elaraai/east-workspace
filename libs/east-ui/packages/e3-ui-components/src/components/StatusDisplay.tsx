/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box, Text, VStack, Code, Clipboard, IconButton } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
import { LoadingIcon } from '@elaraai/east-ui-components';

type StatusVariant = 'error' | 'warning' | 'info' | 'loading';

export interface StatusDisplayProps {
    variant: StatusVariant;
    title: string;
    message?: string;
    /** Optional code/details block to show below the message */
    details?: string;
}

const variantStyles: Record<StatusVariant, {
    bg: string;
    titleColor: string;
    messageColor: string;
    detailsBg: string;
    detailsColor: string;
}> = {
    // Mode-aware semantic tokens (the raw `red.50` / `gray.50` washes rendered
    // as bright light boxes in dark mode — #362).
    error: {
        bg: 'bg.danger.subtle',
        titleColor: 'fg.danger',
        messageColor: 'fg.muted',
        detailsBg: 'bg.muted',
        detailsColor: 'fg.default',
    },
    warning: {
        bg: 'bg.warning.subtle',
        titleColor: 'fg.warning',
        messageColor: 'fg.muted',
        detailsBg: 'bg.muted',
        detailsColor: 'fg.default',
    },
    info: {
        bg: 'transparent',
        titleColor: 'fg.muted',
        messageColor: 'fg.subtle',
        detailsBg: 'bg.muted',
        detailsColor: 'fg.default',
    },
    loading: {
        bg: 'transparent',
        titleColor: 'fg.muted',
        messageColor: 'fg.subtle',
        detailsBg: 'bg.muted',
        detailsColor: 'fg.default',
    },
};

/**
 * Reusable component for displaying status messages (errors, warnings, info, loading).
 */
export function StatusDisplay({ variant, title, message, details }: StatusDisplayProps) {
    const styles = variantStyles[variant];

    // Centered layout for info and loading states
    if (variant === 'info' || variant === 'loading') {
        return (
            <Box
                data-status={variant}
                height="100%"
                width="100%"
                display="flex"
                alignItems="center"
                justifyContent="center"
                bg={styles.bg}
            >
                <VStack gap={2}>
                    {variant === 'loading' && <LoadingIcon animate size="52px" />}
                    <Text color={styles.titleColor} fontSize={variant === 'loading' ? 'sm' : 'lg'}>
                        {title}
                    </Text>
                    {message && (
                        <Text color={styles.messageColor} fontSize="sm">
                            {message}
                        </Text>
                    )}
                    {details && (
                        <Box position="relative" mt={2} width="100%">
                            <Code
                                display="block"
                                whiteSpace="pre-wrap"
                                p={4}
                                pr={10}
                                bg={styles.detailsBg}
                                color={styles.detailsColor}
                                borderRadius="md"
                                fontSize="sm"
                                overflow="auto"
                                maxHeight="300px"
                            >
                                {details}
                            </Code>
                            <Clipboard.Root value={details} position="absolute" top={1} right={1}>
                                <Clipboard.Trigger asChild>
                                    <IconButton size="xs" variant="ghost" aria-label="Copy error details">
                                        <Clipboard.Indicator copied={<FontAwesomeIcon icon={faCheck} />}>
                                            <FontAwesomeIcon icon={faCopy} />
                                        </Clipboard.Indicator>
                                    </IconButton>
                                </Clipboard.Trigger>
                            </Clipboard.Root>
                        </Box>
                    )}
                </VStack>
            </Box>
        );
    }

    // Block layout for error and warning states
    return (
        <Box data-status={variant} p={6} bg={styles.bg} height="100%" width="100%">
            <Text fontSize="lg" fontWeight="bold" color={styles.titleColor} mb={4}>
                {title}
            </Text>
            {message && (
                <Text color={styles.messageColor} mb={details ? 4 : 0}>
                    {message}
                </Text>
            )}
            {details && (
                <Box position="relative">
                    <Code
                        display="block"
                        whiteSpace="pre-wrap"
                        p={4}
                        pr={10}
                        bg={styles.detailsBg}
                        color={styles.detailsColor}
                        borderRadius="md"
                        fontSize="sm"
                        overflow="auto"
                        maxHeight="300px"
                    >
                        {details}
                    </Code>
                    <Clipboard.Root value={details} position="absolute" top={1} right={1}>
                        <Clipboard.Trigger asChild>
                            <IconButton size="xs" variant="ghost" aria-label="Copy error details">
                                <Clipboard.Indicator copied={<FontAwesomeIcon icon={faCheck} />}>
                                    <FontAwesomeIcon icon={faCopy} />
                                </Clipboard.Indicator>
                            </IconButton>
                        </Clipboard.Trigger>
                    </Clipboard.Root>
                </Box>
            )}
        </Box>
    );
}
