/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How an environment's installs run: uv, npm and pnpm, in its build
 * directory, from the settings' environment and as their user and group.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { giveDirectory, type ProcessSettings } from './processExec.js';

const execFileAsync = promisify(execFile);

/** The longest command line cmd.exe runs. */
const CMD_LINE_MAX = 8191;

/**
 * Whether an install's command runs through a shell, on Windows, where a
 * batch file (`.cmd`, `.bat`) is run by cmd.exe alone: npm and pnpm, which are
 * `npm.cmd` and `pnpm.cmd` there, and uv where the path holds it as a batch
 * file and no executable, as a tool manager may install it. uv is otherwise
 * an executable, run as one, found as Windows finds one (`.com`, `.exe`)
 * wherever it is on the path: cmd.exe caps a command line at 8191
 * characters, which a sync that leaves out each package of a large lock
 * passes.
 *
 * @internal
 * @param command - The command
 * @param platform - The platform it runs on
 * @param searchPath - The directories it is looked for in, as Windows's
 *   `PATH` lists them, between semicolons
 * @returns Whether it runs through a shell
 * @example
 * installShell('uv', 'win32', 'C:\\tools\\shims'); // true where that directory holds uv.cmd and no uv.exe is on the path
 */
export function installShell(command: string, platform: NodeJS.Platform = process.platform, searchPath: string = pathOf(process.env)): boolean {
  if (platform !== 'win32') return false;
  if (command === 'npm' || command === 'pnpm') return true;
  const dirs = searchPath.split(';').filter((dir) => dir !== '');
  const anywhere = (extensions: readonly string[]): boolean =>
    dirs.some((dir) => extensions.some((extension) => existsSync(path.join(dir, `${command}${extension}`))));
  return !anywhere(['.com', '.exe']) && anywhere(['.bat', '.cmd']);
}

/** The directories an environment's `PATH` lists, whatever case its name is
 *  written in, as Windows reads it. */
function pathOf(env: Readonly<Record<string, string | undefined>>): string {
  const name = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  return name === undefined ? '' : env[name] ?? '';
}

/**
 * Runs an install in the build directory, as the settings say: from their
 * environment, as is, and as their user and group.
 *
 * @internal
 * @param command - The command: uv, npm or pnpm
 * @param args - Its arguments
 * @param cwd - The build directory
 * @param what - What the install is, as a failure names it
 * @param settings - The environment, user and group it runs with
 * @throws {Error} When it fails, with what it wrote to stderr, or when its
 *   command line is longer than cmd.exe, which runs a batch file, takes
 */
export async function run(command: string, args: string[], cwd: string, what: string, settings: ProcessSettings): Promise<void> {
  const shell = installShell(command, process.platform, pathOf(settings.env ?? process.env));
  const line = [command, ...args].join(' ').length;
  if (shell && line > CMD_LINE_MAX) {
    throw new Error(`environment materialization: ${what} needs a command line of ${line} characters, and ${command} is found here as a batch file, ` +
      `which cmd.exe runs, whose command line is at most ${CMD_LINE_MAX}: install ${command} as an executable (${command}.exe)`);
  }
  try {
    await execFileAsync(command, args, {
      cwd,
      shell,
      maxBuffer: 16 * 1024 * 1024,
      env: settings.env,
      uid: settings.uid,
      gid: settings.gid,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(`environment materialization: ${what} ('${command} ${args.join(' ')}') failed:\n${stderr}`);
  }
}

/**
 * Whether something is at a path.
 *
 * @internal
 * @param p - The path
 * @returns Whether it can be reached
 */
export async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Gives `dir` and every directory under it to the user and group the installs
 * run as, so they can write in each; settings that name neither give nothing.
 *
 * @internal
 * @param dir - The directory
 * @param settings - The user and group the installs run as
 */
export async function giveDirectories(dir: string, settings: ProcessSettings): Promise<void> {
  if (settings.uid === undefined && settings.gid === undefined) return;
  await giveDirectory(dir, settings);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await giveDirectories(path.join(dir, entry.name), settings);
  }
}
