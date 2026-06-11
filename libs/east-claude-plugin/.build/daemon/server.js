// daemon/server.ts
import { createServer } from "node:net";
import { existsSync as existsSync2, unlinkSync } from "node:fs";

// ../east-diagnostics/dist/src/east-type.js
function isEastExprType(type) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === void 0 || seen.has(current))
      continue;
    seen.add(current);
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== void 0 && (name === "Expr" || name.endsWith("Expr")))
      return true;
    if (current.isUnionOrIntersection())
      stack.push(...current.types);
    const bases = current.getBaseTypes?.();
    if (bases !== void 0)
      stack.push(...bases);
  }
  return false;
}
function isBlockBuilderType(type) {
  const name = type.aliasSymbol?.name ?? type.symbol?.name;
  return name === "BlockBuilder";
}

// ../east-diagnostics/dist/src/block-builder.js
function matchBlockBuilderCall(node, ctx) {
  const t = ctx.ts;
  if (!t.isCallExpression(node))
    return void 0;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee))
    return void 0;
  const method = callee.name.text;
  if (method !== "let" && method !== "const")
    return void 0;
  if (!isBlockBuilderType(ctx.checker.getTypeAtLocation(callee.expression)))
    return void 0;
  return { call: node, method, args: node.arguments };
}

// ../east-diagnostics/dist/src/rules/no-redundant-east-cast.js
var NAME = "no-redundant-east-cast";
var CODE = 990001;
var noRedundantEastCast = {
  name: NAME,
  code: CODE,
  description: "Disallow a TypeScript cast on the value argument of $.let/$.const when the East type argument is present (the type argument already drives inference).",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === void 0 || match.args.length < 2)
      return;
    const t = ctx.ts;
    const value = match.args[0];
    if (value === void 0)
      return;
    let inner;
    if (t.isAsExpression(value))
      inner = value.expression;
    else if (t.isTypeAssertionExpression(value))
      inner = value.expression;
    if (inner === void 0)
      return;
    const sf = ctx.sourceFile;
    const start = value.getStart(sf);
    const length = value.getEnd() - start;
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length,
      messageText: `Redundant cast: \`$.${match.method}\` infers the value type from the East type argument; drop the \`as \u2026\` on the value.`,
      category: "warning",
      fix: {
        description: "Remove redundant cast",
        changes: [{ start, length, newText: inner.getText(sf) }]
      }
    });
  }
};

// ../east-diagnostics/dist/src/rules/prefer-explicit-east-type.js
var NAME2 = "prefer-explicit-east-type";
var CODE2 = 990002;
function isEmptyNewMapOrSet(node, t) {
  if (!t.isNewExpression(node) || !t.isIdentifier(node.expression))
    return false;
  const ctor = node.expression.text;
  if (ctor !== "Map" && ctor !== "Set")
    return false;
  return node.arguments === void 0 || node.arguments.length === 0;
}
function isRawValueLiteral(node, t) {
  return t.isNumericLiteral(node) || t.isBigIntLiteral(node) || t.isStringLiteralLike(node) || node.kind === t.SyntaxKind.TrueKeyword || node.kind === t.SyntaxKind.FalseKeyword || node.kind === t.SyntaxKind.NullKeyword || t.isArrayLiteralExpression(node) || t.isObjectLiteralExpression(node) || t.isNewExpression(node);
}
var preferExplicitEastType = {
  name: NAME2,
  code: CODE2,
  description: "Encourage passing the East type as the second argument to $.let/$.const for raw JS values whose East type is under-determined.",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === void 0 || match.args.length !== 1)
      return;
    const t = ctx.ts;
    const value = match.args[0];
    if (value === void 0)
      return;
    const underDetermined = t.isArrayLiteralExpression(value) && value.elements.length === 0 || t.isObjectLiteralExpression(value) && value.properties.length === 0 || isEmptyNewMapOrSet(value, t);
    const mode = ctx.options.preferExplicitEastType?.mode ?? "under-determined";
    const flag = underDetermined || mode === "all-raw-values" && isRawValueLiteral(value, t);
    if (!flag)
      return;
    const sf = ctx.sourceFile;
    const start = value.getStart(sf);
    ctx.report({
      ruleName: NAME2,
      code: CODE2,
      start,
      length: value.getEnd() - start,
      messageText: `Provide the East type as the second argument to \`$.${match.method}\` \u2014 e.g. \`$.${match.method}([], ArrayType(FloatType))\` \u2014 to pin the value type; it is under-determined from the value alone.`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/prefer-some-none.js
var NAME3 = "prefer-some-none";
var CODE3 = 990003;
var preferSomeNone = {
  name: NAME3,
  code: CODE3,
  description: 'Prefer some()/none over variant("some", \u2026)/variant("none", null).',
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isIdentifier(callee) || callee.text !== "variant")
      return;
    const first = node.arguments[0];
    if (first === void 0 || !t.isStringLiteralLike(first))
      return;
    const tag = first.text;
    if (tag !== "some" && tag !== "none")
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME3,
      code: CODE3,
      start,
      length: node.getEnd() - start,
      messageText: tag === "some" ? 'Use `some(value)` instead of `variant("some", value)`.' : 'Use `none` instead of `variant("none", null)`.',
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-handrolled-variant.js
var NAME4 = "no-handrolled-variant";
var CODE4 = 990004;
var VARIANT_TYPE_NAMES = /* @__PURE__ */ new Set(["variant", "some", "none", "option", "VariantExpr"]);
function expectsVariant(type) {
  const stack = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === void 0)
      continue;
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== void 0 && VARIANT_TYPE_NAMES.has(name))
      return true;
    if (current.isUnionOrIntersection())
      stack.push(...current.types);
  }
  return false;
}
var noHandrolledVariant = {
  name: NAME4,
  code: CODE4,
  description: "Disallow plain object literals where an East variant/option is expected; use variant()/some()/none.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isObjectLiteralExpression(node))
      return;
    const contextualType = ctx.checker.getContextualType(node);
    if (contextualType === void 0 || !expectsVariant(contextualType))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME4,
      code: CODE4,
      start,
      length: node.getEnd() - start,
      messageText: 'Hand-rolled variant: build with `variant("Tag", value)`, `some(value)`, or `none` from @elaraai/east \u2014 never a plain `{ type, value }` object literal.',
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-east-namespaced-type.js
var NAME5 = "no-east-namespaced-type";
var CODE5 = 990005;
var noEastNamespacedType = {
  name: NAME5,
  code: CODE5,
  description: "Disallow East.<X>Type member access; import the type directly from @elaraai/east.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isPropertyAccessExpression(node))
      return;
    if (!t.isIdentifier(node.expression) || node.expression.text !== "East")
      return;
    const name = node.name.text;
    if (!name.endsWith("Type"))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME5,
      code: CODE5,
      start,
      length: node.getEnd() - start,
      messageText: `\`East.${name}\` is not a member of the East namespace \u2014 import \`${name}\` directly from @elaraai/east.`,
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/block-scope.js
function isEastFunctionCall(node, t) {
  if (!t.isCallExpression(node))
    return false;
  const callee = node.expression;
  return t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && (callee.name.text === "function" || callee.name.text === "asyncFunction");
}
function isBlockBuilderCallback(node, ctx) {
  const t = ctx.ts;
  if (!t.isArrowFunction(node) && !t.isFunctionExpression(node))
    return false;
  const first = node.parameters[0];
  if (first === void 0)
    return false;
  return isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name));
}
function enclosingBlockScope(node, ctx) {
  const t = ctx.ts;
  let outermost;
  let current = node.parent;
  while (current !== void 0) {
    if (isEastFunctionCall(current, t) || isBlockBuilderCallback(current, ctx)) {
      outermost = current;
    }
    current = current.parent;
  }
  return outermost;
}
function insideBlockScope(node, ctx) {
  return enclosingBlockScope(node, ctx) !== void 0;
}

