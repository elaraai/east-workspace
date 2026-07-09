/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * End-to-end integration tests for the complete e3 workflow.
 *
 * Tests the full pipeline:
 * 1. Create packages using the SDK (with East tasks and custom bash tasks)
 * 2. Export packages to .zip files
 * 3. Use CLI to initialize a repository
 * 4. Import packages via CLI
 * 5. Create and deploy workspaces
 * 6. Set input values
 * 7. Run dataflow execution with `e3 start`
 * 8. Validate output values are correct
 *
 * This tests a diamond dependency pattern:
 *
 *       input_a    input_b
 *          \        /
 *        task_left  task_right   (both read both inputs)
 *              \    /
 *            task_merge          (reads both task outputs)
 *                |
 *             output
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

// SDK imports
import e3 from '@elaraai/e3';
import { IntegerType, StringType, East } from '@elaraai/east';

describe('end-to-end workflow', () => {
  let testDir: string;
  let repoDir: string;
  let packageZipPath: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    packageZipPath = join(testDir, 'test-package.zip');
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  describe('diamond dependency with East tasks', () => {
    it('executes full workflow with east-py runner', async () => {
      // =====================================================================
      // Step 1: Create package using SDK
      // =====================================================================

      // Define inputs
      const input_a = e3.input('a', IntegerType, 10n);
      const input_b = e3.input('b', IntegerType, 5n);

      // Left branch: computes a + b
      const task_left = e3.task(
        'left',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.add(b)
        )
      );

      // Right branch: computes a * b
      const task_right = e3.task(
        'right',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.multiply(b)
        )
      );

      // Merge: computes left + right = (a+b) + (a*b)
      const task_merge = e3.task(
        'merge',
        [task_left.output, task_right.output],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, left, right) => left.add(right)
        )
      );

      // Create package with all tasks
      const pkg = e3.package('diamond-test', '1.0.0', task_merge);

      console.log('=== Package Contents ===');
      for (const item of pkg.contents) {
        if (item.kind === 'dataset') {
          console.log(`  dataset: ${item.name} at ${JSON.stringify(item.path)}`);
        } else if (item.kind === 'datatree') {
          console.log(`  tree: ${item.name} at ${JSON.stringify(item.path)}`);
        } else if (item.kind === 'task') {
          console.log(`  task: ${item.name}`);
          console.log(`    inputs: ${item.inputs.map(i => JSON.stringify(i.path)).join(', ')}`);
        }
      }

      // =====================================================================
      // Step 2: Export package to .zip file
      // =====================================================================

      await e3.export(pkg, packageZipPath);
      assert.ok(existsSync(packageZipPath), 'Package zip should exist');

      // =====================================================================
      // Step 3: Initialize repository via CLI
      // =====================================================================

      const initResult = await runE3Command(['repo', 'create', repoDir], testDir);
      assert.strictEqual(initResult.exitCode, 0, `init failed: ${initResult.stderr}`);
      assert.ok(existsSync(join(repoDir, 'objects')), 'repository should exist');

      // =====================================================================
      // Step 4: Import package via CLI
      // =====================================================================

      const importResult = await runE3Command(
        ['package', 'import', repoDir, packageZipPath],
        testDir
      );
      assert.strictEqual(importResult.exitCode, 0, `import failed: ${importResult.stderr}`);

      // Verify package is listed
      const listPkgResult = await runE3Command(['package', 'list', repoDir], testDir);
      assert.strictEqual(listPkgResult.exitCode, 0, `package list failed: ${listPkgResult.stderr}`);
      assert.ok(listPkgResult.stdout.includes('diamond-test'), 'Package should be listed');
      assert.ok(listPkgResult.stdout.includes('1.0.0'), 'Version should be listed');

      // =====================================================================
      // Step 5: Create workspace via CLI
      // =====================================================================

      const wsCreateResult = await runE3Command(
        ['workspace', 'create', repoDir, 'test-ws'],
        testDir
      );
      assert.strictEqual(wsCreateResult.exitCode, 0, `workspace create failed: ${wsCreateResult.stderr}`);

      // =====================================================================
      // Step 6: Deploy package to workspace via CLI
      // =====================================================================

      const deployResult = await runE3Command(
        ['workspace', 'deploy', repoDir, 'test-ws', 'diamond-test@1.0.0'],
        testDir
      );
      assert.strictEqual(deployResult.exitCode, 0, `deploy failed: ${deployResult.stderr}`);

      // =====================================================================
      // Step 7: Check workspace status - should show tasks need execution
      // =====================================================================

      const statusResult = await runE3Command(['workspace', 'status', repoDir, 'test-ws'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);

      // =====================================================================
      // Step 8: Run dataflow execution with `e3 start`
      // =====================================================================

      // First let's check what we have
      const listResult = await runE3Command(['dataset', 'list', repoDir, 'test-ws'], testDir);
      console.log('=== List before start ===');
      console.log(listResult.stdout);

      const startResult = await runE3Command(
        ['dataflow', 'run', repoDir, 'test-ws'],
        testDir
      );
      console.log('=== Start result ===');
      console.log('stdout:', startResult.stdout);
      console.log('stderr:', startResult.stderr);
      console.log('exitCode:', startResult.exitCode);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Check that execution completed
      assert.ok(
        startResult.stdout.includes('success') || startResult.stdout.includes('completed') || startResult.stdout.toLowerCase().includes('executed'),
        `Execution should indicate success: ${startResult.stdout}`
      );

      // =====================================================================
      // Step 9: Validate output values
      // =====================================================================

      // Get the merge task output: should be (10+5) + (10*5) = 15 + 50 = 65
      const getResult = await runE3Command(
        ['dataset', 'get', repoDir, 'test-ws.merge'],
        testDir
      );
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);

      // The output should contain the value 65
      assert.ok(
        getResult.stdout.includes('65'),
        `Output should be 65, got: ${getResult.stdout}`
      );

      // Also verify intermediate results
      const getLeftResult = await runE3Command(
        ['dataset', 'get', repoDir, 'test-ws.left'],
        testDir
      );
      assert.strictEqual(getLeftResult.exitCode, 0, `get left failed: ${getLeftResult.stderr}`);
      assert.ok(getLeftResult.stdout.includes('15'), `Left should be 15, got: ${getLeftResult.stdout}`);

      const getRightResult = await runE3Command(
        ['dataset', 'get', repoDir, 'test-ws.right'],
        testDir
      );
      assert.strictEqual(getRightResult.exitCode, 0, `get right failed: ${getRightResult.stderr}`);
      assert.ok(getRightResult.stdout.includes('50'), `Right should be 50, got: ${getRightResult.stdout}`);
    });

    it('handles input value changes and re-execution', async () => {
      // Create a simple package with one task
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('double-test', '1.0.0', task_double);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'double-test@1.0.0'], testDir);

      // Run with default value (10)
      let startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `first start failed: ${startResult.stderr}`);

      let getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.double'], testDir);
      assert.ok(getResult.stdout.includes('20'), `Output should be 20, got: ${getResult.stdout}`);

      // Change input value to 25
      // Note: e3 set requires a file, so we write the value to a .east file first
      const newValuePath = join(testDir, 'new_value.east');
      writeFileSync(newValuePath, '25');
      const setResult = await runE3Command(
        ['dataset', 'set', repoDir, 'ws.x', newValuePath],
        testDir
      );
      assert.strictEqual(setResult.exitCode, 0, `set failed: ${setResult.stderr}`);

      // Verify the input was actually changed
      const getInputResult = await runE3Command(['dataset', 'get', repoDir, 'ws.x'], testDir);
      assert.ok(getInputResult.stdout.includes('25'), `Input should be 25 after set, got: ${getInputResult.stdout}`);

      // Re-run - should compute new value (input changed, so cache should miss)
      startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `second start failed: ${startResult.stderr}`);

      getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.double'], testDir);
      assert.ok(getResult.stdout.includes('50'), `Output should be 50 after change, got: ${getResult.stdout}`);
    });
  });

  describe('custom tasks with bash commands', () => {
    it('executes customTask with bash script', async () => {
      // Create a custom task that uses bash to transform data
      // This simulates a task that might call external tools like Python

      const input_text = e3.input('text', StringType, 'hello');

      // Custom task that uses bash to uppercase the input
      // The command function receives input paths and output path
      const task_upper = e3.customTask(
        'upper',
        [input_text],
        StringType,
        ($, inputs, output) => {
          // Read beast2 input, decode, uppercase, re-encode, write to output
          // For simplicity, we just copy the file (real test would transform)
          return East.str`cp ${inputs.get(0n)} ${output}`;
        }
      );

      const pkg = e3.package('custom-test', '1.0.0', task_upper);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      const importResult = await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      assert.strictEqual(importResult.exitCode, 0, `import failed: ${importResult.stderr}`);

      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'custom-test@1.0.0'], testDir);

      // Run
      const startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Verify output exists (content should be same as input since we just copied)
      const getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.upper'], testDir);
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);
      assert.ok(getResult.stdout.includes('hello'), `Output should contain 'hello', got: ${getResult.stdout}`);
    });
  });

  describe('mixed East and custom tasks', () => {
    it('executes workflow with both task types', async () => {
      // Input: a number
      const input_n = e3.input('n', IntegerType, 7n);

      // East task: compute n * 2
      const task_double = e3.task(
        'double',
        [input_n],
        East.function(
          [IntegerType],
          IntegerType,
          ($, n) => n.multiply(2n)
        )
      );

      // Custom task: copy the result (simulating external processing)
      const task_process = e3.customTask(
        'process',
        [task_double.output],
        IntegerType,
        ($, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`
      );

      // East task: add 1 to the processed result
      const task_increment = e3.task(
        'increment',
        [task_process.output],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.add(1n)
        )
      );

      const pkg = e3.package('mixed-test', '1.0.0', task_increment);

      // Export and set up
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'mixed-test@1.0.0'], testDir);

      // Run
      const startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // Verify: (7 * 2) + 1 = 15
      const getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.increment'], testDir);
      assert.strictEqual(getResult.exitCode, 0, `get failed: ${getResult.stderr}`);
      assert.ok(getResult.stdout.includes('15'), `Output should be 15, got: ${getResult.stdout}`);
    });
  });


  describe('status command', () => {
    it('shows dataset status detail', async () => {
      // Create a simple package with one task
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('status-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-test@1.0.0'], testDir);

      // Check input status — should show set with hash and size
      let statusResult = await runE3Command(['dataset', 'status', repoDir, 'ws.x'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: set/, 'Input should show Status: set');
      assert.match(statusResult.stdout, /Hash:/, 'Input should show Hash');
      assert.match(statusResult.stdout, /Size:/, 'Input should show Size');
      assert.match(statusResult.stdout, /Type:/, 'Should show Type');

      // Check task output status — should show unset
      statusResult = await runE3Command(['dataset', 'status', repoDir, 'ws.double'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: unset/, 'Task output should show Status: unset');

      // Execute dataflow
      const startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // After execution: task output should now show set
      statusResult = await runE3Command(['dataset', 'status', repoDir, 'ws.double'], testDir);
      assert.strictEqual(statusResult.exitCode, 0, `status after start failed: ${statusResult.stderr}`);
      assert.match(statusResult.stdout, /Status: set/, 'Task output should show Status: set after execution');
      assert.match(statusResult.stdout, /Hash:/, 'Task output should show Hash after execution');
      assert.match(statusResult.stdout, /Size:/, 'Task output should show Size after execution');

      // `dataset list -l` tabular output against the same executed
      // workspace (merged from the former standalone list test so the CLI
      // table surface keeps coverage without a second dataflow run)
      let listResult = await runE3Command(['dataset', 'list', repoDir, 'ws', '-l'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list -l failed: ${listResult.stderr}`);
      assert.doesNotMatch(listResult.stdout, /\bunset\b/, 'No datasets should be unset after execution');
      assert.match(listResult.stdout, /\bset\b/, 'Datasets should show set');
      assert.match(listResult.stdout, /\d+ B/, 'Should show byte sizes');
      assert.match(listResult.stdout, /Integer/, 'Should show types');

      // Paths only (no -l) should return flat dot-separated paths
      listResult = await runE3Command(['dataset', 'list', repoDir, 'ws'], testDir);
      assert.strictEqual(listResult.exitCode, 0, `list failed: ${listResult.stderr}`);
      assert.match(listResult.stdout, /ws\.x/, 'Should show input path');
      assert.match(listResult.stdout, /ws\.double/, 'Should show task path');
    });

    it('reports error for non-existent field', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('status-err-field', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-err-field@1.0.0'], testDir);

      // Typo in field name
      const result = await runE3Command(['dataset', 'status', repoDir, 'ws.typo'], testDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should fail for non-existent field');
      assert.match(result.stderr, /not found/i, 'Should mention field not found');
    });

    it('reports error when path points to tree', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('status-err-tree', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'status-err-tree@1.0.0'], testDir);

      // Path points to a tree (inputs), not a dataset
      const result = await runE3Command(['dataset', 'status', repoDir, 'ws.inputs'], testDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should fail when path points to tree');
      assert.match(result.stderr, /tree, not a dataset/, 'Should mention tree vs dataset');
    });
  });




  describe('per-dataset ref files', () => {
    it('creates ref files after deploy', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('ref-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-test@1.0.0'], testDir);

      // After deploy, ref files should exist in workspaces/ws/data/
      const dataDir = join(repoDir, 'workspaces', 'ws', 'data');
      assert.ok(existsSync(dataDir), 'workspace data directory should exist');

      // Check for ref files — the structure has inputs.x, tasks.double.output,
      // tasks.double.function_ir. Ref files end in .ref
      const refFiles = findRefFiles(dataDir);
      assert.ok(refFiles.length >= 3, `Should have at least 3 ref files (input, output, function_ir), found ${refFiles.length}: ${refFiles.join(', ')}`);

      // Input should have a value ref (it has a default value)
      const inputRefPath = join(dataDir, 'inputs', 'x.ref');
      assert.ok(existsSync(inputRefPath), `Input ref file should exist at ${inputRefPath}`);

      // Verify input has a value (not unassigned)
      const getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.x'], testDir);
      assert.ok(getResult.stdout.includes('10'), `Input default should be 10, got: ${getResult.stdout}`);
    });

    it('updates ref files after set', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const pkg = e3.package('ref-set-test', '1.0.0', input_x);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-set-test@1.0.0'], testDir);

      // Read ref file before set
      const inputRefPath = join(repoDir, 'workspaces', 'ws', 'data', 'inputs', 'x.ref');
      assert.ok(existsSync(inputRefPath), 'Input ref should exist');
      const refBefore = readFileSync(inputRefPath);

      // Set a new value
      const valuePath = join(testDir, 'val.east');
      writeFileSync(valuePath, '99');
      await runE3Command(['dataset', 'set', repoDir, 'ws.x', valuePath], testDir);

      // Ref file should be updated (different content)
      const refAfter = readFileSync(inputRefPath);
      assert.ok(!refBefore.equals(refAfter), 'Ref file content should change after set');

      // Verify new value
      const getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.x'], testDir);
      assert.ok(getResult.stdout.includes('99'), `Input should be 99, got: ${getResult.stdout}`);
    });

    it('populates task output refs after start', async () => {
      const input_x = e3.input('x', IntegerType, 10n);
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('ref-start-test', '1.0.0', task_double);
      await e3.export(pkg, packageZipPath);

      await runE3Command(['repo', 'create', repoDir], testDir);
      await runE3Command(['package', 'import', repoDir, packageZipPath], testDir);
      await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
      await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'ref-start-test@1.0.0'], testDir);

      // Before start, task output status should be unset
      const statusBefore = await runE3Command(
        ['dataset', 'status', repoDir, 'ws.double'],
        testDir
      );
      assert.match(statusBefore.stdout, /unset/, 'Task output should be unset before start');

      // Run start
      const startResult = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
      assert.strictEqual(startResult.exitCode, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

      // After start, task output should be set with correct value
      const statusAfter = await runE3Command(
        ['dataset', 'status', repoDir, 'ws.double'],
        testDir
      );
      assert.match(statusAfter.stdout, /Status: set/, 'Task output should be set after start');

      // Verify value: 10 * 2 = 20
      const getResult = await runE3Command(['dataset', 'get', repoDir, 'ws.double'], testDir);
      assert.ok(getResult.stdout.includes('20'), `Output should be 20, got: ${getResult.stdout}`);

      // Output ref file should exist
      const outputRefPath = join(repoDir, 'workspaces', 'ws', 'data', 'tasks', 'double', 'output.ref');
      assert.ok(existsSync(outputRefPath), 'Output ref file should exist after start');
    });
  });
});

