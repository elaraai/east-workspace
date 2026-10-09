/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The release of e3 this build is, and how two releases order.
 *
 * @remarks
 * A release is the version the release scripts write into every package.
 * `scripts/set-npm-version.mjs` writes it here with them, and
 * `scripts/check-version-drift.mjs` refuses a tree where it differs from
 * theirs. What e3 keeps or ships records the release that wrote it: a
 * repository's record, an execution state and a package zip, and a transfer
 * request the release that sent it, so a refusal of any of them names that
 * release beside this one.
 */

/** The release of e3 this build is. */
export const E3_RELEASE = '1.0.86';

/** A semantic version: its core, a pre-release, and build metadata. */
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Orders two releases by semantic-version precedence.
 *
 * @remarks
 * The core, `major.minor.patch`, orders numerically. A pre-release
 * (`1.1.0-beta.2`) precedes the release of its core, and two pre-releases of
 * one core order by their dot-separated identifiers in turn: numbers
 * numerically and before words, words in ASCII order, and a list that is a
 * prefix of the other first. Build metadata (`+…`) orders nothing.
 *
 * @param a - A release, such as `1.0.79` or `1.1.0-beta.2`
 * @param b - Another release
 * @returns A negative number when `a` precedes `b`, a positive one when it
 *   follows it, and 0 when neither does
 * @throws {Error} When either is not a semantic version
 */
export function compareReleases(a: string, b: string): number {
  const x = parseRelease(a);
  const y = parseRelease(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!;
    const q = y.pre[i]!;
    if (p === q) continue;
    const pNumber = /^\d+$/.test(p);
    const qNumber = /^\d+$/.test(q);
    if (pNumber && qNumber) return BigInt(p) < BigInt(q) ? -1 : 1;
    if (pNumber !== qNumber) return pNumber ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

/** A release's core numbers and pre-release identifiers. */
function parseRelease(release: string): { core: number[]; pre: string[] } {
  const match = RELEASE.exec(release);
  if (match === null) throw new Error(`${JSON.stringify(release)} is not a release: a release is a semantic version, such as ${E3_RELEASE}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}
