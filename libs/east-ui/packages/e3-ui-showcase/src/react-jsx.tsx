/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * JSX authoring demo — the same east-ui trees the other showcases build with
 * `Box.Root([...])`, written as `.tsx` JSX inside a `ui()` task body.
 *
 * Proves `<Box>` desugars to east-ui IR and round-trips through the renderer:
 * each `ui()` task below produces a `UIComponentType` value, identical to what
 * the factory API yields.
 *
 * No per-file pragma is needed — `tsconfig.json` sets
 * `jsxImportSource: "@elaraai/e3-ui"`, so `.tsx` files in this package use the
 * east-ui JSX runtime. The `ui()` task factory and the JSX tags come from the
 * single `@elaraai/e3-ui/ui` import; the body is a normal
 * `East.function([], UIComponentType, …)` (inputs `[]` when there are none).
 *
 * Build with `make build`, then emit a zip with `node dist/src/react-jsx.js`.
 */

import e3 from '@elaraai/e3';
import type { Runner } from '@elaraai/e3';
import { East } from '@elaraai/east';
import { UIComponentType } from '@elaraai/east-ui';
import { ui, Box, VStack, HStack, Text, Heading, Button } from '@elaraai/e3-ui/ui';
import pkgInfo from '../package.json' with { type: 'json' };
import { DEFAULT_OUT_DIR } from './utils.js';

// UI tasks only need to produce a UIComponentType value, so the pure-Node
// east-node runtime runs them without the native east-c toolchain.
const RUNNER: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] };

// A simple panel: heading + body + a button row. Flat style props throughout.
const hello = ui('hello', [], East.function([], UIComponentType, (_$) => (
    <VStack gap="4" padding="4" background="gray.50" borderRadius="md">
        <Heading>Hello from JSX</Heading>
        <Text color="fg.muted">This whole tree is east-ui IR — no React at runtime.</Text>
        <HStack gap="2">
            <Button variant="solid" colorPalette="blue">Save</Button>
            <Button variant="outline" colorPalette="gray">Cancel</Button>
        </HStack>
    </VStack>
)), { runner: RUNNER });

// Nested containers compose exactly like nested factory calls.
const card = ui('card', [], East.function([], UIComponentType, (_$) => (
    <Box padding="4" background="white" borderWidth="1px" borderRadius="lg">
        <VStack gap="2">
            <Heading>Card title</Heading>
            <Text>Boxes and stacks nest just like the factory API does.</Text>
        </VStack>
    </Box>
)), { runner: RUNNER });

const pkg = e3.package('east-ui-showcase-react-jsx', pkgInfo.version, hello, card);
await e3.export(pkg, `${DEFAULT_OUT_DIR}/react-jsx.zip`);

export default pkg;
