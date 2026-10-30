/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { Rule } from "eslint";
import type ts from "typescript";

/** A place a Chakra style prop is given a value composed from numbers: its span in the file, and the property. */
export interface ComposedPlace {
    readonly start: number;
    readonly end: number;
    readonly prop: string;
}

/**
 * The places in a source file where a Chakra style prop is given a value composed from numbers.
 *
 * @param sourceFile - The file, from a program with its types
 * @param checker - The program's type checker
 * @returns Each place's span in the file and the property it sets, in the file's order
 */
export function composedStyleProps(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ComposedPlace[];

/** The rule `east-ui/inline-places`. */
declare const rule: Rule.RuleModule;
export default rule;
