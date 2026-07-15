/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";

const NAME = "no-inline-credentials";
const CODE = 990032;

/** Property names that carry secrets in the io config types (SQL.*, Storage.S3,
 * Transfer.SFTP/FTP, NoSQL.*) plus the generic token-ish names. Name-based on
 * purpose: configs are often built as standalone object literals before any
 * East type is in contextual-type reach, so type-directed matching would miss
 * the common case. `accessKeyId` is included because it always travels with its
 * secret pair and has no legitimate literal form either. */
const CREDENTIAL_FIELDS = new Set([
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
  "clientSecret",
]);

/** Sibling fields that identify the target host — used for the local-endpoint
 * exemption below. */
const HOST_FIELDS = new Set(["host", "hostname", "endpoint", "url", "server", "address"]);

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

function isStringy(node: ts.Node, t: TsModule): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return t.isStringLiteral(node) || t.isNoSubstitutionTemplateLiteral(node);
}

/** The literal credential inside `init`, if there is one: a direct non-empty
 * string literal, or one wrapped in an option/variant constructor —
 * `some("…")`, `East.some("…")`, `variant("some", "…")`, `East.variant(…)`. */
function literalCredential(init: ts.Expression, t: TsModule): ts.Node | undefined {
  if (isStringy(init, t) && init.text.length > 0) return init;
  if (!t.isCallExpression(init)) return undefined;
  const callee = init.expression;
  const calleeName = t.isIdentifier(callee)
    ? callee.text
    : t.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  if (calleeName !== "some" && calleeName !== "variant") return undefined;
  // For `variant("some", value)` the first argument is the case tag, not data.
  const args = calleeName === "variant" ? init.arguments.slice(1) : init.arguments;
  for (const arg of args) {
    if (isStringy(arg, t) && arg.text.length > 0) return arg;
  }
  return undefined;
}

/** Does any string literal anywhere under `node` name a local host? */
function mentionsLocalHost(node: ts.Node, t: TsModule): boolean {
  if (isStringy(node, t) && LOCAL_HOSTS.some((h) => node.text.includes(h))) return true;
  let found = false;
  t.forEachChild(node, (child) => {
    if (!found && mentionsLocalHost(child, t)) found = true;
  });
  return found;
}

/** Is a sibling host/endpoint field of this object literal pointing at a local
 * address? Credentials for a developer's own localhost container (test
 * databases, MinIO, …) are not secrets — flagging them would only teach people
 * to ignore the rule. */
function targetsLocalHost(obj: ts.ObjectLiteralExpression, t: TsModule): boolean {
  for (const prop of obj.properties) {
    if (!t.isPropertyAssignment(prop)) continue;
    const name = t.isIdentifier(prop.name) || t.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (name !== undefined && HOST_FIELDS.has(name) && mentionsLocalHost(prop.initializer, t)) return true;
  }
  return false;
}

// East/e3 source is compiled to IR that is content-addressed, stored in
// package objects, exported, cached, and replicated — a literal credential in
// it is effectively unredactable, and it is readable by anyone with repo
// access. The io config types force the issue (SQL passwords are REQUIRED
// string fields), so the correct form is name-in-IR / value-at-runtime:
// `Env.get("NAME")` (east-node-std / east-py-std), with the value supplied by
// the environment — the developer's shell locally, the deployment's secret
// store in hosted runtimes.
export const noInlineCredentials: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag literal string credentials (password, secretAccessKey, token, …) in East/e3 source — use Env.get so the IR carries the variable name, not the secret.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isPropertyAssignment(node)) return;
    const name = t.isIdentifier(node.name) || t.isStringLiteral(node.name) ? node.name.text : undefined;
    if (name === undefined || !CREDENTIAL_FIELDS.has(name)) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;

    const literal = literalCredential(node.initializer, t);
    if (literal === undefined) return;
    if (t.isObjectLiteralExpression(node.parent) && targetsLocalHost(node.parent, t)) return;

    const sf = ctx.sourceFile;
    const start = literal.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: literal.getEnd() - start,
      messageText:
        `Literal credential in \`${name}\` — East source compiles to content-addressed IR that is stored, exported, and replicated, so a secret here is effectively unredactable. Use \`Env.get("YOUR_VAR")\` (east-node-std) and supply the value per environment: your shell locally, the deployment's secret store in hosted runtimes.`,
      category: "warning",
    });
  },
};
