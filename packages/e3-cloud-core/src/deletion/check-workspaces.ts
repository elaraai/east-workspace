/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Check Workspaces — Verifies no workspaces exist before repo deletion proceeds.
 */

export interface CheckWorkspacesInput {
  repo: string;
}

export interface CheckWorkspacesOutput {
  repo: string;
  hasWorkspaces: boolean;
  count: number;
}

export interface CheckWorkspacesDeps {
  listWorkspaces: (repo: string) => Promise<string[]>;
}

export async function handleCheckWorkspaces(
  deps: CheckWorkspacesDeps,
  input: CheckWorkspacesInput,
): Promise<CheckWorkspacesOutput> {
  const { repo } = input;
  const workspaces = await deps.listWorkspaces(repo);
  console.log(`Check workspaces for ${repo}: found ${workspaces.length}`);
  return { repo, hasWorkspaces: workspaces.length > 0, count: workspaces.length };
}
