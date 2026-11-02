/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lint rule `east-ui/inline-places` (#1440): a Chakra style prop given a
 * value composed from numbers as the component renders is refused, and the
 * value goes through `style` (or a CSS variable set there) instead.
 *
 * A style prop mints an emotion class for each distinct value, each carrying
 * a copy of its element's recipe, and the page never removes one. A place a
 * gesture moves — a bar's left and width, a row's height, a grid's template —
 * then grows the page's style sheet with every zoom, pan and drag: tens of
 * thousands of rules a gesture on a large canvas, every frame's styling
 * slowing with them, until past about 262,000 Chrome applies no new rule and
 * whatever draws at a new place draws unstyled.
 *
 * What counts as composed: a number worked out as the component renders —
 * a sum, product or template made with a number that is not a constant, a
 * call that returns one (`Math.round(x)`), or a local, a property or a helper
 * of this code whose initializer or return is one of those, a step or three
 * back. What does not: a literal, a choice between literals, a constant or a
 * template of constants, a string passed through whole or built from strings
 * (a token, `${tone}.700`, or a value the author wrote), and a number passed
 * through whole — a prop or a field, which Chakra may read as a token
 * (`w={10}` is 2.5rem) and which is judged where it is worked out. Read: a JSX attribute that is one of
 * Chakra's style properties or conditions, a property of this code's own that
 * a spread carries onto one, and a property of a `css` object written in
 * place.
 */

import ts from "typescript";

/** A type every value of which is one of a few: a literal, a boolean, nothing, or a union of those. */
function bounded(type) {
    if (type.isUnion()) return type.types.every(bounded);
    return (type.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Boolean
        | ts.TypeFlags.EnumLiteral | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) !== 0;
}

/** A type holding any number: `number` itself, or a template made with one. */
function numeric(type) {
    if (type.isUnion()) return type.types.some(numeric);
    if ((type.flags & ts.TypeFlags.Number) !== 0) return true;
    return (type.flags & ts.TypeFlags.TemplateLiteral) !== 0 && type.types.some((part) => (part.flags & ts.TypeFlags.Number) !== 0);
}

/** A symbol Chakra's styled system declares: one of its CSS properties, or a condition holding some (`_hover`). */
function chakraStyle(symbol) {
    return (symbol?.declarations ?? []).some((d) => /styled-system[\\/]generated[\\/](system|conditions)\.gen\.d\.ts$/.test(d.getSourceFile().fileName));
}

/** A declaration in the code being linted, not a library's. */
function ours(node) {
    return !/[\\/]node_modules[\\/]/.test(node.getSourceFile().fileName);
}

/** How many steps back a value is followed: a local, a property or a helper of this code, each a step. */
const STEPS = 3;

/**
 * The places in a source file where a Chakra style prop is given a value composed from numbers.
 *
 * @param sourceFile - The file, from a program with its types
 * @param checker - The program's type checker
 * @returns Each place's span in the file and the property it sets, in the file's order
 */
export function composedStyleProps(sourceFile, checker) {
    // A number that is not a constant: typed `number`, or a template made with one.
    const varies = (e) => {
        const type = checker.getTypeAtLocation(e);
        return numeric(type) && !bounded(type);
    };
    const composed = (expression, depth = 0) => {
        let e = expression;
        if (e === undefined || depth > STEPS) return false;
        while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
        // A template, a sum or a product is worked out where a part of it varies, or is itself worked out.
        const part = (p) => varies(p) || composed(p, depth);
        if (ts.isTemplateExpression(e)) return e.templateSpans.some((span) => part(span.expression));
        if (ts.isBinaryExpression(e)) {
            const op = e.operatorToken.kind;
            if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken || op === ts.SyntaxKind.AsteriskToken
                || op === ts.SyntaxKind.SlashToken || op === ts.SyntaxKind.PercentToken) return part(e.left) || part(e.right);
            if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.QuestionQuestionToken) {
                return composed(e.left, depth) || composed(e.right, depth);
            }
            return false;
        }
        if (ts.isPrefixUnaryExpression(e) && (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken)) return part(e.operand);
        if (ts.isConditionalExpression(e)) return composed(e.whenTrue, depth) || composed(e.whenFalse, depth);
        if (ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return false;
        // A step back: a local's or a property's initializer, or what a helper of this code returns. A helper whose body
        // can be read is judged by its returns, so one that unwraps a value (`getSomeorUndefined`) passes it through; a
        // call with no body of this code to read — a library's (`Math.round(x)`, `Number(v)`), or a method an interface
        // declares (`scale.fracOf(t)`) — works out a number where it returns one.
        const call = ts.isCallExpression(e);
        const at = call ? e.expression : ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) ? e : undefined;
        let symbol = at === undefined ? undefined : checker.getSymbolAtLocation(at);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        let read = false;
        for (const d of symbol?.declarations ?? []) {
            if (!ours(d)) continue;
            if (!call && (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d)) && d.initializer !== undefined && composed(d.initializer, depth + 1)) return true;
            if (!call) continue;
            const fn = ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) ? d
                : ts.isVariableDeclaration(d) && d.initializer !== undefined && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer
                    : undefined;
            if (fn?.body === undefined) continue;
            read = true;
            if (!ts.isBlock(fn.body)) {
                if (composed(fn.body, depth + 1)) return true;
                continue;
            }
            let returns = false;
            const walk = (node) => {
                if (returns || ts.isFunctionLike(node)) return;
                if (ts.isReturnStatement(node) && node.expression !== undefined && composed(node.expression, depth + 1)) returns = true;
                else ts.forEachChild(node, walk);
            };
            ts.forEachChild(fn.body, walk);
            if (returns) return true;
        }
        return call && !read && varies(e);
    };

    const hits = [];
    const hit = (node, prop) => hits.push({ start: node.getStart(sourceFile), end: node.getEnd(), prop });
    const intrinsic = (attributes) => {
        const tag = attributes.parent.tagName;
        return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
    };
    const visit = (node) => {
        if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined
            && !intrinsic(node.parent)) {
            const name = node.name.getText(sourceFile);
            const value = node.initializer.expression;
            if (name === "css") {
                // A css object written in place: each property of it.
                if (ts.isObjectLiteralExpression(value)) {
                    for (const member of value.properties) {
                        if (ts.isPropertyAssignment(member) && composed(member.initializer)) hit(member, member.name.getText(sourceFile));
                    }
                }
            } else if (chakraStyle(checker.getContextualType(node.parent)?.getProperty(name))) {
                // A responsive object or array is judged by its members.
                const members = ts.isObjectLiteralExpression(value) ? value.properties.filter(ts.isPropertyAssignment).map((p) => p.initializer)
                    : ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
                if (members.some((m) => composed(m))) hit(node, name);
            }
        }
        // A spread: each property of this code's own that lands on one of Chakra's — a wrapper's `...props` passes its
        // caller's through, judged where the caller writes them.
        if (ts.isJsxSpreadAttribute(node) && !intrinsic(node.parent)) {
            const target = checker.getContextualType(node.parent);
            for (const property of checker.getTypeAtLocation(node.expression).getProperties()) {
                if (!chakraStyle(target?.getProperty(property.name))) continue;
                const declaration = (property.declarations ?? []).find((d) => ours(d) && (ts.isPropertyAssignment(d) || ts.isShorthandPropertyAssignment(d)));
                if (declaration === undefined) continue;
                const value = ts.isPropertyAssignment(declaration) ? declaration.initializer : declaration.name;
                if (composed(value)) hit(node, property.name);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hits;
}

/** The rule, over the program typed linting builds: each place reported where its value is written. */
export default {
    meta: {
        type: "problem",
        docs: { description: "Write a place composed from numbers through `style`, never a Chakra style prop, which mints a CSS class for each value (#1440)." },
        schema: [],
        messages: {
            inline: "`{{prop}}` is composed from numbers: write it through `style` (or a CSS variable set there). A Chakra style prop mints a CSS class for each distinct value, which the page never removes (#1440).",
        },
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        if (services?.program === undefined || services.program === null) return {};
        return {
            Program() {
                const sourceFile = services.program.getSourceFile(context.filename);
                if (sourceFile === undefined) return;
                for (const place of composedStyleProps(sourceFile, services.program.getTypeChecker())) {
                    context.report({
                        loc: { start: context.sourceCode.getLocFromIndex(place.start), end: context.sourceCode.getLocFromIndex(place.end) },
                        messageId: "inline",
                        data: { prop: place.prop },
                    });
                }
            },
        };
    },
};
