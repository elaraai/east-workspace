/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared error display + React error boundary for East render/compile failures.
 * Used by EastComponent, EastFunction, and EastReactiveComponent to surface
 * errors inline rather than crashing the React tree.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Box, Code, Stack, Text } from "@chakra-ui/react";

export interface EastErrorDisplayProps {
    title: string;
    message: string;
    stack?: string | undefined;
}

export function EastErrorDisplay({ title, message, stack }: EastErrorDisplayProps) {
    return (
        <Alert.Root status="error">
            <Alert.Indicator />
            <Stack gap="2" flex="1">
                <Alert.Title>{title}</Alert.Title>
                <Alert.Description>
                    <Box>
                        <Text fontWeight="medium">{message}</Text>
                        {stack && (
                            <Code
                                display="block"
                                whiteSpace="pre-wrap"
                                fontSize="xs"
                                mt="2"
                                p="2"
                                bg="red.50"
                                _dark={{ bg: "red.900" }}
                                borderRadius="md"
                                maxHeight="200px"
                                overflow="auto"
                            >
                                {stack}
                            </Code>
                        )}
                    </Box>
                </Alert.Description>
            </Stack>
        </Alert.Root>
    );
}

export function toEastErrorInfo(err: unknown): { message: string; stack: string | undefined } {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return { message, stack };
}

/**
 * React error boundary that catches errors thrown during child rendering
 * (e.g. EastChakraComponent throws on malformed data) and displays them
 * via EastErrorDisplay instead of crashing the React tree.
 *
 * The boundary resets when the `resetKey` prop changes — this allows the
 * tree to recover when the underlying render input changes (e.g. state
 * updates that produce valid output again).
 */
interface EastErrorBoundaryProps {
    title: string;
    /** When this changes, the boundary resets and tries to render children again. */
    resetKey: unknown;
    children: ReactNode;
}

interface EastErrorBoundaryState {
    error: unknown;
}

export class EastErrorBoundary extends Component<EastErrorBoundaryProps, EastErrorBoundaryState> {
    state: EastErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: unknown): EastErrorBoundaryState {
        return { error };
    }

    override componentDidUpdate(prev: EastErrorBoundaryProps): void {
        if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
            this.setState({ error: null });
        }
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
        console.error("[EastErrorBoundary]", error, info);
    }

    override render() {
        if (this.state.error !== null) {
            const { message, stack } = toEastErrorInfo(this.state.error);
            return <EastErrorDisplay title={this.props.title} message={message} stack={stack} />;
        }
        return this.props.children;
    }
}
