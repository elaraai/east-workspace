/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import * as ts from "typescript";
import { ESLintUtils } from "@typescript-eslint/utils";
import { runEastRules, type EastRulesOptions } from "@elaraai/east-diagnostics";

export type Options = [EastRulesOptions];
export type MessageIds = "east";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/elaraai/east/tree/main/libs/eslint-plugin-east#${name}`,
);

// One rule that runs the whole east-diagnostics set against the file's TS
// program (obtained via typescript-eslint parser services) and reports each
// diagnostic. Requires type-aware linting (parserOptions.project / projectService).
export const eastRules = createRule<Options, MessageIds>({
  name: "east-rules",
  meta: {
    type: "problem",
    docs: {
      description:
        "East-specific idiom diagnostics: prefer some()/none, no redundant casts, no unexecuted East expressions, etc.",
    },
    messages: { east: "{{message}}" },
    schema: [
      {
        type: "object",
        properties: {
          disabled: { type: "array", items: { type: "string" } },
          preferExplicitEastType: {
            type: "object",
            properties: { mode: { type: "string", enum: ["under-determined", "all-raw-values"] } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [options]) {
    return {
      "Program:exit"() {
        const services = ESLintUtils.getParserServices(context);
        const program = services.program;
        const sourceFile = program.getSourceFile(context.filename);
        if (sourceFile === undefined) return;

        const diagnostics = runEastRules(ts, program, sourceFile, program.getTypeChecker(), options);
        for (const d of diagnostics) {
          const start = sourceFile.getLineAndCharacterOfPosition(d.start);
          const end = sourceFile.getLineAndCharacterOfPosition(d.start + d.length);
          context.report({
            loc: {
              start: { line: start.line + 1, column: start.character },
              end: { line: end.line + 1, column: end.character },
            },
            messageId: "east",
            data: { message: `[${d.ruleName}] ${d.messageText}` },
          });
        }
      },
    };
  },
});