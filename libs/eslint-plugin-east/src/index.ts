/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { ESLint, Linter, Rule } from "eslint";
import { eastRules } from "./rule.js";

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