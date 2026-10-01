/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The walk that holds a portable entry to running wherever JavaScript does.
 *
 * A portable entry is e3 with nothing of the machine it runs on: every module
 * it reaches, through every import — type-only, dynamic, re-exported — imports
 * only another of them and the packages it is allowed, and names none of
 * Node's globals. e3-core's `seams.spec.ts` walks e3-core's entry
 * (`portable.ts`), allowing East and e3's types; a package whose portable
 * entry is built on e3-core's walks its own the same way, allowing e3-core's
 * portable entry too, as e3-api-server's `portable.spec.ts` does.
 *
 * The walk reads each module's TypeScript with the compiler its caller gives
 * it, so the test entry that ships it depends on no compiler of its own.
 */

import { posix } from 'node:path';
import type TS from 'typescript';

/** The packages a portable module of e3 may import: East, and e3's types. */
export const PORTABLE_PACKAGES: ReadonlySet<string> = new Set(['@elaraai/east', '@elaraai/east/internal', '@elaraai/e3-types']);

/** Node's globals, which a portable module never names: a browser has none of
 *  them. */
const NODE_GLOBALS: ReadonlySet<string> = new Set(['Buffer', 'process', 'require', '__dirname', '__filename', 'global']);

/** The names of the global object, through which a Node global is reached as
 *  surely as by its own name. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'self', 'window']);

/** What a walk found: the modules it reached, sorted, and each fault, by the
 *  file and line it is on. */
export interface PortableGraph {
  /** The modules the walk reached, by path, forward-slashed. */
  modules: string[];
  /** Where the graph reaches beyond its modules and its packages. */
  faults: string[];
}

/**
 * Walks a module graph from `entry` through the modules it imports relatively,
 * and says where it reaches beyond them: an import of a Node builtin or of a
 * package it is not allowed, an import of a module that is not there or whose
 * name is computed, and a use of Node's globals.
 *
 * @param entry - The entry module, by its path, forward-slashed
 * @param read - Reads a module's text by its path, or gives `null` for none
 * @returns The modules the walk reached, and each fault
 */
export type PortableWalk = (entry: string, read: (file: string) => string | null) => PortableGraph;

/**
 * The walk a portable entry is held to.
 *
 * @remarks
 * Every import counts, whatever it carries: a static import or re-export, a
 * type-only one, a dynamic `import()`, an `import('…')` type, a CommonJS
 * `import x = require(…)`, and a module declaration. A type-only import of a
 * Node module still needs Node's types to compile against. A Node global
 * counts by its own name and as the global object's property; a member that
 * happens to share its name does not.
 *
 * @param ts - The TypeScript compiler the walk parses each module with: the
 *   caller's own `typescript`
 * @param packages - The packages a module may import; {@link PORTABLE_PACKAGES}
 *   for e3-core's entry
 * @returns The walk
 */
export function portableWalker(ts: typeof TS, packages: ReadonlySet<string>): PortableWalk {
  /** The module a node imports: its specifier; `null` when the import
   *  computes it; `undefined` when the node imports nothing. */
  function importedBy(node: TS.Node): string | null | undefined {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      return ts.isStringLiteral(node.moduleReference.expression) ? node.moduleReference.expression.text : null;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier.text : null;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      return node.argument.literal.text;
    }
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name.text;
    return undefined;
  }

  /** Whether an identifier is the name of a member — a property, a method, an
   *  accessor, a key a binding reads, a name imported or exported — rather
   *  than a reference to a variable. */
  function namesMember(node: TS.Identifier): boolean {
    const parent = node.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && (ts.isPropertyAccessExpression(parent) ? parent.name : parent.right) === node) {
      return true;
    }
    if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent))
      && parent.name === node) {
      return true;
    }
    if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
    return ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
  }

  /** The Node global a node names, or `null`: by its own name, or as the
   *  global object's property. */
  function nodeGlobalOf(node: TS.Node): string | null {
    if (ts.isIdentifier(node) && NODE_GLOBALS.has(node.text) && !namesMember(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)
      && NODE_GLOBALS.has(node.name.text)) {
      return `${node.expression.text}.${node.name.text}`;
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)
      && ts.isStringLiteralLike(node.argumentExpression) && NODE_GLOBALS.has(node.argumentExpression.text)) {
      return `${node.expression.text}.${node.argumentExpression.text}`;
    }
    return null;
  }

  return (entry, read) => {
    const reached = new Set<string>();
    const faults: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (reached.has(file)) continue;
      const text = read(file);
      if (text === null) {
        faults.push(`${file} is no module`);
        continue;
      }
      reached.add(file);
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
      const at = (node: TS.Node): string => `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
      const visit = (node: TS.Node): void => {
        const specifier = importedBy(node);
        if (specifier === null) {
          faults.push(`${at(node)} imports a module it computes`);
        } else if (specifier !== undefined && specifier.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\.js$/, '.ts');
          if (read(target) === null) faults.push(`${at(node)} imports ${specifier}, which is no module`);
          else queue.push(target);
        } else if (specifier !== undefined && !packages.has(specifier)) {
          faults.push(`${at(node)} imports ${specifier}`);
        }
        const global = nodeGlobalOf(node);
        if (global !== null) faults.push(`${at(node)} uses ${global}`);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    return { modules: [...reached].sort(), faults };
  };
}
