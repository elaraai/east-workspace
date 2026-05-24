/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Self-hosted brand fonts — side-effect entry point.
 *
 * App entry points (e.g. `main.tsx`) import this module for its side
 * effects to register `@font-face` declarations for DM Sans, Inter Tight,
 * and JetBrains Mono against the bundled .woff2 files shipped by the
 * `@fontsource-variable/*` packages.
 *
 * @example
 * ```ts
 * import "@elaraai/east-ui-components/fonts";
 * import { ChakraProvider } from "@chakra-ui/react";
 * import { system } from "@elaraai/east-ui-components";
 *
 * createRoot(document.getElementById("root")!).render(
 *     <ChakraProvider value={system}>
 *         <App />
 *     </ChakraProvider>
 * );
 * ```
 *
 * @remarks
 * Why a separate subpath?
 *  - Node test runners (`node --import tsx --test`) lack a CSS loader and
 *    cannot resolve `.css` files; importing this from `src/index.ts` would
 *    break every transitive test consumer.
 *  - VS Code extension webviews CSP `font-src ${cspSource}` blocks the
 *    Google Fonts CDN, so self-hosting is the only viable option for the
 *    extension. This module is the canonical way to register them.
 *
 * The library build externalises `@fontsource-variable/*` (see
 * `vite.config.ts`) so each consuming app's Vite/Rollup resolves the
 * .woff2 payloads in its own asset pipeline.
 *
 * @packageDocumentation
 */

import "@fontsource-variable/dm-sans";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