// ../east-diagnostics/dist/src/rules/prefer-let-const-over-east-value.js
var NAME6 = "prefer-let-const-over-east-value";
var CODE6 = 990006;
var preferLetConstOverEastValue = {
  name: NAME6,
  code: CODE6,
  description: "Inside East.function blocks, bind with $.let/$.const (and return that) rather than East.value().",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee))
      return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "East")
      return;
    if (callee.name.text !== "value")
      return;
    const parent = node.parent;
    const asDeclaration = parent !== void 0 && t.isVariableDeclaration(parent) && parent.initializer === node;
    const asReturn = parent !== void 0 && t.isReturnStatement(parent) && parent.expression === node;
    const asCallbackBody = parent !== void 0 && t.isArrowFunction(parent) && parent.body === node && parent.parent !== void 0 && t.isCallExpression(parent.parent) && parent.parent.arguments.some((arg) => arg === parent);
    if (!asDeclaration && !asReturn && !asCallbackBody)
      return;
    if (!insideBlockScope(node, ctx))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    const inner = node.arguments[0];
    ctx.report({
      ruleName: NAME6,
      code: CODE6,
      start,
      length: node.getEnd() - start,
      messageText: asCallbackBody ? "Don't wrap a callback's return in `East.value(...)` \u2014 the callback's expected element type already supplies the East type. Return the plain value." : asReturn ? "Don't `return East.value(...)` \u2014 it erases the East type. Bind the value with `$.let`/`$.const` (passing the East type) and return that variable." : "Inside an East block, declare with `$.const(value, Type)` / `$.let(value, Type)` instead of `East.value(...)`, which erases the East type at the call site.",
      category: "suggestion",
      ...asCallbackBody && inner !== void 0 ? {
        fix: {
          description: "Return the plain value (drop the redundant East.value wrapper)",
          changes: [
            { start, length: node.getEnd() - start, newText: inner.getText(sf) }
          ]
        }
      } : {}
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-relative-src-import.js
var NAME7 = "no-relative-src-import";
var CODE7 = 990007;
var DEEP_PACKAGE_SRC = /^@elaraai\/[^/]+\/src(\/|$)/;
var RELATIVE_SRC = /\/src(\/|$)/;
var noRelativeSrcImport = {
  name: NAME7,
  code: CODE7,
  description: "Import East packages by published name, not via ../src or a deep /src path.",
  check(node, ctx) {
    const t = ctx.ts;
    let specifier;
    if (t.isImportDeclaration(node))
      specifier = node.moduleSpecifier;
    else if (t.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    else
      return;
    if (specifier === void 0 || !t.isStringLiteral(specifier))
      return;
    const text = specifier.text;
    const relativeIntoSrc = text.startsWith(".") && RELATIVE_SRC.test(text);
    const deepPackageSrc = DEEP_PACKAGE_SRC.test(text);
    if (!relativeIntoSrc && !deepPackageSrc)
      return;
    const sf = ctx.sourceFile;
    const start = specifier.getStart(sf);
    ctx.report({
      ruleName: NAME7,
      code: CODE7,
      start,
      length: specifier.getEnd() - start,
      messageText: "Import East packages by their published name (e.g. `@elaraai/east`), not a relative `../src/...` path or a deep `/src` import.",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-let-const-in-expression.js
var NAME8 = "no-let-const-in-expression";
var CODE8 = 990008;
var noLetConstInExpression = {
  name: NAME8,
  code: CODE8,
  description: "Require $.let/$.const to be bound to a const; disallow using the result inline in an expression.",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === void 0)
      return;
    const t = ctx.ts;
    const call = match.call;
    let current = call;
    let parent = current.parent;
    while (parent !== void 0 && t.isParenthesizedExpression(parent)) {
      current = parent;
      parent = parent.parent;
    }
    if (parent === void 0)
      return;
    const usedInExpression = t.isPropertyAccessExpression(parent) && parent.expression === current || t.isElementAccessExpression(parent) && parent.expression === current || t.isBinaryExpression(parent) && (parent.left === current || parent.right === current) || t.isCallExpression(parent) && parent.arguments.some((arg) => arg === current);
    if (!usedInExpression)
      return;
    const sf = ctx.sourceFile;
    const start = call.getStart(sf);
    ctx.report({
      ruleName: NAME8,
      code: CODE8,
      start,
      length: call.getEnd() - start,
      messageText: `\`$.${match.method}\` declares a variable \u2014 bind it to a \`const\` first (\`const x = $.${match.method}(value, Type)\`), don't use the result inline (e.g. \`$.if($.let(...))\` or \`$.let(...).add(...)\`).`,
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-unexecuted-east-expression.js
var NAME9 = "no-unexecuted-east-expression";
var CODE9 = 990009;
var noUnexecutedEastExpression = {
  name: NAME9,
  code: CODE9,
  description: "Flag a bare East expression statement that is never executed with $() or bound \u2014 it has no effect.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isExpressionStatement(node))
      return;
    const expr = node.expression;
    let root = expr;
    for (; ; ) {
      if (t.isCallExpression(root)) {
        root = root.expression;
      } else if (t.isPropertyAccessExpression(root) || t.isElementAccessExpression(root)) {
        root = root.expression;
      } else {
        break;
      }
    }
    if (isBlockBuilderType(ctx.checker.getTypeAtLocation(root)))
      return;
    if (!isEastExprType(ctx.checker.getTypeAtLocation(expr)))
      return;
    const sf = ctx.sourceFile;
    const start = expr.getStart(sf);
    ctx.report({
      ruleName: NAME9,
      code: CODE9,
      start,
      length: expr.getEnd() - start,
      messageText: "This East expression is never executed or bound, so it has no effect. Wrap it in `$( \u2026 )` to run it for its effect, or bind it with `$.let` / `$.const`.",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-reinlined-east-binding.js
var NAME10 = "no-reinlined-east-binding";
var CODE10 = 990010;
var noReinlinedEastBinding = {
  name: NAME10,
  code: CODE10,
  description: "An East Expr bound to a JS const/let and reused inside an East block is re-inlined per use \u2014 bind it once with $.let/$.const.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isVariableDeclaration(node))
      return;
    if (!t.isIdentifier(node.name))
      return;
    if (node.initializer === void 0)
      return;
    let init2 = node.initializer;
    while (t.isParenthesizedExpression(init2))
      init2 = init2.expression;
    if (matchBlockBuilderCall(init2, ctx) !== void 0)
      return;
    if (t.isIdentifier(init2))
      return;
    if (!isEastExprType(ctx.checker.getTypeAtLocation(init2)))
      return;
    const declSymbol = ctx.checker.getSymbolAtLocation(node.name);
    if (declSymbol === void 0)
      return;
    const name = node.name.text;
    const perBody = /* @__PURE__ */ new Map();
    const visit = (n) => {
      if (t.isIdentifier(n) && n !== node.name && n.text === name) {
        if (ctx.checker.getSymbolAtLocation(n) === declSymbol) {
          const body = enclosingBlockScope(n, ctx);
          if (body !== void 0)
            perBody.set(body, (perBody.get(body) ?? 0) + 1);
        }
      }
      t.forEachChild(n, visit);
    };
    visit(ctx.sourceFile);
    let maxInBody = 0;
    for (const count of perBody.values())
      if (count > maxInBody)
        maxInBody = count;
    if (maxInBody < 2)
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME10,
      code: CODE10,
      start,
      length: node.getEnd() - start,
      messageText: "This East expression is bound to a JS `const`/`let` and used more than once inside an East block, so it is re-inlined \u2014 and re-evaluated, with a fresh identity for mutable values \u2014 at each use. Bind it once with `$.const`/`$.let`.",
      category: "error"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-east-data-builder-helper.js
var NAME11 = "no-east-data-builder-helper";
var CODE11 = 990011;
var VALUE_CONSTRUCTORS = /* @__PURE__ */ new Set(["variant", "some"]);
function isEastValueConstructor(expr, t) {
  if (t.isCallExpression(expr)) {
    const callee = expr.expression;
    if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text))
      return true;
    return t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && callee.name.text === "value";
  }
  return t.isIdentifier(expr) && expr.text === "none";
}
function returnExpressions(fn, t) {
  if (fn.body === void 0)
    return [];
  if (!t.isBlock(fn.body))
    return [fn.body];
  const out = [];
  const visit = (n) => {
    if (t.isFunctionDeclaration(n) || t.isFunctionExpression(n) || t.isArrowFunction(n))
      return;
    if (t.isReturnStatement(n) && n.expression !== void 0)
      out.push(n.expression);
    t.forEachChild(n, visit);
  };
  t.forEachChild(fn.body, visit);
  return out;
}
function isBuilderFunction(fn, ctx) {
  const t = ctx.ts;
  const first = fn.parameters[0];
  if (first !== void 0 && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name))) {
    return false;
  }
  const returns = returnExpressions(fn, t);
  return returns.length > 0 && returns.every((r) => isEastValueConstructor(r, t));
}
var noEastDataBuilderHelper = {
  name: NAME11,
  code: CODE11,
  description: "Flag a TS helper whose only job is to return a hand-built East value (variant/some/none/East.value) \u2014 inline it or make it a real East.function.",
  check(node, ctx) {
    const t = ctx.ts;
    let fn;
    let reportNode;
    if (t.isFunctionDeclaration(node) && node.body !== void 0) {
      fn = node;
      reportNode = node.name ?? node;
    } else if (t.isVariableDeclaration(node) && node.initializer !== void 0 && (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))) {
      fn = node.initializer;
      reportNode = node.name;
    }
    if (fn === void 0 || reportNode === void 0)
      return;
    if (!isBuilderFunction(fn, ctx))
      return;
    const sf = ctx.sourceFile;
    const start = reportNode.getStart(sf);
    ctx.report({
      ruleName: NAME11,
      code: CODE11,
      start,
      length: reportNode.getEnd() - start,
      messageText: "This helper just returns a hand-built East value (`variant`/`some`/`none`/`East.value`), so it is an authoring-time macro, not a real East function. Inline the constructor at each call site (repetition is welcome), or make it a real `East.function` if you need a reusable East computation.",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/prefer-jsx-over-factory-call.js
var NAME12 = "prefer-jsx-over-factory-call";
var CODE12 = 990012;
var jsxElementCache = /* @__PURE__ */ new WeakMap();
function jsxElementType(ctx) {
  const cached = jsxElementCache.get(ctx.sourceFile);
  if (cached !== void 0)
    return cached ?? void 0;
  const computed = computeJsxElementType(ctx);
  jsxElementCache.set(ctx.sourceFile, computed ?? null);
  return computed;
}
function computeJsxElementType(ctx) {
  const t = ctx.ts;
  const elementOf = (ns) => {
    const el = ctx.checker.getExportsOfModule(ns).find((s) => s.name === "Element");
    return el ? ctx.checker.getDeclaredTypeOfSymbol(el) : void 0;
  };
  const resolveName = ctx.checker.resolveName;
  const globalNs = resolveName?.("JSX", ctx.sourceFile, t.SymbolFlags.Namespace, false);
  if (globalNs !== void 0) {
    const fromGlobal = elementOf(globalNs);
    if (fromGlobal !== void 0)
      return fromGlobal;
  }
  const program = ctx.program;
  if (program === void 0)
    return void 0;
  const options = program.getCompilerOptions();
  const base = jsxImportSourceFor(options, ctx.sourceFile, t);
  if (base === void 0)
    return void 0;
  const resolutionHost = {
    fileExists: (f) => program.getSourceFile(f) !== void 0 || t.sys.fileExists(f),
    readFile: (f) => program.getSourceFile(f)?.text ?? t.sys.readFile(f),
    directoryExists: (d) => t.sys.directoryExists(d),
    getCurrentDirectory: () => t.sys.getCurrentDirectory(),
    getDirectories: (d) => t.sys.getDirectories(d)
  };
  if (t.sys.realpath !== void 0)
    resolutionHost.realpath = (p) => t.sys.realpath(p);
  const resolved = t.resolveModuleName(`${base}/jsx-runtime`, ctx.sourceFile.fileName, options, resolutionHost).resolvedModule?.resolvedFileName;
  if (resolved === void 0)
    return void 0;
  const runtimeSf = program.getSourceFile(resolved);
  const moduleSym = runtimeSf ? ctx.checker.getSymbolAtLocation(runtimeSf) : void 0;
  if (moduleSym === void 0)
    return void 0;
  const jsxNs = ctx.checker.getExportsOfModule(moduleSym).find((s) => s.name === "JSX");
  return jsxNs ? elementOf(jsxNs) : void 0;
}
function jsxImportSourceFor(options, sourceFile, t) {
  const pragmas = sourceFile.pragmas;
  const pragma = pragmas?.get("jsximportsource");
  const fromPragma = Array.isArray(pragma) ? pragma[pragma.length - 1]?.arguments?.factory : pragma?.arguments?.factory;
  if (fromPragma !== void 0)
    return fromPragma;
  if (options.jsx !== t.JsxEmit.ReactJSX && options.jsx !== t.JsxEmit.ReactJSXDev)
    return void 0;
  return options.jsxImportSource ?? "react";
}
function sameType(a, b, checker) {
  const c = checker;
  if (c.isTypeAssignableTo === void 0)
    return a === b;
  return c.isTypeAssignableTo(a, b) && c.isTypeAssignableTo(b, a);
}
var preferJsxOverFactoryCall = {
  name: NAME12,
  code: CODE12,
  description: "In a .tsx file, prefer the <Foo> JSX tag over a factory's Foo.Root(...) when the call produces a JSX element.",
  check(node, ctx) {
    const t = ctx.ts;
    if (ctx.sourceFile.languageVariant !== t.LanguageVariant.JSX)
      return;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee))
      return;
    if (callee.name.text !== "Root")
      return;
    if (!t.isIdentifier(callee.expression))
      return;
    const factoryIdent = callee.expression;
    const element = jsxElementType(ctx);
    if (element === void 0)
      return;
    const result = ctx.checker.getTypeAtLocation(node);
    if (!sameType(result, element, ctx.checker))
      return;
    let tagName = factoryIdent.text;
    const sym = ctx.checker.getSymbolAtLocation(factoryIdent);
    if (sym !== void 0 && (sym.flags & t.SymbolFlags.Alias) !== 0) {
      const target = ctx.checker.getAliasedSymbol(sym);
      if (target.name.length > 0)
        tagName = target.name;
    }
    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME12,
      code: CODE12,
      start,
      length: callee.getEnd() - start,
      messageText: `Author this with the \`<${tagName}>\` JSX tag instead of \`${factoryIdent.text}.Root(...)\` \u2014 in a .tsx file the JSX tag is the authoring surface (the call already produces a JSX element).`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-untracked-east-data.js
var NAME13 = "no-untracked-east-data";
var CODE13 = 990013;
function plainLiteralInitializer(decl, t) {
  const init2 = decl.initializer;
  if (init2 === void 0)
    return void 0;
  const unwrapped = t.isAsExpression(init2) || t.isSatisfiesExpression(init2) ? init2.expression : init2;
  if (t.isArrayLiteralExpression(unwrapped) || t.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }
  return void 0;
}
var noUntrackedEastData = {
  name: NAME13,
  code: CODE13,
  description: "Inside East blocks, bind data consumed in East-typed positions with $.const/$.let, not a bare JS const.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isIdentifier(node))
      return;
    const parent = node.parent;
    const isCallArg = parent !== void 0 && t.isCallExpression(parent) && parent.expression !== node && parent.arguments.some((arg) => arg === node);
    const isJsxValue = parent !== void 0 && t.isJsxExpression(parent) && parent.expression === node;
    if (!isCallArg && !isJsxValue)
      return;
    if (!insideBlockScope(node, ctx))
      return;
    const contextual = ctx.checker.getContextualType(node);
    if (contextual === void 0 || !isEastExprType(contextual))
      return;
    const symbol = ctx.checker.getSymbolAtLocation(node);
    const decl = symbol?.valueDeclaration;
    if (decl === void 0 || !t.isVariableDeclaration(decl))
      return;
    if (plainLiteralInitializer(decl, t) === void 0)
      return;
    if (!insideBlockScope(decl, ctx))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME13,
      code: CODE13,
      start,
      length: node.getEnd() - start,
      messageText: `Bare \`const ${node.text} = \u2026\` isn't tracked by the East block builder. Bind East data with \`$.const([...], Type)\` (or \`$.let\`) so the binding carries its East type and is evaluated once.`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/index.js
var allRules = [
  noRedundantEastCast,
  preferExplicitEastType,
  preferSomeNone,
  noHandrolledVariant,
  noEastNamespacedType,
  preferLetConstOverEastValue,
  noRelativeSrcImport,
  noLetConstInExpression,
  noUnexecutedEastExpression,
  noReinlinedEastBinding,
  noEastDataBuilderHelper,
  preferJsxOverFactoryCall,
  noUntrackedEastData
];

// ../east-diagnostics/dist/src/run.js
function runEastRules(tsModule, program, sourceFile, checker, options = {}, rules = allRules) {
  const diagnostics = [];
  const ctx = {
    ts: tsModule,
    sourceFile,
    checker,
    program,
    options,
    report: (d) => diagnostics.push(d)
  };
  const disabled = new Set(options.disabled ?? []);
  const active = rules.filter((rule) => !disabled.has(rule.name));
  const visit = (node) => {
    for (const rule of active)
      rule.check(node, ctx);
    tsModule.forEachChild(node, visit);
  };
  visit(sourceFile);
  return diagnostics;
}

// ../east-diagnostics/dist/src/service.js
import { createRequire as createRequire2 } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";

// ../east-diagnostics/dist/src/east-module.js
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
var cache = /* @__PURE__ */ new Map();
var pendingImports = /* @__PURE__ */ new Set();
function validate(candidate) {
  const m = candidate;
  const mod = (typeof m?.["diffTypes"] === "function" ? m : m?.["default"]) ?? void 0;
  if (mod === void 0)
    return null;
  const fns = ["diffTypes", "renderTypeDiff", "StructType", "VariantType", "ArrayType", "RecursiveType", "FunctionType", "TypeUnion"];
  for (const f of fns)
    if (typeof mod[f] !== "function")
      return null;
  if (mod["IntegerType"] === void 0)
    return null;
  return mod;
}
function getEastModule(projectDir) {
  const cached = cache.get(projectDir);
  if (cached !== void 0)
    return cached ?? void 0;
  const require_ = createRequire(join(projectDir, "_.js"));
  let entry;
  try {
    entry = require_.resolve("@elaraai/east");
  } catch {
    cache.set(projectDir, null);
    return void 0;
  }
  try {
    const mod = validate(require_(entry));
    cache.set(projectDir, mod);
    return mod ?? void 0;
  } catch {
    if (!pendingImports.has(projectDir)) {
      pendingImports.add(projectDir);
      import(pathToFileURL(entry).href).then((m) => cache.set(projectDir, validate(m)), () => cache.set(projectDir, null));
    }
    return void 0;
  }
}

// ../east-diagnostics/dist/src/type-reify.js
var PRIMITIVE_TAGS = /* @__PURE__ */ new Set(["Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"]);
var MAX_DEPTH = 32;
var Bail = class extends Error {
};
function bail() {
  throw new Bail();
}
function propType(ctx, type, name) {
  const symbol = ctx.checker.getPropertyOfType(type, name);
  if (symbol === void 0)
    return void 0;
  return ctx.checker.getTypeOfSymbol(symbol);
}
function literalString(type) {
  return type !== void 0 && type.isStringLiteral() ? type.value : void 0;
}
function typeArguments(ctx, type) {
  const { t, checker } = ctx;
  if ((type.flags & t.TypeFlags.Object) === 0)
    return [];
  if ((type.objectFlags & t.ObjectFlags.Reference) === 0)
    return [];
  return checker.getTypeArguments(type);
}
function stripAbsent(ctx, type) {
  const members = type.isUnion() ? type.types : [type];
  return members.filter((m) => (m.flags & (ctx.t.TypeFlags.Undefined | ctx.t.TypeFlags.Void)) === 0);
}
function reifyUnion(ctx, members) {
  const reified = [];
  for (const m of members) {
    try {
      reified.push(walk(ctx, m));
    } catch (e) {
      if (!(e instanceof Bail))
        throw e;
    }
  }
  if (reified.length === 0)
    bail();
  const distinct = [...new Set(reified)];
  const nonNever = distinct.filter((r) => r !== ctx.east.NeverType);
  const candidates = nonNever.length > 0 ? nonNever : distinct;
  if (candidates.length === 1)
    return candidates[0];
  try {
    return candidates.reduce((a, b) => ctx.east.TypeUnion(a, b));
  } catch {
    bail();
  }
}
function reifyEncoding(ctx, type, tag) {
  const { east, checker } = ctx;
  if (PRIMITIVE_TAGS.has(tag))
    return east[`${tag}Type`];
  switch (tag) {
    case "Ref": {
      const v = propType(ctx, type, "value") ?? bail();
      return east.RefType(walk(ctx, v));
    }
    case "Array": {
      const v = propType(ctx, type, "value") ?? bail();
      return east.ArrayType(walk(ctx, v));
    }
    case "Set": {
      const k = propType(ctx, type, "key") ?? bail();
      return east.SetType(walk(ctx, k));
    }
    case "Dict": {
      const k = propType(ctx, type, "key") ?? bail();
      const v = propType(ctx, type, "value") ?? bail();
      return east.DictType(walk(ctx, k), walk(ctx, v));
    }
    case "Vector": {
      const e = propType(ctx, type, "element") ?? bail();
      return east.VectorType(walk(ctx, e));
    }
    case "Matrix": {
      const e = propType(ctx, type, "element") ?? bail();
      return east.MatrixType(walk(ctx, e));
    }
    case "Struct": {
      const fieldsType = propType(ctx, type, "fields") ?? bail();
      const fields = {};
      for (const prop of checker.getPropertiesOfType(fieldsType)) {
        const name = prop.getName();
        if (name.startsWith("__@"))
          continue;
        fields[name] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
      }
      return east.StructType(fields);
    }
    case "Variant": {
      const casesType = propType(ctx, type, "cases") ?? bail();
      const cases = {};
      for (const prop of checker.getPropertiesOfType(casesType)) {
        const name = prop.getName();
        if (name.startsWith("__@"))
          continue;
        cases[name] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
      }
      return east.VariantType(cases);
    }
    case "Function":
    case "AsyncFunction": {
      const inputsType = propType(ctx, type, "inputs") ?? bail();
      if (!checker.isTupleType(inputsType))
        bail();
      const inputs = typeArguments(ctx, inputsType).map((i) => walk(ctx, i));
      const output = walk(ctx, propType(ctx, type, "output") ?? bail());
      return tag === "Function" ? east.FunctionType(inputs, output) : east.AsyncFunctionType(inputs, output);
    }
    case "Recursive": {
      const node = propType(ctx, type, "node");
      if (node === void 0) {
        if (ctx.selves.length === 0)
          bail();
        return ctx.selves[ctx.selves.length - 1];
      }
      return ctx.east.RecursiveType((self) => {
        ctx.selves.push(self);
        try {
          return walk(ctx, node);
        } finally {
          ctx.selves.pop();
        }
      });
    }
    default:
      bail();
  }
}
function reifyRawValue(ctx, type) {
  const { t, east, checker } = ctx;
  const f = type.flags;
  if (f & (t.TypeFlags.BigInt | t.TypeFlags.BigIntLiteral))
    return east.IntegerType;
  if (f & (t.TypeFlags.Number | t.TypeFlags.NumberLiteral))
    return east.FloatType;
  if (f & (t.TypeFlags.String | t.TypeFlags.StringLiteral | t.TypeFlags.TemplateLiteral))
    return east.StringType;
  if (f & (t.TypeFlags.Boolean | t.TypeFlags.BooleanLiteral))
    return east.BooleanType;
  if (f & t.TypeFlags.Null)
    return east.NullType;
  if ((f & t.TypeFlags.Object) === 0)
    bail();
  const name = type.getSymbol()?.getName();
  switch (name) {
    case "Date":
      return east.DateTimeType;
    case "Uint8Array":
      return east.BlobType;
    case "Float64Array":
      return east.VectorType(east.FloatType);
    case "BigInt64Array":
      return east.VectorType(east.IntegerType);
    case "Uint8ClampedArray":
      return east.VectorType(east.BooleanType);
    case "Array":
    case "ReadonlyArray": {
      const [el] = typeArguments(ctx, type);
      if (el === void 0)
        bail();
      return east.ArrayType(reifyUnion(ctx, stripAbsent(ctx, el)));
    }
    case "Set":
    case "ReadonlySet": {
      const [el] = typeArguments(ctx, type);
      if (el === void 0)
        bail();
      return east.SetType(reifyUnion(ctx, stripAbsent(ctx, el)));
    }
    case "Map":
    case "ReadonlyMap": {
      const [k, v] = typeArguments(ctx, type);
      if (k === void 0 || v === void 0)
        bail();
      return east.DictType(reifyUnion(ctx, stripAbsent(ctx, k)), reifyUnion(ctx, stripAbsent(ctx, v)));
    }
    default:
      break;
  }
  if (checker.isTupleType(type)) {
    const elements = typeArguments(ctx, type).map((e) => reifyUnion(ctx, stripAbsent(ctx, e)));
    const distinct = new Set(elements);
    if (distinct.size !== 1)
      bail();
    return east.ArrayType(elements[0]);
  }
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0)
    bail();
  if (checker.getIndexInfosOfType(type).length > 0)
    bail();
  const props = checker.getPropertiesOfType(type);
  if (props.length === 0)
    bail();
  const fields = {};
  for (const prop of props) {
    const propName = prop.getName();
    if (propName.startsWith("__@"))
      continue;
    fields[propName] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
  }
  return east.StructType(fields);
}
function walk(ctx, type) {
  if (++ctx.depth > MAX_DEPTH)
    bail();
  try {
    if (type.isUnion())
      return reifyUnion(ctx, stripAbsent(ctx, type));
    const properties = type.getProperties();
    const exprTypeProp = properties.find((p) => p.getName().startsWith("__@TypeSymbol"));
    if (exprTypeProp !== void 0) {
      ctx.sawEastShape = true;
      return walk(ctx, ctx.checker.getTypeOfSymbol(exprTypeProp));
    }
    if (properties.some((p) => p.getName().startsWith("__@variant_symbol"))) {
      const caseName = literalString(propType(ctx, type, "type")) ?? bail();
      const payload = propType(ctx, type, "value") ?? bail();
      ctx.sawEastShape = true;
      return ctx.east.VariantType({ [caseName]: reifyUnion(ctx, stripAbsent(ctx, payload)) });
    }
    if (properties.some((p) => p.getName().startsWith("__@ref_symbol"))) {
      const v = propType(ctx, type, "value") ?? bail();
      ctx.sawEastShape = true;
      return ctx.east.RefType(reifyUnion(ctx, stripAbsent(ctx, v)));
    }
    const tag = literalString(propType(ctx, type, "type"));
    if (tag !== void 0) {
      try {
        const result = reifyEncoding(ctx, type, tag);
        ctx.sawEastShape = true;
        return result;
      } catch (e) {
        if (!(e instanceof Bail))
          throw e;
      }
    }
    return reifyRawValue(ctx, type);
  } finally {
    ctx.depth--;
  }
}
function reifyEastType(t, checker, type, east) {
  const ctx = { t, checker, east, depth: 0, selves: [], sawEastShape: false };
  try {
    return { type: walk(ctx, type), eastShaped: ctx.sawEastShape };
  } catch (e) {
    if (e instanceof Bail)
      return void 0;
    return void 0;
  }
}

// ../east-diagnostics/dist/src/type-diff-rewrite.js
var ASSIGNABILITY_CODES = /* @__PURE__ */ new Set([
  2322,
  // Type 'X' is not assignable to type 'Y'.
  2345,
  // Argument of type 'X' is not assignable to parameter of type 'Y'.
  2375,
  // Type 'X' is not assignable to type 'Y' with exactOptionalPropertyTypes.
  2379,
  // Getter/setter assignability variant of 2322.
  2412,
  // Property assignability with exactOptionalPropertyTypes.
  2719,
  // Type 'X' is not assignable to type 'Y'. Two different types with this name exist.
  2739,
  // Type 'X' is missing the following properties from type 'Y'.
  2740,
  // Type 'X' is missing the following properties from type 'Y' (array forms).
  2741
  // Property 'p' is missing in type 'X' but required in type 'Y'.
]);
function innermostNodeAt(t, sourceFile, position) {
  function find(node) {
    if (position < node.getStart(sourceFile) || position >= node.getEnd())
      return void 0;
    return t.forEachChild(node, find) ?? node;
  }
  return find(sourceFile);
}
function resolveTypePair(t, checker, node) {
  let current = node;
  for (let hops = 0; current !== void 0 && hops < 6; current = current.parent, hops++) {
    if (t.isVariableDeclaration(current) && current.type !== void 0 && current.initializer !== void 0) {
      return {
        actual: checker.getTypeAtLocation(current.initializer),
        expected: checker.getTypeFromTypeNode(current.type)
      };
    }
    if (t.isPropertyAssignment(current)) {
      const expected = checker.getContextualType(current.initializer);
      if (expected !== void 0) {
        return { actual: checker.getTypeAtLocation(current.initializer), expected };
      }
    }
    if (t.isExpression(current)) {
      const expected = checker.getContextualType(current);
      if (expected !== void 0) {
        return { actual: checker.getTypeAtLocation(current), expected };
      }
    }
  }
  return void 0;
}
function rewriteEastAssignability(t, program, sourceFile, diagnostic, east) {
  if (diagnostic.start === void 0 || !ASSIGNABILITY_CODES.has(diagnostic.code))
    return void 0;
  const checker = program.getTypeChecker();
  const node = innermostNodeAt(t, sourceFile, diagnostic.start);
  if (node === void 0)
    return void 0;
  const pair = resolveTypePair(t, checker, node);
  if (pair === void 0)
    return void 0;
  const actual = reifyEastType(t, checker, pair.actual, east);
  const expected = reifyEastType(t, checker, pair.expected, east);
  if (actual === void 0 || expected === void 0)
    return void 0;
  if (!actual.eastShaped && !expected.eastShaped)
    return void 0;
  if (expected.type === east.NeverType && actual.type !== east.NeverType)
    return void 0;
  let rendered;
  try {
    const diffs = east.diffTypes(actual.type, expected.type);
    if (!Array.isArray(diffs) || diffs.length === 0)
      return void 0;
    rendered = east.renderTypeDiff(diffs);
  } catch {
    return void 0;
  }
  if (rendered.length === 0)
    return void 0;
  return `East type mismatch: ${rendered.split("\n").join("; ")}`;
}

// ../east-diagnostics/dist/src/service.js
var MAX_MESSAGE_LENGTH = 300;
var MAX_REWRITTEN_LENGTH = 600;
function findNearestTsconfig(fromPath) {
  let dir = dirname(resolve(fromPath));
  for (; ; ) {
    const candidate = join2(dir, "tsconfig.json");
    if (existsSync(candidate))
      return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      return void 0;
    dir = parent;
  }
}
function loadTypeScript(projectDir) {
  try {
    return createRequire2(join2(projectDir, "_.js"))("typescript");
  } catch {
    return createRequire2(import.meta.url)("typescript");
  }
}
function toCategory(t, category) {
  if (category === t.DiagnosticCategory.Error)
    return "error";
  if (category === t.DiagnosticCategory.Warning)
    return "warning";
  return "suggestion";
}
function createDiagnosticsService(options = {}) {
  const projects = /* @__PURE__ */ new Map();
  const overlays = /* @__PURE__ */ new Map();
  function getProject(tsconfigPath) {
    const existing = projects.get(tsconfigPath);
    if (existing !== void 0)
      return existing;
    const projectDir = dirname(tsconfigPath);
    const t = loadTypeScript(projectDir);
    const configFile = t.readConfigFile(tsconfigPath, t.sys.readFile);
    const parsed = t.parseJsonConfigFileContent(configFile.config ?? {}, t.sys, projectDir);
    const project = {
      ts: t,
      service: void 0,
      rootFileNames: new Set(parsed.fileNames.map((f) => resolve(f))),
      adHoc: /* @__PURE__ */ new Set(),
      versions: /* @__PURE__ */ new Map()
    };
    const host = {
      getScriptFileNames: () => [...project.rootFileNames, ...project.adHoc],
      getScriptVersion: (f) => String(project.versions.get(resolve(f)) ?? 0),
      getScriptSnapshot: (f) => {
        const path = resolve(f);
        const overlay = overlays.get(path);
        if (overlay !== void 0)
          return t.ScriptSnapshot.fromString(overlay);
        if (!existsSync(path))
          return void 0;
        return t.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
      },
      getCurrentDirectory: () => projectDir,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => t.getDefaultLibFilePath(o),
      fileExists: (f) => overlays.has(resolve(f)) || t.sys.fileExists(f),
      readFile: t.sys.readFile,
      readDirectory: t.sys.readDirectory,
      directoryExists: t.sys.directoryExists,
      getDirectories: t.sys.getDirectories
    };
    if (t.sys.realpath !== void 0)
      host.realpath = t.sys.realpath;
    project.service = t.createLanguageService(host, t.createDocumentRegistry());
    projects.set(tsconfigPath, project);
    return project;
  }
  function analyze(filePath) {
    const file = resolve(filePath);
    const tsconfigPath = findNearestTsconfig(file);
    if (tsconfigPath === void 0)
      return void 0;
    const project = getProject(tsconfigPath);
    const t = project.ts;
    if (!project.rootFileNames.has(file))
      project.adHoc.add(file);
    project.versions.set(file, (project.versions.get(file) ?? 0) + 1);
    const program = project.service.getProgram();
    const sourceFile = program?.getSourceFile(file);
    if (program === void 0 || sourceFile === void 0)
      return void 0;
    const native = [
      ...project.service.getSemanticDiagnostics(file),
      ...project.service.getSyntacticDiagnostics(file)
    ];
    const projectDir = dirname(tsconfigPath);
    const nativeDiagnostics = native.flatMap((d) => {
      if (d.start === void 0 || d.length === void 0)
        return [];
      let message = t.flattenDiagnosticMessageText(d.messageText, " ");
      let maxLength = MAX_MESSAGE_LENGTH;
      if (ASSIGNABILITY_CODES.has(d.code)) {
        const east = getEastModule(projectDir);
        const rewritten = east !== void 0 ? rewriteEastAssignability(t, program, sourceFile, d, east) : void 0;
        if (rewritten !== void 0) {
          message = rewritten;
          maxLength = MAX_REWRITTEN_LENGTH;
        }
      }
      return [{
        ruleName: "tsc",
        code: d.code,
        start: d.start,
        length: d.length,
        messageText: message.length > maxLength ? `${message.slice(0, maxLength)}\u2026` : message,
        category: toCategory(t, d.category)
      }];
    });
    const ruleDiagnostics = runEastRules(t, program, sourceFile, program.getTypeChecker(), options.rulesOptions ?? {}, options.rules);
    const diagnostics = [...nativeDiagnostics, ...ruleDiagnostics].sort((a, b) => a.start - b.start);
    return { diagnostics, sourceFile };
  }
  return {
    diagnose(filePath) {
      return analyze(filePath)?.diagnostics ?? [];
    },
    diagnoseText(filePath) {
      const result = analyze(filePath);
      if (result === void 0 || result.diagnostics.length === 0)
        return "";
      const { diagnostics, sourceFile } = result;
      const lines = diagnostics.map((d) => {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
        const label = d.ruleName === "tsc" ? `TS${d.code}` : d.ruleName;
        return `- [${d.category}] ${line + 1}:${character + 1} (${label}) ${d.messageText}`;
      });
      return ["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n");
    },
    warm(fromDir) {
      const tsconfigPath = findNearestTsconfig(join2(resolve(fromDir), "_.ts"));
      if (tsconfigPath === void 0)
        return false;
      const project = getProject(tsconfigPath);
      const [firstRoot] = project.rootFileNames;
      if (firstRoot !== void 0)
        project.service.getSemanticDiagnostics(firstRoot);
      else
        project.service.getProgram();
      return true;
    },
    setOverlay(filePath, content) {
      overlays.set(resolve(filePath), content);
    },
    clearOverlay(filePath) {
      overlays.delete(resolve(filePath));
    },
    dispose() {
      projects.clear();
      overlays.clear();
    }
  };
}

// daemon/server.ts
var socketPath = process.env["EAST_DIAG_SOCKET"];
if (socketPath === void 0) process.exit(1);
var service = createDiagnosticsService();
var IDLE_MS = 10 * 60 * 1e3;
var idleTimer;
function armIdle() {
  if (idleTimer !== void 0) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    server.close();
    process.exit(0);
  }, IDLE_MS);
  idleTimer.unref();
}
var server = createServer((conn) => {
  armIdle();
  let buffer = "";
  conn.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    let response;
    try {
      const request = JSON.parse(buffer.slice(0, newline));
      const text = typeof request.file === "string" ? service.diagnoseText(request.file) : "";
      response = JSON.stringify({ ok: true, text });
    } catch (error) {
      response = JSON.stringify({ ok: false, error: String(error) });
    }
    conn.end(`${response}
`);
  });
  conn.on("error", () => void 0);
});
if (existsSync2(socketPath)) {
  try {
    unlinkSync(socketPath);
  } catch {
  }
}
server.on("error", () => process.exit(1));
server.listen(socketPath, () => {
  armIdle();
  const cwd = process.env["EAST_DIAG_CWD"];
  if (cwd !== void 0 && cwd !== "") {
    setImmediate(() => {
      try {
        service.warm(cwd);
      } catch {
      }
    });
  }
});
