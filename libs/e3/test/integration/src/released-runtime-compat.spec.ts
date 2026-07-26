/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The ONE place cross-version beast2 behaviour is asserted, deliberately.
 *
 * `environment-e2e.spec.ts` used to assert this by accident: it scaffolds a
 * project pinned to the workspace version, which — because the release workflow
 * pushes the bump to `main` — is always the version already published. So the
 * environment it materialized ran the *previous release's* runtime, and six
 * tests silently became a gate on "the N-1 release can read what this tree
 * writes". That is a contract the platform explicitly declines to offer
 * (`libs/e3/design/e3-environment-granularity.md`: "none — lockstep upgrade"),
 * and gating on it taxes every wire change by a release while hiding the real
 * defect, that the suite never exercised the code under review at all.
 *
 * So that suite now materializes THIS tree's runtime (see `localStack.ts`), and
 * the cross-version question lives here, stated honestly:
 *
 *  1. The local decoder reads every container version this build claims to
 *     accept. ALWAYS — this is the direction lockstep actually promises: a
 *     user's blobs at rest must keep decoding after an upgrade.
 *  2. The released runtime reads v4. ALWAYS — v4 is released, so it must stay
 *     readable by anything that ever shipped.
 *  3. The released runtime does not read a container NEWER than this tree
 *     writes. ALWAYS — an anti-rot guard, so the skip below can only fire when
 *     the tree is genuinely ahead, never when it has regressed behind a release.
 *  4. The released runtime reads what this tree writes by default — but only
 *     when it is capable of that version. Otherwise this SKIPS with a message
 *     naming the versions involved. It self-heals with no edit the cycle after
 *     a release ships the new reader.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEAST2_READ_VERSIONS, BEAST2_WRITE_VERSION,
  East, IntegerType, decodeEastIR, encodeEastIR,
} from '@elaraai/east';

const WORKSPACE_LIBS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The lockstep version the scaffold pins, i.e. what is on npm/PyPI today. */
const RELEASED_VERSION = (JSON.parse(
  readFileSync(join(WORKSPACE_LIBS, 'east', 'package.json'), 'utf-8'),
) as { version: string }).version;

/** A trivial program — the subject is the container, not the IR. */
function sampleIr() {
  return East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n)).toIR();
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf-8', stdio: 'pipe',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ===========================================================================
// The local runtime reads everything it claims to
// ===========================================================================

describe('beast2 wire versions — this build', () => {
  it('decodes every container version in BEAST2_READ_VERSIONS', () => {
    const ir = sampleIr();
    for (const version of BEAST2_READ_VERSIONS) {
      const bytes = encodeEastIR(ir, { version });
      assert.equal(bytes[7], version, `v${version} magic byte`);
      const decoded = decodeEastIR(bytes);
      assert.equal(decoded.compile([])(14n), 42n, `v${version} round-trips and runs`);
    }
  });

  it('writes BEAST2_WRITE_VERSION by default', () => {
    assert.equal(encodeEastIR(sampleIr())[7], BEAST2_WRITE_VERSION);
  });
});

// ===========================================================================
// The released runtime, probed rather than assumed
// ===========================================================================

describe('beast2 wire versions — the released @elaraai/east', () => {
  let workDir: string | undefined;
  let releasedMax: number | undefined;
  let unavailable: string | undefined;

  before(() => {
    try {
      workDir = mkdtempSync(join(tmpdir(), 'e3-released-compat-'));
      writeFileSync(join(workDir, 'package.json'),
        JSON.stringify({ name: 'compat-probe', private: true, type: 'module' }), 'utf-8');
      run('npm', ['install', '--no-audit', '--no-fund', '--no-save',
        `@elaraai/east@${RELEASED_VERSION}`], workDir);
      // Probe, do not assume: ask the released decoder which versions it takes.
      const probe = join(workDir, 'probe.mjs');
      writeFileSync(probe, `
        import { decodeEastIR } from '@elaraai/east';
        const versions = JSON.parse(process.argv[2]);
        const ok = [];
        for (const [version, hex] of versions) {
          try { decodeEastIR(Buffer.from(hex, 'hex')); ok.push(version); } catch { /* unsupported */ }
        }
        process.stdout.write(JSON.stringify(ok));
      `, 'utf-8');
      const ir = sampleIr();
      const candidates = BEAST2_READ_VERSIONS.map(v =>
        [v, Buffer.from(encodeEastIR(ir, { version: v })).toString('hex')]);
      const accepted = JSON.parse(
        run(process.execPath, [probe, JSON.stringify(candidates)], workDir),
      ) as number[];
      releasedMax = accepted.length > 0 ? Math.max(...accepted) : 0;
    } catch (error) {
      // No network, or the version is not published yet. Skip loudly, do not
      // silently pass — this suite exists to be honest about compatibility.
      unavailable = `could not install @elaraai/east@${RELEASED_VERSION}: ${(error as Error).message.split('\n')[0]}`;
    }
  });

  it('reads the v4 container (released, therefore readable forever)', (t) => {
    if (unavailable) return t.skip(unavailable);
    assert.ok(releasedMax !== undefined && releasedMax >= 4,
      `the released runtime must still read v4; it accepted up to v${releasedMax}`);
  });

  it('does not read a container newer than this tree writes', (t) => {
    if (unavailable) return t.skip(unavailable);
    assert.ok(releasedMax! <= BEAST2_WRITE_VERSION,
      `released @elaraai/east@${RELEASED_VERSION} reads up to v${releasedMax}, but this tree ` +
      `writes v${BEAST2_WRITE_VERSION} — the tree is BEHIND the release, not ahead`);
  });

  it('reads what this tree writes by default', (t) => {
    if (unavailable) return t.skip(unavailable);
    if (releasedMax! < BEAST2_WRITE_VERSION) {
      return t.skip(
        `@elaraai/east@${RELEASED_VERSION} reads up to container v${releasedMax}, but this tree ` +
        `writes v${BEAST2_WRITE_VERSION}. Expected while a container bump is unreleased: the ` +
        `stance is lockstep (docs/conventions/BEAST2_WIRE_VERSION.md), so an older reader is not ` +
        `promised new bytes. This unskips itself once v${BEAST2_WRITE_VERSION} ships.`,
      );
    }
    assert.equal(releasedMax, BEAST2_WRITE_VERSION);
  });

  after(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });
});
