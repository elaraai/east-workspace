/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Utility functions for e3-admin CLI.
 */

/**
 * Parse a repository URL into base URL and repo name.
 * Format: https://server/repos/{repo}
 */
export function parseRepoUrl(url: string): { baseUrl: string; repo: string } {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/repos\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid URL: expected /repos/{repo} in path`);
  }
  return {
    baseUrl: parsed.origin,
    repo: decodeURIComponent(match[1]),
  };
}

/**
 * Parse a workspace URL into base URL, repo name, and workspace name.
 * Format: https://server/repos/{repo}/workspaces/{workspace}
 */
export function parseWorkspaceUrl(url: string): { baseUrl: string; repo: string; workspace: string } {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/repos\/([^/]+)\/workspaces\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid URL: expected /repos/{repo}/workspaces/{workspace} in path`);
  }
  return {
    baseUrl: parsed.origin,
    repo: decodeURIComponent(match[1]),
    workspace: decodeURIComponent(match[2]),
  };
}

/**
 * Format error for CLI output.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Exit with error message.
 */
export function exitError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * Interactive yes/no confirmation prompt.
 * Returns true if user answers 'y' or 'yes', false otherwise.
 */
export async function confirm(message: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
