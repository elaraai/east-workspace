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
    /**
     * The component-tree region (the rendering Reactive's storage key) the error
     * occurred in. Surfaced so a render failure points at *where* in the tree it
     * threw — the East interpreter stack alone names only its own internals.
     */
    context?: string | undefined;
}

/**
 * Restate a known-cryptic East runtime/serialization message as its general cause.
 *
 * The interpreter's own errors (e.g. "Cannot serialize function: no IR attached")
 * name an internal failure, not its class. This maps the ones we recognise to a
 * short, general cause — what kind of value failed — without guessing which specific
 * prop produced it; the `Region` (storage key) is what points at *where*.
 *
 * @param message - the raw error message
 * @returns a one-line general cause, or undefined when the message is not recognised
 */
export function explainEastError(message: string): string | undefined {
    if (message.includes("no IR attached")) {
        return (
            "A raw JavaScript function reached the value serializer where an East function " +
            "(one carrying compiled IR) was expected — typically a plain arrow passed to a prop that " +
            "must be an East function. The Region below identifies the rendering subtree."
        );
    }
    return undefined;
}

export function EastErrorDisplay({ title, message, stack, context }: EastErrorDisplayProps) {
    const hint = explainEastError(message);
    return (
        <Alert.Root status="error">
            <Alert.Indicator />
            <Stack gap="2" flex="1">
                <Alert.Title>{title}</Alert.Title>
                <Alert.Description>
                    <Box>
                        <Stack gap="1">
                            <Text fontWeight="medium">{message}</Text>
                            {hint && <Text>{hint}</Text>}
                            {context && <Text>Region: {context}</Text>}
                        </Stack>
                        {stack && (
                            <Code
                                display="block"
                                whiteSpace="pre-wrap"
                                fontSize="xs"
                                mt="2"
                                p="2"
                                layerStyle="banner.error"
                                borderRadius="sm"
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
    /** The component-tree region (storage key) surfaced on the error display. */
    context?: string | undefined;
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
            return <EastErrorDisplay title={this.props.title} message={message} stack={stack} context={this.props.context} />;
        }
        return this.props.children;
    }
}
