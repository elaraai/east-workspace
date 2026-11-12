/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lint rule `east-floor/browser-floor`: code a browser runs names no built-in newer than ES2023.
 *
 * East's pages are opened on iPhones back to iOS 16.4 (ruled 12 Nov 2026), and every browser on an iPhone runs on
 * the system's own engine, so the oldest iPhone is the oldest engine whatever browser its owner chose. That engine
 * has every built-in of ES2023 and few of what came after: `Iterator`, the iterator helpers, the Set methods,
 * `Object.groupBy`, `Promise.withResolvers` and the rest arrived release by release up to iOS 18.4 and beyond. A
 * built-in it lacks is `undefined` there — `Iterator.from(…)` threw `Can't find variable: Iterator` the moment any
 * Dict or Set was iterated, and a page stopped at its first draw, in every release until this rule.
 *
 * Which built-ins are newer is TypeScript's to say, never a list kept here: its library declares each edition's
 * built-ins in files of their own (`lib.es2024.*.d.ts`, `lib.es2025.*.d.ts`, `lib.esnext.*.d.ts`), so a name is
 * newer exactly when every declaration of what it resolves to is in one of those. `set.union(…)` on a built-in Set
 * is refused and the same call on East's own `SortedSet` is not; `values.map(…)` on an Array passes and on a Map's
 * iterator is refused; a method that gained an overload since (`Intl.DateTimeFormat`'s `format`) is as old as its
 * first. A regular expression's newer syntax — the `v` flag, a group name used twice, a modifier group — has no
 * declaration, and is read off the literal.
 *
 * Read: a name where a value is meant — an identifier, a property read by name or by a literal key, a property
 * destructured out. Not read: a type (`ReadonlySetLike<T>` in a signature costs nothing at run time), the members
 * of an interface that only describes a shape (below), and a receiver typed `any`, which no rule can judge — the
 * suite run on an engine without the newer built-ins (`make -C libs/east test-floor`) is what holds those.
 *
 * A built-in this code can do without where the engine has none is read through a property this code types itself
 * and so must handle the absence of — `(globalThis as { Iterator?: … }).Iterator` — which resolves to this code's
 * declaration, never the library's: the rule needs no exemption, and none is given by comment.
 * See `docs/conventions/BROWSER_FLOOR.md`.
 */

import ts from "typescript";

/** A file of TypeScript's own library that declares an edition newer than ES2023, or a proposal not yet in one. */
const NEWER_LIB = /(?:^|[\\/])lib\.(es20(?:2[4-9]|[3-9]\d)|esnext)\.[a-z0-9.]+\.d\.ts$/;

/**
 * Interfaces of the newer libraries that describe a shape, never a built-in: a member of one is whatever the value
 * at hand implements. `ReadonlySetLike` is what a Set method's argument has to offer — `keys`, `has`, `size`, which
 * every Set has had since ES2015 — and `PromiseWithResolvers` the record `Promise.withResolvers` returns, which code
 * that makes its own types its record by.
 */
const SHAPES = new Set(["ReadonlySetLike", "PromiseWithResolvers"]);

/** The edition a library file declares, as a person reads it. */
function editionOf(fileName) {
    const match = NEWER_LIB.exec(fileName);
    return match === null ? undefined : match[1] === "esnext" ? "a proposal newer than ES2025" : `ES${match[1].slice(2)}`;
}

/** What each program's newer libraries declare, by name: only a name among them is ever resolved. */
const namesByProgram = new WeakMap();

/** Every name a program's newer library files declare: a global, a member, a namespace. */
function newerNames(program) {
    const held = namesByProgram.get(program);
    if (held !== undefined) return held;
    const names = new Set();
    const collect = (node) => {
        if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node))
            && node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))) names.add(node.name.text);
        if (ts.isInterfaceDeclaration(node) && !SHAPES.has(node.name.text)) {
            for (const member of node.members) {
                if (member.name !== undefined && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name))) names.add(member.name.text);
            }
        }
        ts.forEachChild(node, collect);
    };
    for (const file of program.getSourceFiles()) {
        if (program.isSourceFileDefaultLibrary(file) && NEWER_LIB.test(file.fileName)) collect(file);
    }
    namesByProgram.set(program, names);
    return names;
}

