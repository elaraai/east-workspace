#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-inline-credentials``: East source compiles to IR that is
content-addressed, stored, exported, cached and replicated — a literal secret
in it is effectively unredactable, and readable by anyone with repo access.
The io config types force the issue (a SQL password is a required field), so
the shape that works is name-in-IR, value-at-runtime:
``East.Env.get("PGPASSWORD")``, supplied by the shell locally and by the
deployment's secret store in a hosted runtime.

Credentials pointed at a local endpoint are exempt: a developer's own
localhost container is not a secret, and flagging it only teaches people to
ignore the rule. The TypeScript rule of the same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes

#: the config fields that carry a secret, by name — a config is usually built
#: as a plain dict, far from any declared East type, so the name is the tell
CREDENTIAL_FIELDS = frozenset({
    "password", "passphrase", "private_key", "privateKey", "secret_access_key", "secretAccessKey",
    "access_key_id", "accessKeyId", "api_key", "apiKey", "token", "access_token", "accessToken",
    "refresh_token", "refreshToken", "session_token", "sessionToken", "secret_key", "secretKey",
    "client_secret", "clientSecret",
})
#: sibling fields naming the target, for the local-endpoint exemption
HOST_FIELDS = frozenset({"host", "hostname", "endpoint", "url", "server", "address"})
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


def message(field: str) -> str:
    return (f"literal credential in `{field}` — East source compiles to content-addressed IR that "
            "is stored, exported and replicated, so a secret here cannot be redacted. Use "
            'East.Env.get("YOUR_VAR") and supply the value per environment')


class NoInlineCredentials:
    name = "no-inline-credentials"
    code = 21
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No literal credentials in East source — Env.get so the IR carries the variable "
                   "name, not the secret.")

    def check(self, body: Body, ctx: Context) -> None:
        # `body_nodes`, not `ast.walk(body.node)`: a nested body is visited as a
        # body of its own, so walking into it reports every finding twice — and
        # `apply_precedence` cannot dedupe that, since it only drops findings
        # ACROSS different rules.
        for node in body_nodes(body):
            self._dict(node, ctx)

    def check_module(self, ctx: Context) -> None:
        for node in ast.walk(ctx.tree):
            if not ctx.in_body(node):
                self._dict(node, ctx)

    def _dict(self, node: ast.AST, ctx: Context) -> None:
        if not isinstance(node, ast.Dict) or _targets_local_host(node):
            return
        for key, value in zip(node.keys, node.values, strict=False):
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                continue
            if key.value not in CREDENTIAL_FIELDS:
                continue
            literal = _literal_secret(value)
            if literal is not None:
                ctx.report(literal, self, message(key.value))


def _literal_secret(node: ast.AST) -> ast.AST | None:
    """The non-empty string literal inside ``node``, directly or wrapped in
    ``some(...)`` / ``variant("some", …)``."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value:
        return node
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
    if name not in ("some", "variant"):
        return None
    args = node.args[1:] if name == "variant" else node.args
    for arg in args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value:
            return arg
    return None


def _targets_local_host(node: ast.Dict) -> bool:
    """Whether a sibling host field of this dict names a local address."""
    for key, value in zip(node.keys, node.values, strict=False):
        if not (isinstance(key, ast.Constant) and key.value in HOST_FIELDS):
            continue
        for inner in ast.walk(value):
            if isinstance(inner, ast.Constant) and isinstance(inner.value, str) \
                    and any(h in inner.value for h in LOCAL_HOSTS):
                return True
    return False
