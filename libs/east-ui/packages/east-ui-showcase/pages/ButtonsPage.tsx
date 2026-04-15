/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { SimpleGrid } from "@chakra-ui/react";
import { ExampleCard } from "../components/ExampleCard";
import * as examples from "@elaraai/east-ui/examples/buttons";

const entries = Object.entries(examples) as [string, typeof examples[keyof typeof examples]][];

export function ButtonsPage() {
    return (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
            {entries.map(([name, ex]) => (
                <ExampleCard key={name} name={name} example={ex as any} />
            ))}
        </SimpleGrid>
    );
}
