/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Internal entry — `@elaraai/e3-cli/internal`.
 *
 * Re-exports the pieces of the `e3` binary that another first-party binary
 * must share *exactly* rather than re-implement: how a `<repo>` argument is
 * resolved (`$E3_REPO`, local path, `https://host/repos/<repo>`), the
 * credential store and OAuth2 device flow behind `e3 auth`, the `auth`
 * command group itself, the dataset path resolver, the progress reporter,
 * and the formatters the CLI prints with. `@elaraai/e3-ui-cli` mounts these
 * so `e3-ui auth login` and `e3 auth login` are one code path and one
 * store, and so a repository opened in the terminal UI resolves the way
 * every `e3` command resolves it.
 *
 * This is not semver-stable API: it exists for the workspace's own binaries,
 * and a release may reshape it without notice. Application code should use
 * `@elaraai/e3-api-client` (remote) or `@elaraai/e3-core` (local) instead.
 *
 * @internal
 * @packageDocumentation
 */

export {
  defaultRepoArg,
  withDefaultRepo,
  parseRepoLocation,
  parseRepoLocationSync,
  resolveRepo,
  formatError,
  exitError,
  shortHash,
  HASH_DISPLAY_WIDTH,
  type RepoLocation,
  type RepoLocationNoToken,
} from './utils.js';

export {
  normalizeServerUrl,
  loadCredentials,
  getCredential,
  setCredential,
  removeCredential,
  listCredentials,
  isExpired,
  getValidToken,
  refreshAccessToken,
  fetchDiscovery,
  startDeviceAuth,
  pollForTokens,
  decodeJwtPayload,
  type CredentialEntry,
  type CredentialsFile,
  type OidcDiscovery,
  type DeviceAuthResponse,
  type TokenResponse,
} from './credentials.js';

export { createAuthCommand, createLoginCommand, createLogoutCommand } from './commands/auth.js';

export {
  buildWorkspaceIndex,
  resolveDatasetPath,
  resolveDatasetPathFromIndex,
  indexFromTree,
  indexFromRemoteEntries,
  suggestSimilar,
  levenshtein,
  type DatasetKind,
  type ResolvedEntry,
  type ResolvedPath,
} from './path-resolver.js';

export { createProgress, formatBytes, type Progress, type StepHandle, type ProgressStream } from './progress.js';

export { formatSize } from './format.js';

export { formatTaskStatus } from './commands/workspace.js';
