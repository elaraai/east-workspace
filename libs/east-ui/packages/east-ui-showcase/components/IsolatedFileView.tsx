/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { Box, Container, Stack, Text } from "@chakra-ui/react";
import { EastFunction, type EastFunctionProps } from "@elaraai/east-ui-components";
import type { CatalogEntry } from "../catalog";

/**
 * Isolated-file route — when the URL carries `?file=<pathKey>` (e.g.
 * `?file=buttons/button`), render every example from that single
 * `*.examples.ts` file as a vertical stack, full-bleed. Used by the
 * Playwright snapshot driver (`scripts/snapshot-examples.ts`) to capture
 * one HTML file per component family for offline visual inspection.
 */
export function IsolatedFileView({ entries }: { entries: readonly CatalogEntry[] }) {
    const { pathKey, category } = entries[0];
    return (
        <Box padding="6" bg="bg.canvas" minH="100vh">
            <Container maxW="1100px" px="0">
                <Text textStyle="eyebrow.mono" mb="2">§ {pathKey}</Text>
                <Text
                    fontFamily="heading"
                    fontSize="32px"
                    fontWeight="bold"
                    letterSpacing="-0.02em"
                    lineHeight="1.15"
                    mb="6"
                >
                    {category} — {pathKey}
                </Text>
                <Stack gap="6">
                    {entries.map(example => (
                        <Box key={example.name} display="flex" flexDirection="column" gap="2">
                            <Text textStyle="mono.label">{example.name}</Text>
                            <Text fontSize="13px" color="fg.muted" lineHeight="1.45" maxW="70ch">
                                {example.description}
                            </Text>
                            <Box layerStyle="frame" p="6" bg="bg.surface" minH="160px">
                                {example.tier === "live" ? (
                                    <EastFunction
                                        ir={example.fn.toIR() as EastFunctionProps["ir"]}
                                        storageKey={`snapshot-${pathKey}-${example.name}`}
                                    />
                                ) : (
                                    <Box
                                        as="pre"
                                        fontFamily="mono"
                                        fontSize="12px"
                                        whiteSpace="pre-wrap"
                                        color="fg"
                                    >
                                        {example.source.raw}
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    ))}
                </Stack>
            </Container>
        </Box>
    );
}
