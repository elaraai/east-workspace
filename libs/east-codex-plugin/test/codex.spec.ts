import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, lstatSync, readFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { patchFiles, shellReadPaths } from '../lib/codex-tools.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
function hook(event: Record<string, unknown>, deny = false): string {
  return execFileSync(process.execPath, [join(root, '.build/hooks/codex-tools.js')], {
    input: JSON.stringify(event), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, EAST_REQUIRE_SEARCH: deny ? 'deny' : '' },
  });
}

test('Codex multi-file patches retain added imports, spaces, moves and deletions', () => {
  const files = patchFiles('*** Begin Patch\n*** Add File: a b.ts\n+import { East } from "@elaraai/east";\n*** Update File: old.py\n*** Move to: new.py\n from east import East\n-old\n+new\n*** Delete File: gone.ts\n*** End Patch', '/project');
  assert.equal(files.length, 3);
  assert.equal(files[0]?.path, '/project/a b.ts');
  assert.equal(files[1]?.path, '/project/new.py');
  assert.equal(files[1]?.originalPath, '/project/old.py');
  assert.equal(files[2]?.deleted, true);
  assert.deepEqual(shellReadPaths('cd src && cat "a b.ts" | head -20', '/project'), ['/project/src/a b.ts']);
});

test('search gate blocks new imports in apply_patch and clears after an MCP search hook without transcripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'east-codex-gate-'));
  try {
    const base = { session_id: dir, cwd: dir, transcript_path: null };
    const event = { ...base, hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: app.ts\n+import { East } from "@elaraai/east";\n*** End Patch' } };
    assert.match(hook(event, true), /permissionDecision":"deny/);
    hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__east__search_east_examples', tool_response: { isError: true } });
    assert.match(hook(event, true), /permissionDecision":"deny/);
    hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_east-codex-plugin_east__search_east_examples', tool_response: { content: [] } });
    assert.equal(hook(event, true), '');
    assert.equal(hook({ ...event, tool_input: { command: '*** Begin Patch\n*** Add File: unrelated.ts\n+export const x = 1;\n*** End Patch' } }, true), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Codex patch and shell-read hooks diagnose TypeScript instead of relying on native LSP registration', () => {
  const fixture = resolve(root, '../east-diagnostics/test-fixtures/proj/bad.ts');
  const base = { cwd: root, hook_event_name: 'PostToolUse' };
  const patch = hook({ ...base, session_id: `patch-${Date.now()}`, tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${fixture}\n@@\n context\n*** End Patch` } });
  assert.match(patch, /no-redundant-east-cast/);
  const read = hook({ ...base, session_id: `read-${Date.now()}`, tool_name: 'Bash', tool_input: { command: `cat ${fixture}` } });
  assert.match(read, /no-unexecuted-east-expression/);
});

test('file reads and grep/glob preserve the shared example-search guidance', () => {
  const base = { session_id: 'read-guidance', cwd: root, hook_event_name: 'PreToolUse' };
  assert.match(hook({ ...base, tool_name: 'Read', tool_input: { file_path: '/p/node_modules/@elaraai/east/dist/index.d.ts' } }), /example index/);
  assert.match(hook({ ...base, tool_name: 'Glob', tool_input: { pattern: '**/*.examples.ts' } }), /example index/);
  assert.equal(hook({ ...base, tool_name: 'Read', tool_input: { file_path: '/p/src/app.ts' } }), '');
});

test('every shared skill is materialized and Codex-adapted', () => {
  const names = readdirSync(resolve(root, '../east-plugin/skills'));
  assert.equal(names.length, 16);
  for (const name of names) {
    const file = join(root, 'skills', name, 'SKILL.md');
    assert.ok(!lstatSync(file).isSymbolicLink());
    const text = readFileSync(file, 'utf8');
    const description = JSON.parse(/^description: (.+)$/m.exec(text)![1]!);
    assert.ok(description.length <= 1024);
    assert.doesNotMatch(description, /[<>]/);
    assert.match(text, /search_east_examples/);
    assert.doesNotMatch(text, /mcp__plugin_east_east__|\/east:|CLAUDE_PLUGIN_ROOT/);
  }
});

test('installed copy runs MCP search, fetch and both real LSP launchers without plugin node_modules or sibling repos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'east-codex-install-'));
  const installed = join(dir, 'plugin with spaces');
  mkdirSync(installed);
  for (const name of ['.build', '.codex-plugin', '.mcp.json', '.lsp.json', 'hooks', 'skills', 'index.json', 'package.json']) cpSync(join(root, name), join(installed, name), { recursive: true });
  const config = JSON.parse(readFileSync(join(installed, '.mcp.json'), 'utf8')) as {
    mcpServers: { east: { command: string; args: string[]; cwd?: string } };
  };
  const server = config.mcpServers.east;
  // Codex resolves cwd relative to the plugin, but passes legacy MCP args
  // literally: ${PLUGIN_ROOT} is a hook variable, not expanded here.
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: server.cwd === undefined ? dir : resolve(installed, server.cwd),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'east-codex-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(t => t.name);
    for (const name of ['search_east_examples', 'get_east_example', 'east_status', 'east_lsp_diagnostics']) assert.ok(tools.includes(name));
    const search = await client.callTool({ name: 'search_east_examples', arguments: { query: 'array map', language: 'python' } });
    assert.ok(!search.isError);
    assert.match(JSON.stringify(search), /east:/);
    const index = JSON.parse(readFileSync(join(installed, 'index.json'), 'utf8')) as { entries: { id: string }[] };
    const example = await client.callTool({ name: 'get_east_example', arguments: { id: index.entries[0]!.id } });
    assert.ok(!example.isError);
    const diagnostic = await client.callTool({ name: 'east_lsp_diagnostics', arguments: { file: resolve(root, '../east-diagnostics/test-fixtures/proj/bad.ts') } });
    assert.ok(!diagnostic.isError, JSON.stringify(diagnostic));
    assert.match(JSON.stringify(diagnostic), /no-redundant-east-cast/);
    const python = join(dir, 'plain.py'); writeFileSync(python, 'x = 1\n');
    const nullServer = await client.callTool({ name: 'east_lsp_diagnostics', arguments: { file: python, timeout_ms: 300 } });
    assert.ok(!nullServer.isError, JSON.stringify(nullServer));
    assert.match(JSON.stringify(nullServer), /outside the server scope|No diagnostic publication/);
    // Exercise the real Python launcher through its cold-lint fallback, with a
    // project-local stand-in so this test needs no Python toolchain.
    const pyProject = join(dir, 'python-project');
    const bin = join(pyProject, '.venv', 'bin');
    mkdirSync(bin, { recursive: true });
    const pyFile = join(pyProject, 'mod.py');
    writeFileSync(pyFile, 'from east import East, IntegerType\n');
    writeFileSync(join(bin, 'findings.json'), JSON.stringify([{ path: pyFile, rule: 'no-operator-fork', code: 'EAS002', category: 'error', line: 1, column: 1, message: 'Use East division' }]));
    const executable = join(bin, 'east-py');
    writeFileSync(executable, '#!/bin/sh\ncase "$1" in\nlint) cat "$(dirname "$0")/findings.json"; exit 1 ;;\n*) exit 1 ;;\nesac\n');
    chmodSync(executable, 0o755);
    const pyDiagnostics = await client.callTool({ name: 'east_lsp_diagnostics', arguments: { file: pyFile } });
    assert.ok(!pyDiagnostics.isError, JSON.stringify(pyDiagnostics));
    assert.match(JSON.stringify(pyDiagnostics), /EAS002|no-operator-fork/);
    const latest = await client.callTool({ name: 'east_lsp_diagnostics', arguments: { file: pyFile, refresh: false } });
    assert.match(JSON.stringify(latest), /Use East division/);
    const status = await client.callTool({ name: 'east_status', arguments: { directory: dir } });
    assert.ok(!status.isError);
    assert.match(JSON.stringify(status), /16:/);
    assert.doesNotMatch(JSON.stringify(status), /missing \d+:|Plugin.*check errored/);
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});