/** A declaration that gives its name a value: an interface of the same name may be far older (`Iterator`). */
function declaresValue(declaration) {
    return ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)
        || ts.isModuleDeclaration(declaration) || ts.isEnumDeclaration(declaration);
}

/** What a regular expression's source and flags hold that is newer than ES2023, in words; none where nothing is. */
function newerRegExp(source, flags) {
    if (flags.includes("v")) return "the `v` flag (ES2024)";
    // Outside a character class and unescaped: a group's name, and a modifier group's flags.
    const names = new Set();
    let inClass = false;
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        if (c === "\\") { i += 1; continue; }
        if (inClass) { if (c === "]") inClass = false; continue; }
        if (c === "[") { inClass = true; continue; }
        if (c !== "(" || source[i + 1] !== "?") continue;
        const rest = source.slice(i + 2);
        const named = /^<([^=!>][^>]*)>/.exec(rest);
        if (named !== null) {
            if (names.has(named[1])) return `the group name \`${named[1]}\` used twice (ES2025)`;
            names.add(named[1]);
        } else if (/^[a-z]*-?[a-z]+:/i.test(rest) && !rest.startsWith(":")) {
            return "a modifier group (ES2025)";
        }
    }
    return undefined;
}

/**
 * The places in a source file where a value newer than ES2023 is named.
 *
 * @param sourceFile - The file, from a program with its types
 * @param program - The program: its checker resolves each name, and its library files say which are newer
 * @returns Each place's span in the file, the name as written, and the edition that declares it, in the file's order
 */
