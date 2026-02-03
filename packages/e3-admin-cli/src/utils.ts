/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
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
