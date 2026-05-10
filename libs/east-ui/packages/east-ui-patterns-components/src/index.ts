/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-patterns-components` — React (Chakra v3) renderers for
 * the decision-quality patterns declared in `@elaraai/east-ui-patterns`.
 *
 * @remarks
 * Each pattern's view module side-effect-registers its renderer against the
 * pattern's `EastUI.component` carrier at module load. Importing this
 * package once (e.g. at app bootstrap) wires up every renderer.
 *
 * @example
 * ```tsx
 * import "@elaraai/east-ui-patterns-components";        // side-effect registration
 * import { ChakraProvider } from "@chakra-ui/react";
 * import { system, EastChakraComponent } from "@elaraai/east-ui-components";
 * import { Decision } from "@elaraai/east-ui-patterns";
 *
 * <ChakraProvider value={system}>
 *     <EastChakraComponent value={Decision.Brief.Root({ ... })} />
 * </ChakraProvider>
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Side-effect imports — register every Chakra renderer against its
// `EastUI.component` carrier on module load. Keeping these as explicit
// imports (rather than relying on the package.json `sideEffects` field) makes
// registration bulletproof under bundlers that ignore or partially honour
// that field.
// =============================================================================
import "./decision/brief/index.js"; // → implementUIComponent(Decision.Brief.Component, EastChakraDecisionBrief)

// =============================================================================
// Public component re-exports — for callers that want the React component
// directly (testing, custom shells) instead of going through the dispatcher.
// =============================================================================
export {
    EastChakraDecisionBrief,
    type EastChakraDecisionBriefProps,
} from "./decision/brief/index.js";
