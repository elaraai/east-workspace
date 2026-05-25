/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Load a PackageDef from a TypeScript source file.
 *
 * Shared by `e3 watch` (auto-deploy on save) and `e3 workspace deploy
 * --from-source` (one-shot). esbuild bundles the entry (handling multi-file TS
 * and the nearest tsconfig.json); the bundle is dynamic-imported and its
 * default export validated as a PackageDef.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import type { PackageDef } from '@elaraai/e3';

/** Result of loading a package file, including the bundled source files (for watching). */
export interface LoadResult {
  pkg: PackageDef<Record<string, unknown>>;
  watchedFiles: string[];
}

export async function loadPackageFile(filePath: string): Promise<LoadResult> {
  const absolutePath = path.resolve(filePath);

  // Bundle with esbuild — handles multi-file TS, ESM packages, and tsconfig automatically.
  const result = esbuild.buildSync({
    entryPoints: [absolutePath],
    bundle: true,
    platform: 'node',
    format: 'esm', // ESM output for ESM-only packages like @elaraai/e3
    write: false,
    metafile: true,
    external: ['@elaraai/*'],
    logLevel: 'silent',
  });

  const jsCode = result.outputFiles?.[0]?.text;
  if (!jsCode) {
    throw new Error(`esbuild produced no output for ${filePath}`);
  }

  // esbuild metafile paths are relative to cwd; resolve and drop node_modules.
  const watchedFiles = result.metafile
    ? Object.keys(result.metafile.inputs)
        .map(f => path.resolve(f))
        .filter(f => !f.includes('node_modules'))
    : [absolutePath];

  // Write the bundle under the project's node_modules so external @elaraai/*
  // resolution works, and to avoid cross-realm instanceof issues.
  const tempDir = path.join(path.dirname(absolutePath), 'node_modules', '.cache', 'e3');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `bundle-${Date.now()}.mjs`);
  let defaultExport: unknown;
  try {
    fs.writeFileSync(tempFile, jsCode);
    // Cache-busting query avoids Node's ESM module cache across reloads.
    const moduleExports = await import(`${tempFile}?t=${Date.now()}`) as Record<string, unknown>;
    defaultExport = moduleExports.default ?? moduleExports;
  } catch (err) {
    if (err instanceof Error && err.stack) {
      console.error('Stack trace:', err.stack);
    }
    throw new Error(`Failed to execute ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  if (!defaultExport || (defaultExport as { kind?: string }).kind !== 'package') {
    throw new Error(
      `Default export must be a PackageDef (created with e3.package()).\n\n` +
      `Expected:\n` +
      `  const pkg = e3.package('name', '1.0.0', ...tasks);\n` +
      `  export default pkg;\n\n` +
      `Got: ${typeof defaultExport}${(defaultExport as { kind?: string }).kind ? ` with kind="${(defaultExport as { kind?: string }).kind}"` : ''}`,
    );
  }

  return { pkg: defaultExport as PackageDef<Record<string, unknown>>, watchedFiles };
}
