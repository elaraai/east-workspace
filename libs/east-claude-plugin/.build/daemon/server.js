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

// ../east-diagnostics/dist/src/rules/prefer-let-const-over-east-value.js
var NAME6 = "prefer-let-const-over-east-value";
var CODE6 = 990006;
function insideEastFunctionBody(node, t) {
  let current = node.parent;
  while (current !== void 0) {
    if (t.isCallExpression(current)) {
      const callee = current.expression;
      if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && (callee.name.text === "function" || callee.name.text === "asyncFunction")) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
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
    if (!insideEastFunctionBody(node, t))
      return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    const inner = node.arguments[0];
    ctx.report({
      ruleName: NAME6,
      code: CODE6,
      start,
      length: node.getEnd() - start,
      messageText: asCallbackBody ? "Don't wrap a callback's return in `East.value(...)` \u2014 the callback's expected element type already supplies the East type. Return the plain value." : asReturn ? "Don't `return East.value(...)` \u2014 it erases the East type. Bind the value with `$.let`/`$.const` (passing the East type) and return that variable." : "Inside an East.function block, declare with `$.const(value, Type)` / `$.let(value, Type)` instead of `East.value(...)`, which erases the East type at the call site.",
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
function enclosingEastFunctionCall(node, t) {
  let current = node.parent;
  while (current !== void 0) {
    if (t.isCallExpression(current)) {
      const callee = current.expression;
      if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && (callee.name.text === "function" || callee.name.text === "asyncFunction")) {
        return current;
      }
    }
    current = current.parent;
  }
  return void 0;
}
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
    let init = node.initializer;
    while (t.isParenthesizedExpression(init))
      init = init.expression;
    if (matchBlockBuilderCall(init, ctx) !== void 0)
      return;
    if (t.isIdentifier(init))
      return;
    if (!isEastExprType(ctx.checker.getTypeAtLocation(init)))
      return;
    const declSymbol = ctx.checker.getSymbolAtLocation(node.name);
    if (declSymbol === void 0)
      return;
    const name = node.name.text;
    const perBody = /* @__PURE__ */ new Map();
    const visit = (n) => {
      if (t.isIdentifier(n) && n !== node.name && n.text === name) {
        if (ctx.checker.getSymbolAtLocation(n) === declSymbol) {
          const body = enclosingEastFunctionCall(n, t);
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
  noReinlinedEastBinding
];

// ../east-diagnostics/dist/src/run.js
function runEastRules(tsModule, sourceFile, checker, options = {}, rules = allRules) {
  const diagnostics = [];
  const ctx = {
    ts: tsModule,
    sourceFile,
    checker,
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
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
var MAX_MESSAGE_LENGTH = 300;
function findNearestTsconfig(fromPath) {
  let dir = dirname(resolve(fromPath));
  for (; ; ) {
    const candidate = join(dir, "tsconfig.json");
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
    return createRequire(join(projectDir, "_.js"))("typescript");
  } catch {
    return createRequire(import.meta.url)("typescript");
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
        if (!existsSync(path))
          return void 0;
        return t.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
      },
      getCurrentDirectory: () => projectDir,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => t.getDefaultLibFilePath(o),
      fileExists: t.sys.fileExists,
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
    const nativeDiagnostics = native.flatMap((d) => {
      if (d.start === void 0 || d.length === void 0)
        return [];
      const message = t.flattenDiagnosticMessageText(d.messageText, " ");
      return [{
        ruleName: "tsc",
        code: d.code,
        start: d.start,
        length: d.length,
        messageText: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}\u2026` : message,
        category: toCategory(t, d.category)
      }];
    });
    const ruleDiagnostics = runEastRules(t, sourceFile, program.getTypeChecker(), options.rulesOptions ?? {}, options.rules);
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
      const tsconfigPath = findNearestTsconfig(join(resolve(fromDir), "_.ts"));
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
    dispose() {
      projects.clear();
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