export function newerBuiltins(sourceFile, program) {
    const checker = program.getTypeChecker();
    const names = newerNames(program);
    const hits = [];
    const hit = (node, name, edition) => hits.push({ start: node.getStart(sourceFile), end: node.getEnd(), name, edition });

    const inNewer = (declaration) => {
        const file = declaration.getSourceFile();
        return program.isSourceFileDefaultLibrary(file) && NEWER_LIB.test(file.fileName);
    };
    // A symbol's verdict: newer where every declaration that counts is in a newer library, and none is of a shape.
    // Where a declaration gives the name a value, those alone count: `Iterator` the interface is of ES2015, and
    // `Iterator` the value of ES2025. A member's declarations all count: one that gained an overload since is as
    // old as its first.
    const judge = (symbol) => {
        if (symbol === undefined) return undefined;
        const all = symbol.declarations ?? [];
        const values = all.filter(declaresValue);
        const judged = values.length > 0 ? values : all;
        if (judged.length === 0 || !judged.every(inNewer)) return undefined;
        if (judged.some((d) => ts.isInterfaceDeclaration(d.parent) && SHAPES.has(d.parent.name.text))) return undefined;
        return editionOf(judged[0].getSourceFile().fileName);
    };
    const resolved = (node) => {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        return symbol;
    };
    // A property's verdict, read off a value of a type: of a union, each of its types is judged on its own, since
    // the value is any one of them — a built-in Set's `union` is refused though this code's own set has one too.
    const member = (type, name, at) => {
        const whole = checker.getApparentType(type);
        if (!whole.isUnion()) return judge(at === undefined ? checker.getPropertyOfType(whole, name) : resolved(at) ?? checker.getPropertyOfType(whole, name));
        for (const part of whole.types) {
            const edition = judge(checker.getPropertyOfType(checker.getApparentType(part), name));
            if (edition !== undefined) return edition;
        }
        return undefined;
    };

    const visit = (node) => {
        // What a class extends is a value, its type arguments types; what it implements is a type.
        if (ts.isHeritageClause(node)) {
            if (node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent)) for (const base of node.types) visit(base.expression);
            return;
        }
        // A type names no value: an annotation, an alias, an interface, a type-only import.
        if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

        if (ts.isRegularExpressionLiteral(node)) {
            const end = node.text.lastIndexOf("/");
            const newer = newerRegExp(node.text.slice(1, end), node.text.slice(end + 1));
            if (newer !== undefined) hit(node, newer, undefined);
        } else if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp"
            && node.arguments !== undefined && node.arguments.length > 0) {
            const [source, flags] = node.arguments;
            const newer = newerRegExp(source !== undefined && ts.isStringLiteralLike(source) ? source.text : "", flags !== undefined && ts.isStringLiteralLike(flags) ? flags.text : "");
            if (newer !== undefined) hit(node, newer, undefined);
        }

        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
            if (names.has(node.name.text)) {
                const edition = member(checker.getTypeAtLocation(node.expression), node.name.text, node.name);
                if (edition !== undefined) hit(node.name, node.name.text, edition);
            }
        } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
            if (names.has(node.argumentExpression.text)) {
                const edition = member(checker.getTypeAtLocation(node.expression), node.argumentExpression.text, node.argumentExpression);
                if (edition !== undefined) hit(node.argumentExpression, node.argumentExpression.text, edition);
            }
        } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
            // A property destructured out: judged as the property of what is destructured.
            const key = node.propertyName ?? node.name;
            if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && names.has(key.text)) {
                const edition = member(checker.getTypeAtLocation(node.parent), key.text, undefined);
                if (edition !== undefined) hit(key, key.text, edition);
            }
        } else if (ts.isIdentifier(node) && names.has(node.text)) {
            // A name on its own, where a value is meant: never the name its parent declares or reads a property by — a
            // variable's, a parameter's, a method's, a property's (judged above where it is read), a label's. A
            // shorthand property (`{ Iterator }`) is both a name and a read of the value of that name.
            const parent = node.parent;
            const shorthand = ts.isShorthandPropertyAssignment(parent);
            const named = !shorthand && (parent.name === node || parent.propertyName === node || parent.label === node);
            if (!named) {
                const edition = judge(shorthand ? checker.getShorthandAssignmentValueSymbol(parent) : resolved(node));
                if (edition !== undefined) hit(node, node.text, edition);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hits.sort((a, b) => a.start - b.start);
}

/** The rule, over the program typed linting builds: each place reported where the name is written. */
export default {
    meta: {
        type: "problem",
        docs: { description: "Name no built-in newer than ES2023 in code a browser runs: an iPhone before iOS 18.4 has few of them (docs/conventions/BROWSER_FLOOR.md)." },
        schema: [],
        messages: {
            builtin: "`{{name}}` is a built-in of {{edition}}, which the oldest browser this code runs on has none of (ES2023: an iPhone's back to iOS 16.4). Do without it, or read it through a property this code types as optional — `(globalThis as { X?: … }).X` — and handle its absence. See docs/conventions/BROWSER_FLOOR.md.",
            regexp: "This regular expression uses {{name}}, which the oldest browser this code runs on cannot read (ES2023: an iPhone's back to iOS 16.4). See docs/conventions/BROWSER_FLOOR.md.",
        },
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        if (services?.program === undefined || services.program === null) return {};
        return {
            Program() {
                const sourceFile = services.program.getSourceFile(context.filename);
                if (sourceFile === undefined) return;
                for (const place of newerBuiltins(sourceFile, services.program)) {
                    context.report({
                        loc: { start: context.sourceCode.getLocFromIndex(place.start), end: context.sourceCode.getLocFromIndex(place.end) },
                        messageId: place.edition === undefined ? "regexp" : "builtin",
                        data: { name: place.name, edition: place.edition ?? "" },
                    });
                }
            },
        };
    },
};
