/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rule for the names e3 makes paths of: a repository's name where a server
 * keeps several, a workspace's name, a package's name and version, and a
 * lock's resource. One place holds it, so the SDK, the CLI, the API server and
 * the stores refuse the same names.
 */

/** What a name names. */
export type NamedKind = 'repository' | 'workspace' | 'package' | 'package version' | 'lock';

/** What no name may hold: a path separator, a character a Windows file name
 *  refuses, or a control character. */
const REFUSED = /[/\\:*?"<>|\u0000-\u001f]/;

/** What a workspace's name may not hold besides: the characters that join the
 *  parts of its locks' names. */
const REFUSED_IN_WORKSPACE = /[#~]/;

/**
 * Why a name cannot be one path segment, or `null` when it can.
 *
 * @param kind - What the name names
 * @param name - The name
 * @returns The problem, in words that follow the name, or `null`
 */
export function nameProblem(kind: NamedKind, name: string): string | null {
  if (name === '') return 'is empty';
  if (name === '.' || name === '..') return 'is a path of its own';
  const refused = REFUSED.exec(name);
  if (refused !== null) return `holds ${JSON.stringify(refused[0])}, which a file name cannot`;
  const joiner = kind === 'workspace' ? REFUSED_IN_WORKSPACE.exec(name) : null;
  if (joiner !== null) return `holds ${JSON.stringify(joiner[0])}, which joins the parts of a lock's name`;
  return null;
}
