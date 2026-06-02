/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * App-level error surface for the showcase.
 *
 * Two layers, because a showcase crash can happen either while React is
 * rendering an example OR while the module graph is still being evaluated
 * (the catalog builds every example's IR eagerly at load — a bad IR there
 * throws before React ever mounts):
 *
 *   - {@link AppErrorBoundary} — a render-phase boundary around the app tree.
 *   - {@link installGlobalErrorHandlers} — `window` `error` / `unhandledrejection`
 *     listeners that mount the same alert into `#root` when the app never got
 *     the chance to. Install this FIRST (before the catalog import evaluates)
 *     so the listeners are live when a load-time throw fires.
 *
 * Both render {@link ErrorAlert} — the same Chakra `Alert` the component
 * library uses, with a one-click "Copy details" button so the full
 * message + stack can be pasted straight into a bug report.
 *
 * @packageDocumentation
 */

import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Box, Button, ChakraProvider, HStack } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";

/** A normalised caught error — title + message + stack, all display-ready. */
export interface CaughtError {
    title: string;
    message: string;
    stack: string;
}

function toCaught(title: string, err: unknown, extra?: string): CaughtError {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    return { title, message: e.message, stack: `${e.stack ?? e.message}${extra ?? ""}` };
}

/** The error card itself — the component-library Alert + a copy button. */
export function ErrorAlert({ error, onDismiss }: { error: CaughtError; onDismiss?: () => void }) {
    const [copied, setCopied] = useState(false);
    const details = `${error.title}\n${error.message}\n\n${error.stack}`.trim();
    const copy = () => {
        void navigator.clipboard?.writeText(details);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };
    return (
        <Box maxW="920px" mx="auto" my="8" px="4">
            <Alert.Root status="error" variant="subtle" borderRadius="md" alignItems="flex-start">
                <Alert.Indicator />
                <Alert.Content gap="3" width="full" minW={0}>
                    <Alert.Title fontSize="sm">{error.title}</Alert.Title>
                    <Alert.Description width="full" minW={0}>
                        <Box fontWeight="medium" mb="2">{error.message}</Box>
                        <Box
                            as="pre"
                            fontFamily="mono"
                            fontSize="11px"
                            lineHeight="1.5"
                            whiteSpace="pre-wrap"
                            overflowX="auto"
                            maxH="340px"
                            overflowY="auto"
                            bg="bg.muted"
                            color="fg.muted"
                            p="3"
                            borderRadius="sm"
                        >
                            {error.stack}
                        </Box>
                    </Alert.Description>
                    <HStack gap="2">
                        <Button size="xs" colorPalette="red" onClick={copy}>
                            {copied ? "Copied!" : "Copy details"}
                        </Button>
                        {onDismiss && (
                            <Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>
                        )}
                    </HStack>
                </Alert.Content>
            </Alert.Root>
        </Box>
    );
}

/** Render-phase boundary — catches any error thrown while rendering the app. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: CaughtError | null }> {
    override state: { error: CaughtError | null } = { error: null };

    static getDerivedStateFromError(err: unknown): { error: CaughtError } {
        return { error: toCaught("Showcase render error", err) };
    }

    override componentDidCatch(err: unknown, info: ErrorInfo) {
        this.setState({ error: toCaught("Showcase render error", err, `\n\nComponent stack:${info.componentStack ?? ""}`) });
    }

    override render() {
        if (this.state.error) {
            return <ErrorAlert error={this.state.error} onDismiss={() => this.setState({ error: null })} />;
        }
        return this.props.children;
    }
}

// Browser noise that isn't an actual app failure.
const IGNORE = /ResizeObserver loop|Non-Error promise rejection captured/i;
let shown = false;

function showGlobal(error: CaughtError) {
    if (shown) return;
    shown = true;
    const host = document.getElementById("root") ?? document.body;
    const container = document.createElement("div");
    host.prepend(container);
    createRoot(container).render(
        <ChakraProvider value={system}>
            <ErrorAlert error={error} />
        </ChakraProvider>,
    );
}

/**
 * Register global handlers that surface a load-time crash (before React
 * mounts) as the same alert. Call this BEFORE the catalog import evaluates.
 */
export function installGlobalErrorHandlers(): void {
    window.addEventListener("error", (e: ErrorEvent) => {
        const message = e.message || (e.error instanceof Error ? e.error.message : "Unknown error");
        if (IGNORE.test(message)) return;
        showGlobal(toCaught("Showcase failed to load", e.error ?? message));
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
        const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
        if (IGNORE.test(message)) return;
        showGlobal(toCaught("Showcase unhandled rejection", e.reason));
    });
}
