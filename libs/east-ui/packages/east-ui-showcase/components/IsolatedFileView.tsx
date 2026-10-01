/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { Box, Container, Stack, Text } from "@chakra-ui/react";
import { EastFunction } from "@elaraai/east-ui-components";
import type { CatalogEntry } from "../catalog";
import { SECTION_E3 } from "../showcase-config";
import { exampleIr } from "./example-ir";
import { E3Gate } from "./ShowcaseE3";

/**
 * Isolated-file route — when the URL carries `?file=<pathKey>` (e.g.
 * `?file=buttons/button`), render every example from that single
 * `*.examples.ts` file as a vertical stack, full-bleed, so a capture of the
 * page holds one component family. An e3 file's examples render through the
 * gate that starts the e3 the page runs (#849), as they do in the doc list.
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
                                    example.section === SECTION_E3 ? (
                                        <E3Gate entry={example}>
                                            <EastFunction ir={exampleIr(example)} storageKey={`snapshot-${pathKey}-${example.name}`} />
                                        </E3Gate>
                                    ) : (
                                        <EastFunction ir={exampleIr(example)} storageKey={`snapshot-${pathKey}-${example.name}`} />
                                    )
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
