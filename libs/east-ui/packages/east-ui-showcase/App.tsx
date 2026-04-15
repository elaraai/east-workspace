/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useState, useMemo } from "react";
import {
    Box,
    Button,
    Container,
    Flex,
    Heading,
    Input,
    InputGroup,
    Kbd,
    SimpleGrid,
    Stack,
    Text,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { UIStoreProvider, UIStore, OverlayManagerProvider } from "@elaraai/east-ui-components";
import { ElaraLogo } from "./components/ElaraLogo";
import { ExampleCard } from "./components/ExampleCard";
import * as buttonExamples from "@elaraai/east-ui/examples/buttons";

// Build catalog from examples
interface CatalogEntry {
    name: string;
    category: string;
    keywords: string[];
    description: string;
    fn: any;
    inputs: any[];
}

function buildCatalog(): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    for (const [name, ex] of Object.entries(buttonExamples)) {
        const e = ex as any;
        entries.push({ name, category: "Buttons", keywords: e.keywords, description: e.description, fn: e.fn, inputs: e.inputs });
    }
    // Add more categories as examples are migrated to State.bind:
    // import * as formExamples from "@elaraai/east-ui/examples/forms";
    // for (const [name, ex] of Object.entries(formExamples)) { ... }
    return entries;
}

const catalog = buildCatalog();
const categories = [...new Set(catalog.map(e => e.category))];
const store = new UIStore();

export function App() {
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const filtered = useMemo(() => {
        let results = catalog;
        if (selectedCategory) {
            results = results.filter(e => e.category === selectedCategory);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            results = results.filter(e =>
                e.description.toLowerCase().includes(q) ||
                e.keywords.some(k => k.toLowerCase().includes(q)) ||
                e.name.toLowerCase().includes(q)
            );
        }
        return results;
    }, [search, selectedCategory]);

    return (
        <UIStoreProvider store={store}>
            <OverlayManagerProvider>
                <Flex minH="100vh" bg="gray.50" _dark={{ bg: "gray.900" }}>
                    {/* Sidebar */}
                    <Box
                        w="220px"
                        minH="100vh"
                        bg="white"
                        _dark={{ bg: "gray.800" }}
                        borderRightWidth="1px"
                        borderColor="gray.200"
                        py="6"
                        px="4"
                        flexShrink={0}
                    >
                        <Flex align="center" gap="2" mb="6">
                            <ElaraLogo height="24px" />
                            <Text fontSize="sm" fontWeight="semibold">East UI</Text>
                        </Flex>

                        <Stack gap="1">
                            <Button
                                variant={!selectedCategory ? "subtle" : "ghost"}
                                colorPalette={!selectedCategory ? "blue" : undefined}
                                justifyContent="flex-start"
                                w="full"
                                size="sm"
                                onClick={() => setSelectedCategory(null)}
                            >
                                All ({catalog.length})
                            </Button>
                            {categories.map(cat => {
                                const count = catalog.filter(e => e.category === cat).length;
                                const isActive = selectedCategory === cat;
                                return (
                                    <Button
                                        key={cat}
                                        variant={isActive ? "subtle" : "ghost"}
                                        colorPalette={isActive ? "blue" : undefined}
                                        justifyContent="flex-start"
                                        w="full"
                                        size="sm"
                                        onClick={() => setSelectedCategory(cat)}
                                    >
                                        {cat} ({count})
                                    </Button>
                                );
                            })}
                        </Stack>
                    </Box>

                    {/* Main content */}
                    <Box flex="1" p="6">
                        <Container maxW="container.xl">
                            {/* Header + Search */}
                            <Flex align="center" justify="space-between" mb="6">
                                <Heading size="lg">
                                    {selectedCategory ?? "All Components"}
                                </Heading>
                                <InputGroup
                                    maxW="300px"
                                    startElement={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                                    endElement={<Kbd>⌘K</Kbd>}
                                >
                                    <Input
                                        placeholder="Search examples..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        bg="white"
                                        _dark={{ bg: "gray.800" }}
                                    />
                                </InputGroup>
                            </Flex>

                            {/* Examples grid */}
                            {filtered.length === 0 ? (
                                <Text color="gray.400">No examples match your search.</Text>
                            ) : (
                                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
                                    {filtered.map(entry => (
                                        <ExampleCard
                                            key={entry.name}
                                            name={entry.name}
                                            example={entry}
                                        />
                                    ))}
                                </SimpleGrid>
                            )}
                        </Container>
                    </Box>
                </Flex>
            </OverlayManagerProvider>
        </UIStoreProvider>
    );
}
