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
function someTypeName(type, match) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === void 0 || seen.has(current))
      continue;
    seen.add(current);
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== void 0 && match(name))
      return true;
    if (current.isUnionOrIntersection())
      stack.push(...current.types);
  }
  return false;
}
function isEastPlatformDefinitionType(type) {
  return someTypeName(type, (name) => name.endsWith("PlatformDefinition"));
}
var E3_DEFINITION_NAMES = /* @__PURE__ */ new Set([
  "TaskDef",
  "DatasetDef",
  "DataTreeDef",
  "FunctionDef",
  "MutationDef",
  "RecordDef",
  "PackageDef"
]);
function isEastDefinitionType(type) {
  return someTypeName(type, (name) => E3_DEFINITION_NAMES.has(name) || name.endsWith("PlatformDefinition"));
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
function isEastValueCall(expr, t) {
  if (!t.isCallExpression(expr))
    return false;
  const callee = expr.expression;
  return t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && callee.name.text === "value";
}
function report(ctx, target, messageText, fixDescription, newText) {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  const length = target.getEnd() - start;
  ctx.report({
    ruleName: NAME,
    code: CODE,
    start,
    length,
    messageText,
    category: "warning",
    fix: { description: fixDescription, changes: [{ start, length, newText }] }
  });
}
var noRedundantEastCast = {
  name: NAME,
  code: CODE,
  description: "Disallow TypeScript type info on the value of $.let/$.const that the East type argument already governs (a cast, `new Map<K,V>()` generics, or an `East.value(x,T)` wrapper).",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === void 0)
      return;
    const t = ctx.ts;
    const value = match.args[0];
    if (value === void 0)
      return;
    const sf = ctx.sourceFile;
    if (isEastValueCall(value, t)) {
      const inner = value.arguments[0];
      if (inner === void 0)
        return;
      const typeArg = match.args[1] ?? value.arguments[1];
      const receiverText = match.call.expression.getText(sf);
      const newText = `${receiverText}(${inner.getText(sf)}${typeArg !== void 0 ? `, ${typeArg.getText(sf)}` : ""})`;
      report(ctx, match.call, `Redundant \`East.value(...)\` inside \`$.${match.method}\`: pass the value (and its East type) to \`$.${match.method}\` directly.`, "Lift the value and type out of East.value(...)", newText);
      return;
    }
    if (match.args.length < 2)
      return;
    let cast;
    if (t.isAsExpression(value))
      cast = value.expression;
    else if (t.isTypeAssertionExpression(value))
      cast = value.expression;
    if (cast !== void 0) {
      report(ctx, value, `Redundant cast: \`$.${match.method}\` infers the value type from the East type argument; drop the \`as \u2026\` on the value.`, "Remove redundant cast", cast.getText(sf));
      return;
    }
    if (t.isNewExpression(value) && value.typeArguments !== void 0 && value.typeArguments.length > 0) {
      const ctorArgs = (value.arguments ?? []).map((a) => a.getText(sf)).join(", ");
      report(ctx, value, `Redundant type arguments: \`$.${match.method}\` infers the value type from the East type argument; drop the \`<\u2026>\` on \`new ${value.expression.getText(sf)}\`.`, "Remove redundant constructor type arguments", `new ${value.expression.getText(sf)}(${ctorArgs})`);
    }
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

// ../east-diagnostics/dist/src/east-source.js
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function importDeclarationOf(sym, t) {
  for (const d of sym?.declarations ?? []) {
    let n = d;
    if (t.isImportSpecifier(n))
      n = n.parent.parent.parent;
    else if (t.isNamespaceImport(n))
      n = n.parent.parent;
    else if (t.isImportClause(n))
      n = n.parent;
    else
      continue;
    if (t.isImportDeclaration(n))
      return n;
  }
  return void 0;
}
function resolvesToEastImport(id, checker, t) {
  const imp = importDeclarationOf(checker.getSymbolAtLocation(id), t);
  return imp !== void 0 && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text.startsWith("@elaraai/");
}
var importsCache = /* @__PURE__ */ new WeakMap();
function importsEastPackage(sf, t) {
  const cached = importsCache.get(sf);
  if (cached !== void 0)
    return cached;
  let found = false;
  for (const stmt of sf.statements) {
    if (!t.isImportDeclaration(stmt) && !t.isExportDeclaration(stmt))
      continue;
    const spec = stmt.moduleSpecifier;
    if (spec !== void 0 && t.isStringLiteral(spec) && spec.text.startsWith("@elaraai/")) {
      found = true;
      break;
    }
  }
  importsCache.set(sf, found);
  return found;
}
function unresolvedEastImport(sf, checker, t) {
  for (const stmt of sf.statements) {
    if (!t.isImportDeclaration(stmt) && !t.isExportDeclaration(stmt))
      continue;
    const spec = stmt.moduleSpecifier;
    if (spec === void 0 || !t.isStringLiteral(spec) || spec.text !== "@elaraai/east")
      continue;
    if (checker.getSymbolAtLocation(spec) === void 0)
      return true;
  }
  return false;
}
var declaresCache = /* @__PURE__ */ new WeakMap();
var E3_DECLARATION_MEMBERS = /* @__PURE__ */ new Set([
  "input",
  "task",
  "customTask",
  "function",
  "record",
  "mutation",
  "package",
  "export"
]);
function declaresEastProgram(sf, checker, t) {
  const cached = declaresCache.get(sf);
  if (cached !== void 0)
    return cached;
  let found = false;
  const visit = (n) => {
    if (found)
      return;
    if (t.isCallExpression(n)) {
      const callee = n.expression;
      if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression)) {
        const root = callee.expression;
        if (root.text === "East" && resolvesToEastImport(root, checker, t)) {
          found = true;
          return;
        }
        if (E3_DECLARATION_MEMBERS.has(callee.name.text)) {
          const imp = importDeclarationOf(checker.getSymbolAtLocation(root), t);
          if (imp !== void 0 && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3") {
            found = true;
            return;
          }
        }
      } else if (t.isIdentifier(callee) && callee.text === "ui" && resolvesToEastImport(callee, checker, t)) {
        found = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(sf);
  declaresCache.set(sf, found);
  return found;
}
var pkgDirCache = /* @__PURE__ */ new Map();
function packageDirOf(p) {
  const start = dirname(resolve(p));
  if (pkgDirCache.has(start))
    return pkgDirCache.get(start);
  let dir = start;
  let result;
  for (; ; ) {
    if (existsSync(join(dir, "package.json"))) {
      result = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  pkgDirCache.set(start, result);
  return result;
}
function resolvesWithinOwnPackage(sourceFileName, specifierText) {
  try {
    const own = packageDirOf(sourceFileName);
    if (own === void 0)
      return false;
    const targetAbs = resolve(dirname(sourceFileName), specifierText);
    return packageDirOf(targetAbs) === own;
  } catch {
    return true;
  }
}

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
    if (!resolvesToEastImport(callee, ctx.checker, t))
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
function insideReactive(node, t) {
  let cur = node.parent;
  while (cur !== void 0) {
    if (t.isJsxElement(cur) && cur.openingElement.tagName.getText().endsWith("Reactive"))
      return true;
    if (t.isJsxSelfClosingElement(cur) && cur.tagName.getText().endsWith("Reactive"))
      return true;
    if (t.isCallExpression(cur)) {
      const callee = cur.expression;
      if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "Reactive") {
        return true;
      }
    }
    cur = cur.parent;
  }
  return false;
}

// ../east-diagnostics/dist/src/rules/prefer-let-const-over-east-value.js
var NAME6 = "prefer-let-const-over-east-value";
var CODE6 = 990006;
function typeIsLoadBearing(value, t) {
  let found = false;
  const emptyArray = (n) => n !== void 0 && t.isArrayLiteralExpression(n) && n.elements.length === 0;
  const visit = (n) => {
    if (found)
      return;
    if (t.isIdentifier(n) && n.text === "none")
      found = true;
    else if (emptyArray(n))
      found = true;
    else if (t.isNewExpression(n) && t.isIdentifier(n.expression) && (n.expression.text === "Map" || n.expression.text === "Set") && (n.arguments === void 0 || n.arguments.length === 0 || emptyArray(n.arguments[0])))
      found = true;
    else if (t.isCallExpression(n) && t.isIdentifier(n.expression) && (n.expression.text === "variant" || n.expression.text === "some"))
      found = true;
    else
      t.forEachChild(n, visit);
  };
  visit(value);
  return found;
}
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
    const inner = node.arguments[0];
    if ((asReturn || asCallbackBody) && node.arguments.length >= 2 && inner !== void 0 && typeIsLoadBearing(inner, t))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
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
    if (relativeIntoSrc && !deepPackageSrc && resolvesWithinOwnPackage(ctx.sourceFile.fileName, text))
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
    const allowed = t.isVariableDeclaration(parent) && parent.initializer === current || t.isExpressionStatement(parent) && parent.expression === current || t.isReturnStatement(parent) && parent.expression === current || t.isArrowFunction(parent) && parent.body === current;
    if (allowed)
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

// ../east-diagnostics/dist/src/east-ir.js
function chainRootReceiver(node, ctx) {
  const t = ctx.ts;
  let root = node;
  for (; ; ) {
    if (t.isCallExpression(root))
      root = root.expression;
    else if (t.isPropertyAccessExpression(root) || t.isElementAccessExpression(root)) {
      root = root.expression;
    } else {
      return root;
    }
  }
}
function bodyBuildsEastIr(body, ctx) {
  const t = ctx.ts;
  let found = false;
  const visit = (n) => {
    if (found)
      return;
    if (isBlockBuilderCallback(n, ctx))
      return;
    if (t.isCallExpression(n)) {
      if (matchBlockBuilderCall(n, ctx) !== void 0 || isBlockBuilderType(ctx.checker.getTypeAtLocation(chainRootReceiver(n.expression, ctx)))) {
        found = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

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
    const root = chainRootReceiver(expr, ctx);
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

// ../east-diagnostics/dist/src/rules/prefer-jsx-over-factory-call.js
var NAME11 = "prefer-jsx-over-factory-call";
var CODE11 = 990012;
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
  name: NAME11,
  code: CODE11,
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
      ruleName: NAME11,
      code: CODE11,
      start,
      length: callee.getEnd() - start,
      messageText: `Author this with the \`<${tagName}>\` JSX tag instead of \`${factoryIdent.text}.Root(...)\` \u2014 in a .tsx file the JSX tag is the authoring surface (the call already produces a JSX element).`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-untracked-east-data.js
var NAME12 = "no-untracked-east-data";
var CODE12 = 990013;
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
  name: NAME12,
  code: CODE12,
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
      ruleName: NAME12,
      code: CODE12,
      start,
      length: node.getEnd() - start,
      messageText: `Bare \`const ${node.text} = \u2026\` isn't tracked by the East block builder. Bind East data with \`$.const([...], Type)\` (or \`$.let\`) so the binding carries its East type and is evaluated once.`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-compile-time-data-injection.js
var NAME13 = "no-compile-time-data-injection";
var CODE13 = 990015;
var FS_MODULES = /* @__PURE__ */ new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
function fire(ctx, target, messageText) {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  ctx.report({ ruleName: NAME13, code: CODE13, start, length: target.getEnd() - start, messageText, category: "warning" });
}
function importOfSymbol(sym, t) {
  for (const d of sym?.declarations ?? []) {
    let n = d;
    if (t.isImportSpecifier(n))
      n = n.parent.parent.parent;
    else if (t.isNamespaceImport(n))
      n = n.parent.parent;
    else if (t.isImportClause(n))
      n = n.parent;
    else
      continue;
    if (t.isImportDeclaration(n))
      return n;
  }
  return void 0;
}
function resolvesToFsImport(id, ctx) {
  const t = ctx.ts;
  const imp = importOfSymbol(ctx.checker.getSymbolAtLocation(id), t);
  return imp !== void 0 && t.isStringLiteral(imp.moduleSpecifier) && FS_MODULES.has(imp.moduleSpecifier.text);
}
function insidePlatformImplement(node, t) {
  let cur = node.parent;
  while (cur !== void 0) {
    if (t.isCallExpression(cur) && t.isPropertyAccessExpression(cur.expression) && cur.expression.name.text === "implement") {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}
function isProcessEnv(node, t) {
  return t.isPropertyAccessExpression(node) && t.isIdentifier(node.expression) && node.expression.text === "process" && node.name.text === "env";
}
var noCompileTimeDataInjection = {
  name: NAME13,
  code: CODE13,
  description: "Flag build-time data ingestion (a node:fs import or call, JSON.parse, process.env) at module scope \u2014 load data at runtime via e3.input / datasets / platform tasks.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
    if (!declaresEastProgram(ctx.sourceFile, ctx.checker, t))
      return;
    if (t.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (t.isStringLiteral(spec) && FS_MODULES.has(spec.text)) {
        fire(ctx, node, `Importing \`${spec.text}\` into East/e3 source bakes build-time file I/O into the deployed program. Read data at runtime via \`e3.input\` / a dataset, or an \`east-node-io\` platform task.`);
      }
      return;
    }
    if (insideBlockScope(node, ctx))
      return;
    if (insidePlatformImplement(node, t))
      return;
    if (isProcessEnv(node, t)) {
      fire(ctx, node, "Reading `process.env` at module scope couples the deployed program to its build environment. Make it an `e3.input` / dataset parameter.");
      return;
    }
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    const base = t.isIdentifier(callee) ? callee : t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) ? callee.expression : void 0;
    if (base !== void 0 && resolvesToFsImport(base, ctx)) {
      fire(ctx, node, "This `node:fs` call reads/probes the filesystem at build/deploy time and bakes the result into the program. Ingest at runtime via `e3.input` / a dataset / an `east-node-io` task.");
      return;
    }
    if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "JSON" && callee.name.text === "parse") {
      fire(ctx, node, "`JSON.parse(...)` at module scope bakes parsed data into the program. Load it at runtime via `e3.input` / a dataset.");
    }
  }
};

// ../east-diagnostics/dist/src/rules/no-compile-time-seed-data.js
var NAME14 = "no-compile-time-seed-data";
var CODE14 = 990021;
function fire2(ctx, target, messageText) {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  ctx.report({ ruleName: NAME14, code: CODE14, start, length: target.getEnd() - start, messageText, category: "warning" });
}
function isE3InputCall(node, ctx) {
  const t = ctx.ts;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "input")
    return false;
  if (!t.isIdentifier(callee.expression))
    return false;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(callee.expression), t);
  return imp !== void 0 && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3";
}
function rootIdentifier(node, t) {
  let cur = node;
  for (; ; ) {
    if (t.isPropertyAccessExpression(cur) || t.isElementAccessExpression(cur))
      cur = cur.expression;
    else if (t.isCallExpression(cur))
      cur = cur.expression;
    else
      break;
  }
  return t.isIdentifier(cur) ? cur : void 0;
}
var VALUE_CTORS = /* @__PURE__ */ new Set([
  "Map",
  "Set",
  "Date",
  "ArrayBuffer",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array"
]);
function embedsHostComputation(expr, ctx) {
  const t = ctx.ts;
  let bad = false;
  const visit = (n) => {
    if (bad)
      return;
    if (t.isCallExpression(n)) {
      const root = rootIdentifier(n.expression, t);
      if (root === void 0 || !resolvesToEastImport(root, ctx.checker, t)) {
        bad = true;
        return;
      }
    } else if (t.isNewExpression(n)) {
      const ctor = n.expression;
      const ok = t.isIdentifier(ctor) && (VALUE_CTORS.has(ctor.text) || resolvesToEastImport(ctor, ctx.checker, t));
      if (!ok) {
        bad = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(expr);
  return bad;
}
var MUTATORS = /* @__PURE__ */ new Set(["set", "add", "push", "unshift", "splice", "delete", "clear", "fill", "sort", "copyWithin", "pop", "shift"]);
function isAssignmentOp(kind, t) {
  const k = t.SyntaxKind;
  return kind === k.EqualsToken || kind === k.PlusEqualsToken || kind === k.MinusEqualsToken || kind === k.AsteriskEqualsToken || kind === k.SlashEqualsToken || kind === k.PercentEqualsToken || kind === k.AmpersandEqualsToken || kind === k.BarEqualsToken || kind === k.CaretEqualsToken || kind === k.LessThanLessThanEqualsToken || kind === k.GreaterThanGreaterThanEqualsToken || kind === k.GreaterThanGreaterThanGreaterThanEqualsToken || kind === k.AsteriskAsteriskEqualsToken || kind === k.QuestionQuestionEqualsToken || kind === k.BarBarEqualsToken || kind === k.AmpersandAmpersandEqualsToken;
}
function insideLoop(node, t) {
  let cur = node.parent;
  while (cur !== void 0) {
    if (t.isForStatement(cur) || t.isForOfStatement(cur) || t.isForInStatement(cur) || t.isWhileStatement(cur) || t.isDoStatement(cur)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}
function isHostFilled(sym, ctx) {
  const t = ctx.ts;
  let filled = false;
  const isSym = (n) => t.isIdentifier(n) && ctx.checker.getSymbolAtLocation(n) === sym;
  const visit = (n) => {
    if (filled)
      return;
    if (t.isCallExpression(n) && t.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text) && isSym(n.expression.expression)) {
      if (insideLoop(n, t) || n.arguments.some((a) => embedsHostComputation(a, ctx))) {
        filled = true;
        return;
      }
    }
    if (t.isBinaryExpression(n) && isAssignmentOp(n.operatorToken.kind, t)) {
      const root = rootIdentifier(n.left, t);
      if (root !== void 0 && isSym(root) && (insideLoop(n, t) || embedsHostComputation(n.right, ctx))) {
        filled = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(ctx.sourceFile);
  return filled;
}
var noCompileTimeSeedData = {
  name: NAME14,
  code: CODE14,
  description: "Flag host-computed data passed as the seed (3rd arg) of e3.input \u2014 the default must be a small authored constant; load real data at runtime.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) || !isE3InputCall(node, ctx))
      return;
    if (insideBlockScope(node, ctx))
      return;
    const seedArg = node.arguments[2];
    if (seedArg === void 0)
      return;
    let expr = seedArg;
    let sym;
    if (t.isIdentifier(seedArg)) {
      sym = ctx.checker.getSymbolAtLocation(seedArg);
      const decl = sym?.valueDeclaration;
      if (decl === void 0 || !t.isVariableDeclaration(decl) || decl.initializer === void 0)
        return;
      expr = decl.initializer;
    }
    while (t.isAsExpression(expr) || t.isSatisfiesExpression(expr) || t.isParenthesizedExpression(expr)) {
      expr = expr.expression;
    }
    const hostComputed = embedsHostComputation(expr, ctx);
    const hostFilled = sym !== void 0 && isHostFilled(sym, ctx);
    if (!hostComputed && !hostFilled)
      return;
    const nameArg = node.arguments[0];
    const name = nameArg !== void 0 && t.isStringLiteralLike(nameArg) ? nameArg.text : "\u2026";
    const reason = hostFilled ? "this seed is an authored-empty collection then filled in place by host code (a `for`-loop / `.set(...)`)" : "this seed is assembled by host calls (`num(...)`, `BigInt(...)`, parsed config) at module-evaluation time";
    fire2(ctx, seedArg, `Host-computed data passed as the \`e3.input("${name}", \u2026)\` seed bakes a build-time snapshot into the deployed program \u2014 ${reason}. The default (3rd arg) must be a small AUTHORED CONSTANT (a literal, an empty/literal Map/Set/array/struct, or an East value \`variant\`/\`some\`/\`none\`/\`East.value\`) or omitted. Load real/bulk data at RUNTIME: put the bytes in a \`BlobType\` input and parse with \`blob.decodeCsv(...)\` inside an \`e3.task\`, read files in a task via a platform \`FileSystem.readFile\`, or use \`e3.record(...)\` + \`e3.mutation\` for set-once root state.`);
  }
};

// ../east-diagnostics/dist/src/rules/no-host-in-east-block.js
var NAME15 = "no-host-in-east-block";
var CODE15 = 990020;
function resolvesToInBlockEastBinding(id, ctx) {
  const t = ctx.ts;
  const sym = ctx.checker.getSymbolAtLocation(id);
  for (const d of sym?.declarations ?? []) {
    if (t.isFunctionDeclaration(d) && d.body !== void 0 && insideBlockScope(d, ctx))
      return true;
    if (t.isVariableDeclaration(d) && d.initializer !== void 0 && (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer)) && insideBlockScope(d, ctx)) {
      return true;
    }
    if (t.isParameter(d)) {
      const fn = d.parent;
      if ((t.isArrowFunction(fn) || t.isFunctionExpression(fn) || t.isFunctionDeclaration(fn)) && insideBlockScope(fn, ctx)) {
        const first = fn.parameters[0];
        if (first === void 0 || !isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name)))
          return true;
      }
    }
  }
  return false;
}
function isEastCall(call, ctx) {
  const t = ctx.ts;
  const f = call.expression;
  if (isEastExprType(ctx.checker.getTypeAtLocation(f)))
    return true;
  const root = chainRootReceiver(f, ctx);
  if (isBlockBuilderType(ctx.checker.getTypeAtLocation(root)))
    return true;
  if (t.isPropertyAccessExpression(f) && isEastExprType(ctx.checker.getTypeAtLocation(f.expression)))
    return true;
  if (t.isIdentifier(root) && resolvesToEastImport(root, ctx.checker, t))
    return true;
  if (t.isPropertyAccessExpression(f) && t.isIdentifier(root) && resolvesToInBlockEastBinding(root, ctx))
    return true;
  if (isEastPlatformDefinitionType(ctx.checker.getTypeAtLocation(f)))
    return true;
  if (isJsxCompositionCall(call, ctx))
    return true;
  if (t.isPropertyAccessExpression(f) && isLibDeclaredEastCall(call, f, ctx))
    return true;
  if (isConstantFoldCall(call, ctx))
    return true;
  return false;
}
function isConstantFoldCall(call, ctx) {
  const t = ctx.ts;
  if ((ctx.checker.getTypeAtLocation(call).flags & t.TypeFlags.StringLike) === 0)
    return false;
  let constant = true;
  const visit = (n) => {
    if (!constant)
      return;
    if (t.isIdentifier(n)) {
      const p = n.parent;
      if (p !== void 0 && t.isPropertyAccessExpression(p) && p.name === n)
        return;
      constant = false;
      return;
    }
    if (t.isTemplateExpression(n)) {
      constant = false;
      return;
    }
    t.forEachChild(n, visit);
  };
  visit(call);
  return constant;
}
function isLibDeclaredEastCall(call, f, ctx) {
  if (!isEastExprType(ctx.checker.getTypeAtLocation(call)))
    return false;
  const inPackageDts = (sym) => (sym?.declarations ?? []).some((d) => {
    const sf = d.getSourceFile();
    if (!sf.isDeclarationFile)
      return false;
    if (ctx.program !== void 0)
      return !ctx.program.isSourceFileDefaultLibrary(sf);
    return !/\/lib\.[^/]*\.d\.ts$/.test(sf.fileName);
  });
  if (inPackageDts(ctx.checker.getSymbolAtLocation(f)))
    return true;
  const receiverType = ctx.checker.getTypeAtLocation(f.expression);
  if (inPackageDts(receiverType.aliasSymbol ?? receiverType.symbol))
    return true;
  return rootBuiltByEastFactory(chainRootReceiver(f, ctx), ctx);
}
function rootBuiltByEastFactory(root, ctx) {
  const t = ctx.ts;
  if (!t.isIdentifier(root))
    return false;
  let sym = ctx.checker.getSymbolAtLocation(root);
  if (sym !== void 0 && (sym.flags & t.SymbolFlags.Alias) !== 0) {
    sym = ctx.checker.getAliasedSymbol(sym);
  }
  const decl = sym?.valueDeclaration;
  if (decl === void 0 || !t.isVariableDeclaration(decl) || decl.initializer === void 0)
    return false;
  let init2 = decl.initializer;
  while (t.isParenthesizedExpression(init2))
    init2 = init2.expression;
  if (!t.isCallExpression(init2))
    return false;
  const initRoot = chainRootReceiver(init2.expression, ctx);
  return t.isIdentifier(initRoot) && resolvesToEastImport(initRoot, ctx.checker, t);
}
function isJsxCompositionCall(call, ctx) {
  const t = ctx.ts;
  if (call.arguments.some((a) => isJsx(a, t) || (t.isArrowFunction(a) || t.isFunctionExpression(a)) && returnExpressions(a, t).some((r) => isJsx(r, t)))) {
    return true;
  }
  const f = call.expression;
  if (!t.isIdentifier(f))
    return false;
  const sym = ctx.checker.getSymbolAtLocation(f);
  for (const d of sym?.declarations ?? []) {
    let fn;
    if (t.isFunctionDeclaration(d) && d.body !== void 0)
      fn = d;
    else if (t.isVariableDeclaration(d) && d.initializer !== void 0 && (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer))) {
      fn = d.initializer;
    }
    if (fn !== void 0 && returnExpressions(fn, t).some((r) => isJsx(r, t)))
      return true;
  }
  return false;
}
function isEast(expr, ctx) {
  return isEastExprType(ctx.checker.getTypeAtLocation(expr));
}
function insideJsx(node, ctx) {
  const t = ctx.ts;
  let cur = node.parent;
  while (cur !== void 0) {
    if (t.isJsxElement(cur) || t.isJsxSelfClosingElement(cur) || t.isJsxFragment(cur) || t.isJsxExpression(cur) || t.isJsxAttribute(cur)) {
      return true;
    }
    if (t.isArrowFunction(cur) || t.isFunctionExpression(cur) || t.isFunctionDeclaration(cur) || t.isMethodDeclaration(cur)) {
      return false;
    }
    cur = cur.parent;
  }
  return false;
}
function isJsx(node, t) {
  return t.isJsxElement(node) || t.isJsxFragment(node) || t.isJsxSelfClosingElement(node) || t.isParenthesizedExpression(node) && isJsx(node.expression, t);
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
var REPORT = (ctx, target, messageText, fix) => {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  const length = target.getEnd() - start;
  ctx.report({
    ruleName: NAME15,
    code: CODE15,
    start,
    length,
    messageText,
    category: "warning",
    ...fix !== void 0 ? { fix: { description: fix.description, changes: [{ start, length, newText: fix.newText }] } } : {}
  });
};
var noHostInEastBlock = {
  name: NAME15,
  code: CODE15,
  description: "Flag host-language constructs (host calls, operators on East operands, JS control-flow, host string interpolation) inside an East block \u2014 express them in East.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!insideBlockScope(node, ctx))
      return;
    if (insideJsx(node, ctx))
      return;
    {
      let fn;
      let reportNode;
      if (t.isFunctionDeclaration(node) && node.body !== void 0) {
        fn = node;
        reportNode = node.name ?? node;
      } else if (t.isVariableDeclaration(node) && node.initializer !== void 0 && (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))) {
        fn = node.initializer;
        reportNode = node.name;
      }
      if (fn !== void 0 && reportNode !== void 0) {
        const first = fn.parameters[0];
        if (first !== void 0 && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name)))
          return;
        if (returnExpressions(fn, t).some((r) => isJsx(r, t)))
          return;
        REPORT(ctx, reportNode, "TS closure/function declared inside an East block \u2014 an authoring-time macro (it can't be serialized or recursed and expands inline at each call). Make it a real `East.function` (`$.const(East.function(...))`) or inline it.");
        return;
      }
    }
    if (t.isForStatement(node) || t.isWhileStatement(node) || t.isForOfStatement(node)) {
      if (t.isForOfStatement(node) && isEast(node.expression, ctx))
        return;
      if (!bodyBuildsEastIr(node.statement, ctx))
        return;
      REPORT(ctx, node.getChildAt(0, ctx.sourceFile), "Host loop building East IR \u2014 bind the data with `$.const([...], ArrayType(...))` and use an East collection op (`data.map(($, x) => \u2026)`) or `$.for(data, ($, x) => \u2026)`.");
      return;
    }
    if (t.isIfStatement(node)) {
      const emits = bodyBuildsEastIr(node.thenStatement, ctx) || node.elseStatement !== void 0 && bodyBuildsEastIr(node.elseStatement, ctx);
      if (!emits)
        return;
      REPORT(ctx, node.getChildAt(0, ctx.sourceFile), "Host `if` building East IR \u2014 use East's `$.if(cond, \u2026)` so the branch is chosen at East runtime.");
      return;
    }
    if (t.isConditionalExpression(node)) {
      if (isEast(node.condition, ctx) && isEast(node.whenTrue, ctx) && isEast(node.whenFalse, ctx)) {
        const sf = ctx.sourceFile;
        REPORT(ctx, node, "Host `?:` selecting between East values \u2014 use `cond.ifElse(() => a, () => b)`.", {
          description: "Rewrite as cond.ifElse(...)",
          newText: `(${node.condition.getText(sf)}).ifElse(() => ${node.whenTrue.getText(sf)}, () => ${node.whenFalse.getText(sf)})`
        });
      }
      return;
    }
    if (t.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const k = t.SyntaxKind;
      const logical = op === k.AmpersandAmpersandToken || op === k.BarBarToken;
      const arith = op === k.PlusToken || op === k.MinusToken || op === k.AsteriskToken || op === k.SlashToken || op === k.PercentToken || op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken || op === k.EqualsEqualsToken || op === k.LessThanToken || op === k.LessThanEqualsToken || op === k.GreaterThanToken || op === k.GreaterThanEqualsToken;
      if (logical && isEast(node.left, ctx) && isEast(node.right, ctx)) {
        REPORT(ctx, node, "Host `&&`/`||` on East booleans \u2014 use East's `.and(() => \u2026)` / `.or(() => \u2026)`.");
      } else if (arith && (isEast(node.left, ctx) || isEast(node.right, ctx))) {
        REPORT(ctx, node, "Host operator on an East value \u2014 use the East method (`.add`/`.subtract`/`.multiply`/`.divide`) or `East.equal`/`East.less`/`East.greater`.");
      }
      return;
    }
    if (t.isPrefixUnaryExpression(node) && (node.operator === t.SyntaxKind.MinusToken || node.operator === t.SyntaxKind.ExclamationToken)) {
      if (isEast(node.operand, ctx)) {
        REPORT(ctx, node, "Host unary operator on an East value \u2014 use `.negate()` / `East.not`.");
      }
      return;
    }
    if (t.isElementAccessExpression(node)) {
      if (isEast(node.expression, ctx))
        return;
      REPORT(ctx, node, "Host index access on a JS value inside an East block \u2014 model the data as an East collection and read it with `.get(...)` / East ops, not `[i]`.");
      return;
    }
    if (t.isTemplateExpression(node) && !(node.parent !== void 0 && t.isTaggedTemplateExpression(node.parent))) {
      REPORT(ctx, node, "Host string interpolation inside an East block \u2014 build the string in East with `East.str`\u2026`` (or `str`\u2026``).");
      return;
    }
    if (t.isCallExpression(node)) {
      if (isEastCall(node, ctx))
        return;
      const callee = node.expression;
      const KEY_ACCESSORS = /* @__PURE__ */ new Set(["get", "tryGet", "has", "insert", "insertOrUpdate", "update", "remove"]);
      REPORT(ctx, node, t.isPropertyAccessExpression(callee) && KEY_ACCESSORS.has(callee.name.text) ? "Host call inside an East block \u2014 make it a real `East.function` (`$.const(East.function(...))`) or inline it as East." : "Host call inside an East block \u2014 this is an authoring-time macro over East. Make it a real `East.function` (`$.const(East.function(...))`), inline it as East, or use the East stdlib.");
    }
  }
};

// ../east-diagnostics/dist/src/rules/no-module-scope-east-macro.js
var NAME16 = "no-module-scope-east-macro";
var CODE16 = 990011;
var VALUE_CONSTRUCTORS = /* @__PURE__ */ new Set(["variant", "some"]);
function unparen(e, t) {
  let cur = e;
  while (t.isParenthesizedExpression(cur))
    cur = cur.expression;
  return cur;
}
function isJsx2(node, t) {
  return t.isJsxElement(node) || t.isJsxFragment(node) || t.isJsxSelfClosingElement(node) || t.isParenthesizedExpression(node) && isJsx2(node.expression, t);
}
function isHostTemplate(e, t) {
  return t.isTemplateExpression(unparen(e, t));
}
function isEastValueConstructor(expr, t) {
  if (t.isCallExpression(expr)) {
    const callee = expr.expression;
    if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text))
      return true;
    return t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && callee.name.text === "value";
  }
  return t.isIdentifier(expr) && expr.text === "none";
}
function isEastBuilderCall(call, ctx) {
  const t = ctx.ts;
  const callee = call.expression;
  if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text))
    return true;
  const root = chainRootReceiver(callee, ctx);
  if (t.isIdentifier(root) && root.text === "East")
    return true;
  return isBlockBuilderType(ctx.checker.getTypeAtLocation(root));
}
function containsEastBuilder(expr, ctx) {
  const t = ctx.ts;
  let found = false;
  const visit = (n) => {
    if (found)
      return;
    if (t.isCallExpression(n) && isEastBuilderCall(n, ctx)) {
      found = true;
      return;
    }
    t.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}
function returnBuildsEast(r, ctx) {
  const t = ctx.ts;
  if (isJsx2(r, t))
    return false;
  if (isEastDefinitionType(ctx.checker.getTypeAtLocation(r)))
    return false;
  if (isEastValueConstructor(r, t))
    return true;
  if (isEastExprType(ctx.checker.getTypeAtLocation(r)))
    return true;
  const root = chainRootReceiver(r, ctx);
  const rootType = ctx.checker.getTypeAtLocation(root);
  if (isEastExprType(rootType) || isBlockBuilderType(rootType))
    return true;
  return containsEastBuilder(r, ctx);
}
function returnExpressions2(fn, t) {
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
var noModuleScopeEastMacro = {
  name: NAME16,
  code: CODE16,
  description: "Flag a module-scope TS helper that builds East values/IR or a composite string key \u2014 make it a real East.function or model typed/nested East data.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
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
    if (insideBlockScope(fn, ctx))
      return;
    const first = fn.parameters[0];
    if (first !== void 0 && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name)))
      return;
    const rs = returnExpressions2(fn, t);
    if (rs.some((r) => isJsx2(r, t)))
      return;
    if (rs.length === 0)
      return;
    const everyBuildsEast = rs.every((r) => returnBuildsEast(r, ctx));
    const everyHostKey = rs.every((r) => isHostTemplate(r, t));
    if (!everyBuildsEast && !everyHostKey)
      return;
    const sf = ctx.sourceFile;
    const start = reportNode.getStart(sf);
    ctx.report({
      ruleName: NAME16,
      code: CODE16,
      start,
      length: reportNode.getEnd() - start,
      messageText: everyHostKey ? "This helper builds a composite string key from a host template literal \u2014 the signature of a string-keyed data model. Model the data with typed keys / nested East structures instead." : "This module-scope TS helper builds East values/IR \u2014 an authoring-time macro that expands inline and can't be serialized. Make it a real `East.function`, or inline it.",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/require-runner-platforms.js
var NAME17 = "require-runner-platforms";
var CODE17 = 990022;
function isE3TaskCall(node, ctx) {
  const t = ctx.ts;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "task")
    return false;
  if (!t.isIdentifier(callee.expression))
    return false;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(callee.expression), t);
  return imp !== void 0 && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3";
}
function projectPlatformCalls(fnArg, ctx) {
  const t = ctx.ts;
  const names = [];
  const visit = (n) => {
    if (t.isCallExpression(n) && isEastPlatformDefinitionType(ctx.checker.getTypeAtLocation(n.expression))) {
      const callee = n.expression;
      const id = t.isIdentifier(callee) ? callee : t.isPropertyAccessExpression(callee) ? callee.name : void 0;
      const sym = id !== void 0 ? ctx.checker.getSymbolAtLocation(id) : void 0;
      const resolved = sym !== void 0 && (sym.flags & t.SymbolFlags.Alias) !== 0 ? ctx.checker.getAliasedSymbol(sym) : sym;
      const declaredInProject = (resolved?.declarations ?? []).some((d) => !d.getSourceFile().isDeclarationFile);
      if (declaredInProject && id !== void 0)
        names.push(id.text);
    }
    t.forEachChild(n, visit);
  };
  visit(fnArg);
  return names;
}
function hasCustomPlatformsEntry(options, t) {
  if (options === void 0)
    return false;
  if (!t.isObjectLiteralExpression(options))
    return void 0;
  const runnerProp = options.properties.find((p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "runner");
  if (runnerProp === void 0 || !t.isPropertyAssignment(runnerProp))
    return false;
  if (!t.isObjectLiteralExpression(runnerProp.initializer))
    return void 0;
  const platformsProp = runnerProp.initializer.properties.find((p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "platforms");
  if (platformsProp === void 0 || !t.isPropertyAssignment(platformsProp))
    return false;
  if (!t.isArrayLiteralExpression(platformsProp.initializer))
    return void 0;
  return platformsProp.initializer.elements.some((el) => t.isObjectLiteralExpression(el) && el.properties.some((p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "custom"));
}
var requireRunnerPlatforms = {
  name: NAME17,
  code: CODE17,
  description: "An e3.task calling project-declared platform functions must declare a runner.platforms custom module \u2014 otherwise it fails only at dataflow runtime.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) || !isE3TaskCall(node, ctx))
      return;
    const fnArg = node.arguments[2];
    if (fnArg === void 0)
      return;
    const calls = projectPlatformCalls(fnArg, ctx);
    if (calls.length === 0)
      return;
    const ok = hasCustomPlatformsEntry(node.arguments[3], t);
    if (ok === true || ok === void 0)
      return;
    const nameArg = node.arguments[0];
    const taskName = nameArg !== void 0 && t.isStringLiteralLike(nameArg) ? nameArg.text : "\u2026";
    const unique = [...new Set(calls)].join(", ");
    const sf = ctx.sourceFile;
    const target = node.arguments[3] ?? node.expression;
    const start = target.getStart(sf);
    ctx.report({
      ruleName: NAME17,
      code: CODE17,
      start,
      length: target.getEnd() - start,
      messageText: `Task "${taskName}" calls project platform function(s) ${unique} but its runner declares no custom platform module \u2014 it will fail at dataflow runtime with "Platform function \u2026 is not available". Add the module to the runner, e.g. \`{ runner: { runtime: "east-py", platforms: [{ custom: "platform_module" }] } }\`.`,
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-cross-block-builder.js
var NAME18 = "no-cross-block-builder";
var CODE18 = 990023;
function nearestBlockCallback(node, ctx) {
  let cur = node.parent;
  while (cur !== void 0) {
    if (isBlockBuilderCallback(cur, ctx))
      return cur;
    cur = cur.parent;
  }
  return void 0;
}
function referencesCrossedScope(call, root, owner, ctx) {
  const t = ctx.ts;
  const isFnLike = (n) => t.isArrowFunction(n) || t.isFunctionExpression(n) || t.isFunctionDeclaration(n) || t.isMethodDeclaration(n);
  const enclosingFn = (n) => {
    let cur = n.parent;
    while (cur !== void 0 && !isFnLike(cur))
      cur = cur.parent;
    return cur;
  };
  const contains = (outer, inner) => outer.pos <= inner.pos && inner.end <= outer.end;
  let crossed = false;
  const visit = (n) => {
    if (crossed)
      return;
    if (t.isIdentifier(n) && n !== root) {
      const p = n.parent;
      const isLabel = p !== void 0 && (t.isPropertyAccessExpression(p) && p.name === n || t.isPropertyAssignment(p) && p.name === n || t.isJsxAttribute(p) && p.name === n);
      if (!isLabel) {
        const decl = ctx.checker.getSymbolAtLocation(n)?.valueDeclaration;
        if (decl !== void 0) {
          const declFn = enclosingFn(decl);
          if (declFn !== void 0 && declFn !== owner && contains(owner, declFn) && contains(declFn, call)) {
            crossed = true;
            return;
          }
        }
      }
    }
    t.forEachChild(n, visit);
  };
  visit(call);
  return crossed;
}
var noCrossBlockBuilder = {
  name: NAME18,
  code: CODE18,
  description: "Inside a nested East block callback, an outer-`$` emission referencing inner-scope values puts the binding where those values don't exist.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const root = chainRootReceiver(node.expression, ctx);
    if (!t.isIdentifier(root))
      return;
    if (!isBlockBuilderType(ctx.checker.getTypeAtLocation(root)))
      return;
    const sym = ctx.checker.getSymbolAtLocation(root);
    const decl = sym?.valueDeclaration;
    if (decl === void 0 || !t.isParameter(decl))
      return;
    const owner = decl.parent;
    if (!isBlockBuilderCallback(owner, ctx))
      return;
    const nearest = nearestBlockCallback(node, ctx);
    if (nearest === void 0 || nearest === owner)
      return;
    if (!referencesCrossedScope(node, root, owner, ctx))
      return;
    const sf = ctx.sourceFile;
    const start = root.getStart(sf);
    ctx.report({
      ruleName: NAME18,
      code: CODE18,
      start,
      length: node.getEnd() - start,
      messageText: "This call uses an OUTER block's `$` inside a nested East callback while referencing inner-callback values \u2014 the binding is emitted into the outer block, where those values don't exist. Use the callback's own builder (name it `$`, not `_$`).",
      category: "error"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-state-outside-reactive.js
var NAME19 = "no-state-outside-reactive";
var CODE19 = 990024;
function atUiSurfaceRoot(node, ctx) {
  const t = ctx.ts;
  const outermost = enclosingBlockScope(node, ctx);
  if (outermost === void 0 || !t.isCallExpression(outermost))
    return false;
  const parent = outermost.parent;
  if (parent === void 0 || !t.isCallExpression(parent))
    return false;
  if (!parent.arguments.some((a) => a === outermost))
    return false;
  const callee = parent.expression;
  return t.isIdentifier(callee) && callee.text === "ui" && resolvesToEastImport(callee, ctx.checker, t);
}
var noStateOutsideReactive = {
  name: NAME19,
  code: CODE19,
  description: "east-ui State.* must live inside a <Reactive> builder \u2014 outside one the UI function becomes async and is rejected at deploy time.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee))
      return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "State")
      return;
    if (!resolvesToEastImport(callee.expression, ctx.checker, t))
      return;
    if (!atUiSurfaceRoot(node, ctx))
      return;
    if (insideReactive(node, t))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME19,
      code: CODE19,
      start,
      length: node.getEnd() - start,
      messageText: `\`State.${callee.name.text}\` outside a \`<Reactive>\` builder makes this UI function async at analysis time \u2014 the deploy analyzer rejects it (or the surface never re-renders). Move all \`State.*\` into the \`<Reactive>{$ => \u2026}\` inner builder.`,
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/prefer-const-ui-callbacks.js
var NAME20 = "prefer-const-ui-callbacks";
var CODE20 = 990025;
var preferConstUiCallbacks = {
  name: NAME20,
  code: CODE20,
  description: "Inside <Reactive>, bind JSX event handlers with $.const and pass the handle \u2014 an inline East.function prop is rebuilt each re-render and memoized renderers can't see the swap.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee))
      return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "East")
      return;
    if (callee.name.text !== "function" && callee.name.text !== "asyncFunction")
      return;
    const parent = node.parent;
    if (parent === void 0 || !t.isJsxExpression(parent) || parent.expression !== node)
      return;
    const attr = parent.parent;
    if (attr === void 0 || !t.isJsxAttribute(attr))
      return;
    if (!insideBlockScope(node, ctx))
      return;
    if (!insideReactive(node, t))
      return;
    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME20,
      code: CODE20,
      start,
      length: callee.getEnd() - start,
      messageText: `Inline \`East.${callee.name.text}\` in the \`${attr.name.getText(sf)}\` prop is rebuilt on every render, and \`equalFor\` treats all functions as equal so memoized renderers can't see the swap. Bind it once \u2014 \`const handler = $.const(East.${callee.name.text}(\u2026))\` \u2014 and pass the handle.`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-dynamic-bind-path.js
var NAME21 = "no-dynamic-bind-path";
var CODE21 = 990026;
var KEY_ARG_INDEX = {
  Data: 0,
  State: 1,
  Navigation: 1
};
var noDynamicBindPath = {
  name: NAME21,
  code: CODE21,
  description: "Data.bind / State.bind / Navigation.bind keys must be IR-build constants \u2014 an East-computed key can't be captured in the ui() manifest.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "bind")
      return;
    if (!t.isIdentifier(callee.expression))
      return;
    const ns = callee.expression.text;
    const argIndex = KEY_ARG_INDEX[ns];
    if (argIndex === void 0)
      return;
    if (!resolvesToEastImport(callee.expression, ctx.checker, t))
      return;
    const keyArg = node.arguments[argIndex];
    if (keyArg === void 0)
      return;
    if (!isEastExprType(ctx.checker.getTypeAtLocation(keyArg)))
      return;
    const sf = ctx.sourceFile;
    const start = keyArg.getStart(sf);
    ctx.report({
      ruleName: NAME21,
      code: CODE21,
      start,
      length: keyArg.getEnd() - start,
      messageText: `The \`${ns}.bind\` key is an East expression \u2014 bind keys must be JS-side constants captured at IR-build time, or the binding is missing from the ui() manifest (no subscription/permission). Bind each candidate as a constant and select the VALUE in East (\`cond.ifElse(() => a.read(), () => b.read())\`).`,
      category: "error"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-build-time-clock.js
var NAME22 = "no-build-time-clock";
var CODE22 = 990027;
function insideFunction(node, t) {
  let cur = node.parent;
  while (cur !== void 0) {
    if (t.isArrowFunction(cur) || t.isFunctionExpression(cur) || t.isFunctionDeclaration(cur) || t.isMethodDeclaration(cur) || t.isConstructorDeclaration(cur) || t.isGetAccessorDeclaration(cur) || t.isSetAccessorDeclaration(cur)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}
var noBuildTimeClock = {
  name: NAME22,
  code: CODE22,
  description: "Flag Date.now() / argless new Date() at module scope of East/e3 source \u2014 the build clock gets baked into the deployed program.",
  check(node, ctx) {
    const t = ctx.ts;
    let target;
    if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && t.isIdentifier(node.expression.expression) && node.expression.expression.text === "Date" && node.expression.name.text === "now") {
      target = node;
    } else if (t.isNewExpression(node) && t.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments === void 0 || node.arguments.length === 0)) {
      target = node;
    }
    if (target === void 0)
      return;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
    if (insideFunction(target, t))
      return;
    const sf = ctx.sourceFile;
    const start = target.getStart(sf);
    ctx.report({
      ruleName: NAME22,
      code: CODE22,
      start,
      length: target.getEnd() - start,
      messageText: 'Module-scope clock read in East/e3 source \u2014 this bakes the BUILD moment into the deployed program. Author a constant datetime (`new Date("2026-06-30T07:00:00Z")`), or read time at runtime inside a task (the `Time` platform).',
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-handrolled-value-type-mirror.js
var NAME23 = "no-handrolled-value-type-mirror";
var CODE23 = 990028;
function eastTypeValueInFile(name, ctx) {
  const t = ctx.ts;
  for (const stmt of ctx.sourceFile.statements) {
    let ident;
    if (t.isImportDeclaration(stmt) && stmt.importClause?.namedBindings !== void 0 && t.isNamedImports(stmt.importClause.namedBindings)) {
      for (const spec of stmt.importClause.namedBindings.elements) {
        if (spec.name.text === name && !spec.isTypeOnly)
          ident = spec.name;
      }
    } else if (t.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (t.isIdentifier(d.name) && d.name.text === name)
          ident = d.name;
      }
    }
    if (ident !== void 0) {
      const type = ctx.checker.getTypeAtLocation(ident);
      const typeName = type.aliasSymbol?.name ?? type.symbol?.name;
      if (typeName !== void 0 && typeName.endsWith("Type"))
        return true;
    }
  }
  return false;
}
var noHandrolledValueTypeMirror = {
  name: NAME23,
  code: CODE23,
  description: "A hand-authored interface mirroring an in-scope East type \u2014 derive it with ValueTypeOf<typeof XType> instead.",
  check(node, ctx) {
    const t = ctx.ts;
    let name;
    if (t.isInterfaceDeclaration(node)) {
      name = node.name;
    } else if (t.isTypeAliasDeclaration(node) && t.isTypeLiteralNode(node.type)) {
      name = node.name;
    }
    if (name === void 0)
      return;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
    const base = name.text.endsWith("Value") ? name.text.slice(0, -"Value".length) : name.text;
    const counterpart = `${base}Type`;
    if (counterpart === name.text)
      return;
    if (!eastTypeValueInFile(counterpart, ctx))
      return;
    const sf = ctx.sourceFile;
    const start = name.getStart(sf);
    ctx.report({
      ruleName: NAME23,
      code: CODE23,
      start,
      length: name.getEnd() - start,
      messageText: `\`${name.text}\` hand-mirrors the East type \`${counterpart}\` \u2014 it drifts silently when the East type gains a field. Derive it: \`type ${name.text} = ValueTypeOf<typeof ${counterpart}>\`.`,
      category: "suggestion"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-host-comparison-on-east-values.js
var NAME24 = "no-host-comparison-on-east-values";
var CODE24 = 990029;
var VALUE_SHAPE_NAMES = /* @__PURE__ */ new Set(["variant", "option", "SortedMap", "SortedSet"]);
function isEastValueShapeType(type) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === void 0 || seen.has(current))
      continue;
    seen.add(current);
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== void 0 && VALUE_SHAPE_NAMES.has(name))
      return true;
    if (current.isUnionOrIntersection())
      stack.push(...current.types);
  }
  return false;
}
function isNullish(e, t) {
  return e.kind === t.SyntaxKind.NullKeyword || t.isIdentifier(e) && e.text === "undefined";
}
var noHostComparisonOnEastValues = {
  name: NAME24,
  code: CODE24,
  description: "Flag ===/!==/</> on decoded East values (variants, options, SortedMap/SortedSet) \u2014 use equalFor(T) / compareFor(T).",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isBinaryExpression(node))
      return;
    const k = t.SyntaxKind;
    const op = node.operatorToken.kind;
    const equality = op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken || op === k.EqualsEqualsToken || op === k.ExclamationEqualsToken;
    const relational = op === k.LessThanToken || op === k.LessThanEqualsToken || op === k.GreaterThanToken || op === k.GreaterThanEqualsToken;
    if (!equality && !relational)
      return;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
    if (isNullish(node.left, t) || isNullish(node.right, t))
      return;
    const leftShaped = isEastValueShapeType(ctx.checker.getTypeAtLocation(node.left));
    const rightShaped = isEastValueShapeType(ctx.checker.getTypeAtLocation(node.right));
    if (!leftShaped && !rightShaped)
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME24,
      code: CODE24,
      start,
      length: node.getEnd() - start,
      messageText: equality ? "Host equality on a decoded East value compares object identity \u2014 two equal variants are never `===`. Use `equalFor(T)(a, b)`." : "Host ordering on a decoded East value compares the wrong representation. Use `compareFor(T)` / `lessFor(T)` (e.g. `arr.sort(compareFor(T))`).",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/require-example-returns.js
var NAME25 = "require-example-returns";
var CODE25 = 990030;
var RETURNS_EXEMPT = /* @__PURE__ */ new Set(["NullType", "UIComponentType"]);
function propNamed(obj, name, t) {
  for (const p of obj.properties) {
    if (t.isPropertyAssignment(p) && (t.isIdentifier(p.name) || t.isStringLiteralLike(p.name)) && p.name.text === name) {
      return p;
    }
  }
  return void 0;
}
var requireExampleReturns = {
  name: NAME25,
  code: CODE25,
  description: "example() must declare `returns` unless the fn output is NullType/UIComponentType \u2014 omitting it false-passes the example's assertion.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node))
      return;
    const callee = node.expression;
    if (!t.isIdentifier(callee) || callee.text !== "example")
      return;
    if (!resolvesToEastImport(callee, ctx.checker, t))
      return;
    const arg = node.arguments[0];
    if (arg === void 0 || !t.isObjectLiteralExpression(arg))
      return;
    if (propNamed(arg, "returns", t) !== void 0)
      return;
    const fnProp = propNamed(arg, "fn", t);
    if (fnProp === void 0 || !t.isCallExpression(fnProp.initializer))
      return;
    const outputArg = fnProp.initializer.arguments[1];
    if (outputArg !== void 0 && t.isIdentifier(outputArg) && RETURNS_EXEMPT.has(outputArg.text))
      return;
    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME25,
      code: CODE25,
      start,
      length: callee.getEnd() - start,
      messageText: "This `example()` has no `returns` \u2014 the harness runs `fn` as a bare statement and the assertion false-passes. Add the hand-verified `returns` value (omit it ONLY for NullType / UIComponentType outputs).",
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/no-duplicate-definition-name.js
var NAME26 = "no-duplicate-definition-name";
var CODE26 = 990031;
var DEFINITION_KINDS = /* @__PURE__ */ new Map([
  ["input", "input"],
  ["task", "task"],
  ["customTask", "task"],
  ["function", "function"],
  ["record", "record"],
  ["mutation", "mutation"]
]);
function e3Definition(node, ctx) {
  const t = ctx.ts;
  if (!t.isCallExpression(node))
    return void 0;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || !t.isIdentifier(callee.expression))
    return void 0;
  const kind = DEFINITION_KINDS.get(callee.name.text);
  if (kind === void 0)
    return void 0;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(callee.expression), t);
  if (imp === void 0 || !t.isStringLiteral(imp.moduleSpecifier) || imp.moduleSpecifier.text !== "@elaraai/e3")
    return void 0;
  const nameArg = node.arguments[0];
  if (nameArg === void 0 || !t.isStringLiteralLike(nameArg))
    return void 0;
  return { kind, nameArg };
}
var noDuplicateDefinitionName = {
  name: NAME26,
  code: CODE26,
  description: "Two e3 definitions of the same kind with the same name string collide at deploy time \u2014 names must be unique per kind.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isSourceFile(node))
      return;
    const seen = /* @__PURE__ */ new Map();
    const visit = (n) => {
      const def = e3Definition(n, ctx);
      if (def !== void 0) {
        const key = `${def.kind}:${def.nameArg.text}`;
        const first = seen.get(key);
        if (first === void 0) {
          seen.set(key, def.nameArg);
        } else {
          const sf = ctx.sourceFile;
          const start = def.nameArg.getStart(sf);
          ctx.report({
            ruleName: NAME26,
            code: CODE26,
            start,
            length: def.nameArg.getEnd() - start,
            messageText: `Duplicate e3 ${def.kind} name "${def.nameArg.text}" \u2014 it collides with the earlier definition at deploy time. Definition names must be unique per kind.`,
            category: "error"
          });
        }
      }
      t.forEachChild(n, visit);
    };
    visit(node);
  }
};

// ../east-diagnostics/dist/src/rules/no-inline-credentials.js
var NAME27 = "no-inline-credentials";
var CODE27 = 990032;
var CREDENTIAL_FIELDS = /* @__PURE__ */ new Set([
  "password",
  "passphrase",
  "privateKey",
  "secretAccessKey",
  "accessKeyId",
  "apiKey",
  "token",
  "accessToken",
  "refreshToken",
  "sessionToken",
  "secretKey",
  "clientSecret"
]);
var HOST_FIELDS = /* @__PURE__ */ new Set(["host", "hostname", "endpoint", "url", "server", "address"]);
var LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
function isStringy(node, t) {
  return t.isStringLiteral(node) || t.isNoSubstitutionTemplateLiteral(node);
}
function literalCredential(init2, t) {
  if (isStringy(init2, t) && init2.text.length > 0)
    return init2;
  if (!t.isCallExpression(init2))
    return void 0;
  const callee = init2.expression;
  const calleeName = t.isIdentifier(callee) ? callee.text : t.isPropertyAccessExpression(callee) ? callee.name.text : void 0;
  if (calleeName !== "some" && calleeName !== "variant")
    return void 0;
  const args = calleeName === "variant" ? init2.arguments.slice(1) : init2.arguments;
  for (const arg of args) {
    if (isStringy(arg, t) && arg.text.length > 0)
      return arg;
  }
  return void 0;
}
function mentionsLocalHost(node, t) {
  if (isStringy(node, t) && LOCAL_HOSTS.some((h) => node.text.includes(h)))
    return true;
  let found = false;
  t.forEachChild(node, (child) => {
    if (!found && mentionsLocalHost(child, t))
      found = true;
  });
  return found;
}
function targetsLocalHost(obj, t) {
  for (const prop of obj.properties) {
    if (!t.isPropertyAssignment(prop))
      continue;
    const name = t.isIdentifier(prop.name) || t.isStringLiteral(prop.name) ? prop.name.text : void 0;
    if (name !== void 0 && HOST_FIELDS.has(name) && mentionsLocalHost(prop.initializer, t))
      return true;
  }
  return false;
}
var noInlineCredentials = {
  name: NAME27,
  code: CODE27,
  description: "Flag literal string credentials (password, secretAccessKey, token, \u2026) in East/e3 source \u2014 use Env.get so the IR carries the variable name, not the secret.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isPropertyAssignment(node))
      return;
    const name = t.isIdentifier(node.name) || t.isStringLiteral(node.name) ? node.name.text : void 0;
    if (name === void 0 || !CREDENTIAL_FIELDS.has(name))
      return;
    if (!importsEastPackage(ctx.sourceFile, t))
      return;
    const literal = literalCredential(node.initializer, t);
    if (literal === void 0)
      return;
    if (t.isObjectLiteralExpression(node.parent) && targetsLocalHost(node.parent, t))
      return;
    const sf = ctx.sourceFile;
    const start = literal.getStart(sf);
    ctx.report({
      ruleName: NAME27,
      code: CODE27,
      start,
      length: literal.getEnd() - start,
      messageText: `Literal credential in \`${name}\` \u2014 East source compiles to content-addressed IR that is stored, exported, and replicated, so a secret here is effectively unredactable. Use \`Env.get("YOUR_VAR")\` (east-node-std) and supply the value per environment: your shell locally, the deployment's secret store in hosted runtimes.`,
      category: "warning"
    });
  }
};

// ../east-diagnostics/dist/src/rules/index.js
var allRules = [
  // East-side idiom hygiene (original set)
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
  preferJsxOverFactoryCall,
  noUntrackedEastData,
  // host-vs-East family: the general block rule + the module-scope macro rule,
  // plus the separate build-time-data concerns (ingestion primitives, and
  // host-computed e3.input seed data)
  noHostInEastBlock,
  noModuleScopeEastMacro,
  noCompileTimeDataInjection,
  noCompileTimeSeedData,
  // deploy/runtime-failure classes that type-check clean (epic #208)
  requireRunnerPlatforms,
  noCrossBlockBuilder,
  noStateOutsideReactive,
  preferConstUiCallbacks,
  noDynamicBindPath,
  noBuildTimeClock,
  noHandrolledValueTypeMirror,
  noHostComparisonOnEastValues,
  requireExampleReturns,
  noDuplicateDefinitionName,
  // secrets hygiene: IR is content-addressed and replicated — no literal creds
  noInlineCredentials
];

// ../east-diagnostics/dist/src/run.js
function runEastRules(tsModule, program, sourceFile, checker, options = {}, rules = allRules) {
  if (unresolvedEastImport(sourceFile, checker, tsModule))
    return [];
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
import { existsSync as existsSync2, readFileSync } from "node:fs";
import { dirname as dirname2, join as join3, resolve as resolve2 } from "node:path";

// ../east-diagnostics/dist/src/east-module.js
import { createRequire } from "node:module";
import { join as join2 } from "node:path";
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
  const require_ = createRequire(join2(projectDir, "_.js"));
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
  let dir = dirname2(resolve2(fromPath));
  for (; ; ) {
    const candidate = join3(dir, "tsconfig.json");
    if (existsSync2(candidate))
      return candidate;
    const parent = dirname2(dir);
    if (parent === dir)
      return void 0;
    dir = parent;
  }
}
function loadTypeScript(projectDir) {
  try {
    return createRequire2(join3(projectDir, "_.js"))("typescript");
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
    const projectDir = dirname2(tsconfigPath);
    const t = loadTypeScript(projectDir);
    const configFile = t.readConfigFile(tsconfigPath, t.sys.readFile);
    const parsed = t.parseJsonConfigFileContent(configFile.config ?? {}, t.sys, projectDir);
    const project = {
      ts: t,
      service: void 0,
      rootFileNames: new Set(parsed.fileNames.map((f) => resolve2(f))),
      adHoc: /* @__PURE__ */ new Set(),
      versions: /* @__PURE__ */ new Map()
    };
    const host = {
      getScriptFileNames: () => [...project.rootFileNames, ...project.adHoc],
      getScriptVersion: (f) => String(project.versions.get(resolve2(f)) ?? 0),
      getScriptSnapshot: (f) => {
        const path = resolve2(f);
        const overlay = overlays.get(path);
        if (overlay !== void 0)
          return t.ScriptSnapshot.fromString(overlay);
        if (!existsSync2(path))
          return void 0;
        return t.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
      },
      getCurrentDirectory: () => projectDir,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => t.getDefaultLibFilePath(o),
      fileExists: (f) => overlays.has(resolve2(f)) || t.sys.fileExists(f),
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
    const file = resolve2(filePath);
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
    const projectDir = dirname2(tsconfigPath);
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
      const tsconfigPath = findNearestTsconfig(join3(resolve2(fromDir), "_.ts"));
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
      overlays.set(resolve2(filePath), content);
    },
    clearOverlay(filePath) {
      overlays.delete(resolve2(filePath));
    },
    dispose() {
      projects.clear();
      overlays.clear();
    }
  };
}

// ../east-diagnostics/dist/src/lsp.js
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var EAST_IMPORT_PATTERN = /@elaraai\//;
var SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;
var DEBOUNCE_MS = 100;
var SEVERITY = {
  error: 1,
  warning: 2,
  suggestion: 3
};
function lineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n")
      starts.push(i + 1);
  }
  return starts;
}
function offsetToPosition(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = low + high + 1 >> 1;
    if (starts[mid] <= offset)
      low = mid;
    else
      high = mid - 1;
  }
  return { line: low, character: offset - starts[low] };
}
function uriToPath(uri) {
  if (!uri.startsWith("file://"))
    return void 0;
  try {
    return fileURLToPath(uri);
  } catch {
    return void 0;
  }
}
function runEastLsp(options = {}) {
  const service = options.service ?? createDiagnosticsService();
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code) => process.exit(code));
  const open = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  let shuttingDown = false;
  function send(message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}`);
  }
  function publish(path) {
    const content = open.get(path) ?? (() => {
      try {
        return readFileSync2(path, "utf-8");
      } catch {
        return void 0;
      }
    })();
    let diagnostics = [];
    if (content !== void 0 && !SKIP_PATH.test(path) && EAST_IMPORT_PATTERN.test(content)) {
      const starts = lineStarts(content);
      diagnostics = service.diagnose(path).map((d) => ({
        range: {
          start: offsetToPosition(starts, d.start),
          end: offsetToPosition(starts, d.start + d.length)
        },
        severity: SEVERITY[d.category],
        code: d.ruleName === "tsc" ? `TS${d.code}` : d.ruleName,
        source: "east",
        message: d.messageText
      }));
    }
    send({ method: "textDocument/publishDiagnostics", params: { uri: `file://${path}`, diagnostics } });
  }
  function schedule(path) {
    const existing = pending.get(path);
    if (existing !== void 0)
      clearTimeout(existing);
    pending.set(path, setTimeout(() => {
      pending.delete(path);
      try {
        publish(path);
      } catch {
      }
    }, DEBOUNCE_MS));
  }
  function handle(message) {
    const { method, id, params } = message;
    if (method === void 0)
      return;
    switch (method) {
      case "initialize": {
        const folders = [];
        const root = params?.rootUri ?? params?.rootPath;
        if (typeof root === "string") {
          const p = root.startsWith("file://") ? uriToPath(root) : root;
          if (p !== void 0)
            folders.push(p);
        }
        for (const f of params?.workspaceFolders ?? []) {
          const p = uriToPath(f?.uri ?? "");
          if (p !== void 0)
            folders.push(p);
        }
        send({
          id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 1, save: { includeText: true } }
            },
            serverInfo: { name: "east-diagnostics" }
          }
        });
        setImmediate(() => {
          for (const folder of folders) {
            try {
              service.warm(folder);
            } catch {
            }
          }
        });
        return;
      }
      case "initialized":
        return;
      case "shutdown":
        shuttingDown = true;
        send({ id, result: null });
        return;
      case "exit":
        exit(shuttingDown ? 0 : 1);
        return;
      case "textDocument/didOpen": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.textDocument?.text;
        if (path === void 0 || typeof text !== "string")
          return;
        open.set(path, text);
        service.setOverlay(path, text);
        schedule(path);
        return;
      }
      case "textDocument/didChange": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.contentChanges?.at?.(-1)?.text;
        if (path === void 0 || typeof text !== "string")
          return;
        open.set(path, text);
        service.setOverlay(path, text);
        schedule(path);
        return;
      }
      case "textDocument/didSave": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === void 0)
          return;
        const text = params?.text;
        if (typeof text === "string") {
          open.set(path, text);
          service.setOverlay(path, text);
        } else {
          open.delete(path);
          service.clearOverlay(path);
        }
        schedule(path);
        return;
      }
      case "textDocument/didClose": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === void 0)
          return;
        open.delete(path);
        service.clearOverlay(path);
        const timer = pending.get(path);
        if (timer !== void 0)
          clearTimeout(timer);
        pending.delete(path);
        send({ method: "textDocument/publishDiagnostics", params: { uri: `file://${path}`, diagnostics: [] } });
        return;
      }
      default:
        if (id !== void 0) {
          send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
        return;
    }
  }
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (; ; ) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0)
        return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length)
        return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      try {
        handle(JSON.parse(body));
      } catch {
      }
    }
  });
  input.on("close", () => exit(0));
  input.on("end", () => exit(0));
}

// daemon/lsp.ts
runEastLsp();
