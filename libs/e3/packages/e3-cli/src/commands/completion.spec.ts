/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { COMPLETION_SCRIPTS } from './completion.js';

/**
 * Sanity checks for the generated shell scripts.
 *
 * We don't run the completion (would need real workspaces and shell sessions);
 * we just verify the script is syntactically valid in its target shell.
 * Tests skip cleanly when a shell isn't installed.
 */

function checkSyntax(shell: string, script: string): { ok: boolean; stderr: string; skipped?: boolean } {
  const result = spawnSync(shell, ['-n'], { input: script, encoding: 'utf-8' });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    return { ok: true, stderr: '', skipped: true };
  }
  return { ok: result.status === 0, stderr: result.stderr };
}

describe('completion scripts — shell syntax', () => {
  it('bash script parses cleanly', () => {
    const r = checkSyntax('bash', COMPLETION_SCRIPTS.bash);
    if (r.skipped) return;
    assert.strictEqual(r.ok, true, `bash -n failed: ${r.stderr}`);
  });

  it('zsh script parses cleanly', () => {
    const r = checkSyntax('zsh', COMPLETION_SCRIPTS.zsh);
    if (r.skipped) return;
    assert.strictEqual(r.ok, true, `zsh -n failed: ${r.stderr}`);
  });

  it('fish script parses cleanly', () => {
    const r = checkSyntax('fish', COMPLETION_SCRIPTS.fish);
    if (r.skipped) return;
    assert.strictEqual(r.ok, true, `fish -n failed: ${r.stderr}`);
  });

  it('every script references the __complete delegate', () => {
    for (const [name, script] of Object.entries(COMPLETION_SCRIPTS)) {
      assert.match(script, /e3 __complete/, `${name} script must delegate to e3 __complete`);
    }
  });
});