/**
 * Recursively find all .ref files in a directory.
 */
function findRefFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRefFiles(fullPath));
    } else if (entry.name.endsWith('.ref')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('reactive caching — change one input, only its tasks recompute', () => {
  let testDir: string;
  let repoDir: string;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  // Deploy a package of INDEPENDENT tasks once, then mutate one input and
  // re-run — the reactive dataflow must recompute only the task fed by the
  // changed input and serve the rest from the execution cache. (One deploy →
  // one compile → stored IR; no re-export, so this is pure runtime caching.)
  it('changing one input re-runs only its task; the independent tasks stay CACHED', async () => {
    // customTasks (bash) need no runtime runner, so this is self-contained.
    // Each task copies its own input to its output — an independent branch.
    const a = e3.input('a', StringType, 'a1');
    const b = e3.input('b', StringType, 'b1');
    const c = e3.input('c', StringType, 'c1');
    const taskA = e3.customTask('task_a', [a], StringType, (_$, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`);
    const taskB = e3.customTask('task_b', [b], StringType, (_$, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`);
    const taskC = e3.customTask('task_c', [c], StringType, (_$, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`);
    await e3.export(e3.package('reactive', '1.0.0', taskA, taskB, taskC), join(testDir, 'reactive.zip'));

    await runE3Command(['repo', 'create', repoDir], testDir);
    await runE3Command(['package', 'import', repoDir, join(testDir, 'reactive.zip')], testDir);
    await runE3Command(['workspace', 'create', repoDir, 'ws'], testDir);
    await runE3Command(['workspace', 'deploy', repoDir, 'ws', 'reactive@1.0.0'], testDir);

    // First run: all three execute.
    const run1 = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
    assert.strictEqual(run1.exitCode, 0, `run1 failed: ${run1.stderr}\n${run1.stdout}`);
    for (const t of ['task_a', 'task_b', 'task_c']) {
      assert.match(run1.stdout, new RegExp(`\\[DONE\\][^\\n]*${t}`), `${t} runs first time`);
    }

    // Change ONLY input a.
    const valuePath = join(testDir, 'a.east');
    writeFileSync(valuePath, '"a2"');
    const set = await runE3Command(['dataset', 'set', repoDir, 'ws.a', valuePath], testDir);
    assert.strictEqual(set.exitCode, 0, `set failed: ${set.stderr}`);

    // Second run: only task_a re-executes; task_b and task_c are CACHED.
    const run2 = await runE3Command(['dataflow', 'run', repoDir, 'ws'], testDir);
    assert.strictEqual(run2.exitCode, 0, `run2 failed: ${run2.stderr}\n${run2.stdout}`);
    assert.match(run2.stdout, /\[DONE\][^\n]*task_a/, 'task_a re-runs (its input changed)');
    assert.match(run2.stdout, /\[CACHED\][^\n]*task_b/, 'task_b CACHED (input unchanged)');
    assert.match(run2.stdout, /\[CACHED\][^\n]*task_c/, 'task_c CACHED (input unchanged)');
    assert.doesNotMatch(run2.stdout, /\[DONE\][^\n]*task_b/, 'task_b must NOT re-execute');
    assert.doesNotMatch(run2.stdout, /\[DONE\][^\n]*task_c/, 'task_c must NOT re-execute');

    // task_a now carries the new value (copied through).
    const get = await runE3Command(['dataset', 'get', repoDir, 'ws.task_a'], testDir);
    assert.ok(get.stdout.includes('a2'), `task_a should carry 'a2', got: ${get.stdout}`);
  });
});
