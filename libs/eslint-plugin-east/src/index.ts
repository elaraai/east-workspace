/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { ESLint, Linter, Rule } from "eslint";
import { hostValueRuleNames } from "@elaraai/east-diagnostics";
import { eastRules } from "./rule.js";

/**
 * The rules over host code that builds or holds decoded East values — pass as
 * `"east/east-rules": ["error", { only: hostValueRules }]` where the IR-authoring
 * rules do not apply (a UI library's source and tests, whose factories and handle
 * builders build East programs rather than being ones).
 */
export const hostValueRules: readonly string[] = hostValueRuleNames;

// typescript-eslint's RuleModule is structurally an ESLint rule; the cast bridges
// the two slightly different RuleModule types.
const rules: Record<string, Rule.RuleModule> = {
  "east-rules": eastRules as unknown as Rule.RuleModule,
};

const plugin: ESLint.Plugin = {
  meta: { name: "@elaraai/eslint-plugin-east", version: "1.0.4" },
  rules,
};

plugin.configs = {
  recommended: {
    plugins: { east: plugin },
    rules: { "east/east-rules": "warn" },
  } satisfies Linter.Config,
};

export default plugin;