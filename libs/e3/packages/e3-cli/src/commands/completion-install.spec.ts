/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectShell, rcPath, installToFile, uninstallFromFile } from './completion-install.js';

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'e3-completion-test-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('detectShell', () => {
  it('detects bash from /bin/bash', () => {
    assert.strictEqual(detectShell({ SHELL: '/bin/bash' }), 'bash');
  });
  it('detects zsh from /usr/bin/zsh', () => {
    assert.strictEqual(detectShell({ SHELL: '/usr/bin/zsh' }), 'zsh');
  });
  it('detects fish from /usr/local/bin/fish', () => {
    assert.strictEqual(detectShell({ SHELL: '/usr/local/bin/fish' }), 'fish');
  });
  it('returns null for unknown shells', () => {
    assert.strictEqual(detectShell({ SHELL: '/bin/dash' }), null);
  });
  it('returns null when SHELL is unset', () => {
    assert.strictEqual(detectShell({}), null);
  });
});

describe('rcPath', () => {
  it('uses ~/.bashrc for bash', () => {
    assert.strictEqual(rcPath('bash', {}, '/home/u'), '/home/u/.bashrc');
  });
  it('uses ~/.zshrc for zsh by default', () => {
    assert.strictEqual(rcPath('zsh', {}, '/home/u'), '/home/u/.zshrc');
  });
  it('honours $ZDOTDIR for zsh', () => {
    assert.strictEqual(rcPath('zsh', { ZDOTDIR: '/etc/zsh' }, '/home/u'), '/etc/zsh/.zshrc');
  });
  it('uses ~/.config/fish/completions/e3.fish for fish', () => {
    assert.strictEqual(
      rcPath('fish', {}, '/home/u'),
      '/home/u/.config/fish/completions/e3.fish',
    );
  });
});

describe('installToFile — bash/zsh', () => {
  it('appends the eval line when the file is missing', () => {
    const target = join(tmp, 'fresh.bashrc');
    const out = installToFile('bash', target);
    assert.match(out, /Installed bash completion/);
    const content = readFileSync(target, 'utf-8');
    assert.match(content, /eval "\$\(e3 completion bash\)"/);
    assert.match(content, /# e3 completion/);
  });

  it('appends to a non-empty file, preserving prior content', () => {
    const target = join(tmp, 'existing.bashrc');
    writeFileSync(target, '# my stuff\nalias ls="ls -lh"\n');
    installToFile('bash', target);
    const content = readFileSync(target, 'utf-8');
    assert.ok(content.startsWith('# my stuff\nalias ls="ls -lh"\n'));
    assert.match(content, /eval "\$\(e3 completion bash\)"/);
  });

  it('is idempotent — re-running does not duplicate the eval line', () => {
    const target = join(tmp, 'idem.bashrc');
    installToFile('bash', target);
    installToFile('bash', target);
    const content = readFileSync(target, 'utf-8');
    const evalLines = content.split('\n').filter((l) => l.startsWith('eval "$(e3 completion'));
    assert.strictEqual(evalLines.length, 1);
  });

  it('handles files missing a trailing newline', () => {
    const target = join(tmp, 'no-newline.bashrc');
    writeFileSync(target, 'export FOO=1');
    installToFile('bash', target);
    const content = readFileSync(target, 'utf-8');
    assert.match(content, /export FOO=1\neval/);
  });
});

describe('installToFile — fish', () => {
  it('writes the completion file', () => {
    const target = join(tmp, 'fish', 'completions', 'e3.fish');
    const out = installToFile('fish', target);
    assert.match(out, /Installed fish completion/);
    assert.ok(existsSync(target));
    const content = readFileSync(target, 'utf-8');
    assert.match(content, /e3 fish completion/);
  });

  it('overwrites an existing file (no idempotency drama)', () => {
    const target = join(tmp, 'fish2', 'completions', 'e3.fish');
    installToFile('fish', target);
    const first = readFileSync(target, 'utf-8');
    installToFile('fish', target);
    const second = readFileSync(target, 'utf-8');
    assert.strictEqual(first, second);
  });
});

describe('uninstallFromFile — bash/zsh', () => {
  it('removes the marker line, leaving other content', () => {
    const target = join(tmp, 'uninst.bashrc');
    writeFileSync(target, '# my stuff\n');
    installToFile('bash', target);
    uninstallFromFile('bash', target);
    const content = readFileSync(target, 'utf-8');
    assert.match(content, /# my stuff/);
    assert.doesNotMatch(content, /e3 completion/);
  });

  it('returns a "not present" message when marker missing', () => {
    const target = join(tmp, 'clean.bashrc');
    writeFileSync(target, '# nothing here\n');
    const out = uninstallFromFile('bash', target);
    assert.match(out, /not present/);
  });

  it('returns a "no rc file" message when file is missing', () => {
    const target = join(tmp, 'does-not-exist');
    const out = uninstallFromFile('bash', target);
    assert.match(out, /No rc file/);
  });
});

describe('uninstallFromFile — fish', () => {
  it('removes the completion file when it exists', () => {
    const target = join(tmp, 'fish3', 'completions', 'e3.fish');
    installToFile('fish', target);
    const out = uninstallFromFile('fish', target);
    assert.match(out, /Removed/);
    assert.ok(!existsSync(target));
  });

  it('returns a "no file" message when nothing to remove', () => {
    const target = join(tmp, 'fish4', 'completions', 'e3.fish');
    const out = uninstallFromFile('fish', target);
    assert.match(out, /No completion file/);
  });
});
