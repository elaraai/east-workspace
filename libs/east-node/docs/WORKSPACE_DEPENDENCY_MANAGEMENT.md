# Workspace Dependency Management: Audit, Bug Report & Design Proposal

## Executive Summary

This document provides a comprehensive audit of dependency management across all Elara monorepos, identifies a critical bug in how intra-repo dependencies are handled during publishing, and proposes an improved approach.

**Key Finding**: The `@elaraai/east-node-io` package publishes `"@elaraai/east-node-std": "*"` in its peerDependencies because the publish workflow only updates devDependencies, not peerDependencies.

**Root Cause**: Inconsistent handling of intra-repo dependencies across repos, combined with a flawed pattern of committing resolved versions back to the codebase.

**Proposed Solution**: Modify publish workflows to temporarily resolve `*` versions for publishing, then revert to `*` before committing.

---

## Table of Contents

1. [Monorepo Overview](#1-monorepo-overview)
2. [Dependency Classification](#2-dependency-classification)
3. [Full Audit Results](#3-full-audit-results)
4. [Published Package Verification](#4-published-package-verification)
5. [Bug Report](#5-bug-report)
6. [Current Workflow Analysis](#6-current-workflow-analysis)
7. [Proposed Solution](#7-proposed-solution)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Monorepo Overview

| Repo | Packages | Description |
|------|----------|-------------|
| **east** | `@elaraai/east` | Base language package (single package, not a monorepo) |
| **east-py** | `@elaraai/east-py-datascience` | Python/data science platform functions |
| **east-node** | `@elaraai/east-node-std`, `@elaraai/east-node-io`, `@elaraai/east-node-cli` | Node.js platform functions |
| **e3** | `@elaraai/e3-types`, `@elaraai/e3`, `@elaraai/e3-core`, `@elaraai/e3-cli`, `@elaraai/e3-api-client`, `@elaraai/e3-api-server` | East Execution Engine |
| **east-ui** | `@elaraai/east-ui`, `@elaraai/east-ui-components`, `east-ui-preview`, `@elaraai/east-ui-showcase` | UI components and tooling |

### Package Dependency Graph

```
@elaraai/east (base)
    │
    ├─► @elaraai/east-node-std
    │       │
    │       ├─► @elaraai/east-node-io (peer + dev)
    │       ├─► @elaraai/east-node-cli
    │       ├─► @elaraai/east-py-datascience (peer)
    │       └─► @elaraai/e3-api-client (dev)
    │
    ├─► @elaraai/east-ui
    │       │
    │       └─► @elaraai/east-ui-components (peer)
    │
    └─► @elaraai/e3-types
            │
            ├─► @elaraai/e3
            │       │
            │       └─► @elaraai/e3-core
            │               │
            │               ├─► @elaraai/e3-cli
            │               └─► @elaraai/e3-api-server
            │
            └─► @elaraai/e3-api-client
```

---

## 2. Dependency Classification

### Definitions

| Type | Description | Expected Version Format |
|------|-------------|------------------------|
| **INTRA-REPO** | Dependency on package within the SAME monorepo | `*` in source, resolved at publish |
| **INTER-REPO** | Dependency on package from DIFFERENT monorepo | Static version (e.g., `^0.0.1-beta.29`) |

### Rationale

- **INTRA-REPO deps should use `*`**: During development, npm workspaces symlink local packages regardless of version. Using `*` makes this explicit and avoids version drift in the codebase.

- **INTER-REPO deps should use static versions**: These reference external packages that are installed from npm, so they need explicit version constraints.

---

## 3. Full Audit Results

### 3.1 east (single package)

No dependencies on other `@elaraai/*` packages. This is the base package.

---

### 3.2 east-py

#### @elaraai/east-py-datascience

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-node-std | peerDependencies | `^0.0.1-beta.19` | INTER-REPO | ✅ Correct |

**publish.yml coverage**: No intra-repo dependencies to update.

---

### 3.3 east-node

#### @elaraai/east-node-std

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

#### @elaraai/east-node-io

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-node-std | peerDependencies | `*` | INTRA-REPO | ⚠️ Not updated by publish.yml |
| @elaraai/east-node-std | devDependencies | `^0.0.1-beta.19` | INTRA-REPO | ⚠️ Static, updated by publish.yml |

#### @elaraai/east-node-cli

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

#### publish.yml coverage

```yaml
- name: Update east-node-io workspace dependency
  if: ${{ inputs.publish_east_node_io && inputs.publish_east_node_std }}
  run: |
    EAST_NODE_STD_VERSION=$(node -p "require('./packages/east-node-std/package.json').version")
    cd packages/east-node-io
    npm pkg set "devDependencies.@elaraai/east-node-std=^${EAST_NODE_STD_VERSION}"
```

| Dependency Path | Covered? | Issue |
|-----------------|----------|-------|
| east-node-io → east-node-std (devDeps) | ✅ Yes | None |
| east-node-io → east-node-std (peerDeps) | ❌ **NO** | **BUG: Published as `*`** |

---

### 3.4 e3

#### @elaraai/e3-types

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

#### @elaraai/e3

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |

#### @elaraai/e3-core

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3 | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |

#### @elaraai/e3-cli

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3 | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |
| @elaraai/e3-core | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |

#### @elaraai/e3-api-client

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |
| @elaraai/east-node-std | devDependencies | `^0.0.1-beta.19` | INTER-REPO | ✅ Correct |

#### @elaraai/e3-api-server

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-core | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static in codebase |

#### publish.yml coverage

```yaml
- name: Update workspace dependencies
  run: |
    E3_TYPES_VERSION=$(node -p "require('./packages/e3-types/package.json').version")
    E3_VERSION=$(node -p "require('./packages/e3/package.json').version")
    E3_CORE_VERSION=$(node -p "require('./packages/e3-core/package.json').version")

    # e3 depends on e3-types
    cd packages/e3
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    cd ../..

    # e3-core depends on e3 and e3-types
    cd packages/e3-core
    npm pkg set "dependencies.@elaraai/e3=^${E3_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    cd ../..

    # e3-cli depends on e3, e3-core and e3-types
    cd packages/e3-cli
    npm pkg set "dependencies.@elaraai/e3=^${E3_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-core=^${E3_CORE_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    cd ../..

    # e3-api-client depends on e3-types
    cd packages/e3-api-client
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    cd ../..

    # e3-api-server depends on e3-core and e3-types
    cd packages/e3-api-server
    npm pkg set "dependencies.@elaraai/e3-core=^${E3_CORE_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    cd ../..
```

| Dependency Path | Covered? |
|-----------------|----------|
| e3 → e3-types | ✅ Yes |
| e3-core → e3 | ✅ Yes |
| e3-core → e3-types | ✅ Yes |
| e3-cli → e3 | ✅ Yes |
| e3-cli → e3-core | ✅ Yes |
| e3-cli → e3-types | ✅ Yes |
| e3-api-client → e3-types | ✅ Yes |
| e3-api-server → e3-core | ✅ Yes |
| e3-api-server → e3-types | ✅ Yes |

---

### 3.5 east-ui

#### @elaraai/east-ui

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

#### @elaraai/east-ui-components

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | peerDependencies | `^0.0.1-beta.19` | INTRA-REPO | ⚠️ Static in codebase |

#### east-ui-preview (VSCode extension)

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/e3-api-server | dependencies | `^0.0.2-beta.12` | INTER-REPO | ✅ Correct |

#### east-ui-preview-webview (bundled, not published separately)

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | dependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-api-client | dependencies | `^0.0.2-beta.12` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | dependencies | `*` | INTRA-REPO | ✅ Correct |
| @elaraai/east-ui-components | dependencies | `*` | INTRA-REPO | ✅ Correct |

#### @elaraai/east-ui-showcase (not published)

| Dependency | Type | Version in package.json | Classification | Status |
|------------|------|------------------------|----------------|--------|
| @elaraai/east | dependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | dependencies | `*` | INTRA-REPO | ✅ Correct |
| @elaraai/east-ui-components | dependencies | `*` | INTRA-REPO | ✅ Correct |

#### publish.yml coverage

```yaml
- name: Update east-ui-components workspace dependency
  if: ${{ inputs.publish_east_ui_components && inputs.publish_east_ui }}
  run: |
    EAST_UI_VERSION=$(node -p "require('./packages/east-ui/package.json').version")
    cd packages/east-ui-components
    npm pkg set "peerDependencies.@elaraai/east-ui=^${EAST_UI_VERSION}"
```

| Dependency Path | Covered? |
|-----------------|----------|
| east-ui-components → east-ui (peerDeps) | ✅ Yes |

---

## 4. Published Package Verification

Verified against npm registry (beta tag):

### @elaraai/east-node-io@0.0.1-beta.18

```json
{
  "peerDependencies": {
    "@elaraai/east": "^0.0.1-beta.29",
    "@elaraai/east-node-std": "*"           // ❌ BUG: Not resolved!
  },
  "devDependencies": {
    "@elaraai/east-node-std": "^0.0.1-beta.19"  // ✅ Resolved correctly
  }
}
```

### @elaraai/e3-cli@0.0.2-beta.12

```json
{
  "dependencies": {
    "@elaraai/e3": "^0.0.2-beta.12",        // ✅ Resolved
    "@elaraai/e3-core": "^0.0.2-beta.12",   // ✅ Resolved
    "@elaraai/e3-types": "^0.0.2-beta.12"   // ✅ Resolved
  }
}
```

### @elaraai/east-ui-components@0.0.1-beta.19

```json
{
  "peerDependencies": {
    "@elaraai/east": "^0.0.1-beta.29",
    "@elaraai/east-ui": "^0.0.1-beta.19"    // ✅ Resolved
  }
}
```

---

## 5. Bug Report

### Issue

**Package**: `@elaraai/east-node-io`
**Severity**: Medium
**Impact**: Consumers may install incompatible versions of `@elaraai/east-node-std`

### Description

The `peerDependencies` for `@elaraai/east-node-std` is published as `"*"` instead of a resolved version like `"^0.0.1-beta.19"`.

### Root Cause

The publish.yml workflow only updates `devDependencies`, not `peerDependencies`:

```yaml
# Current (incomplete)
npm pkg set "devDependencies.@elaraai/east-node-std=^${EAST_NODE_STD_VERSION}"

# Missing
npm pkg set "peerDependencies.@elaraai/east-node-std=^${EAST_NODE_STD_VERSION}"
```

### Inconsistency

The package.json has inconsistent version formats for the same intra-repo dependency:

```json
{
  "devDependencies": {
    "@elaraai/east-node-std": "^0.0.1-beta.19"  // Static (updated by publish.yml)
  },
  "peerDependencies": {
    "@elaraai/east-node-std": "*"                // Wildcard (NOT updated)
  }
}
```

---

## 6. Current Workflow Analysis

### Current Pattern (all repos)

```
1. npm version ...              → Bumps version in package.json
2. npm pkg set ...              → Updates intra-repo dep versions in package.json
3. git add -A && git commit     → Commits changes to repo
4. git push                     → Pushes to GitHub
5. npm publish                  → Publishes to npm
```

### Problems with Current Pattern

1. **Codebase pollution**: Resolved versions are committed back, causing version strings to drift
2. **Inconsistency**: Some deps use `*`, others use static versions
3. **Error-prone**: Easy to forget updating a dependency type (as seen with peerDependencies)
4. **Confusing**: Developers see static versions that don't match current development state

### Current State by Repo

| Repo | Intra-repo deps in codebase | publish.yml updates | Commits resolved versions |
|------|----------------------------|---------------------|---------------------------|
| east-node | Mixed (`*` and static) | devDependencies only | Yes |
| e3 | All static | All dependencies | Yes |
| east-ui | Mixed (`*` and static) | peerDependencies | Yes |

---

## 7. Proposed Solution

### Goal

- **Codebase**: Always use `*` for intra-repo dependencies
- **Published packages**: Have resolved versions (e.g., `^0.0.1-beta.19`)
- **Commits**: Only contain version bumps, deps remain as `*`

### New Pattern

```
1. npm version ...              → Bumps version in package.json
2. npm pkg set ...              → Temporarily resolves intra-repo deps for publish
3. npm publish                  → Publishes with resolved versions
4. npm pkg set "*"              → Reverts intra-repo deps back to *
5. git add -A && git commit     → Commits only version bumps (deps stay as *)
6. git push                     → Pushes clean state to GitHub
```

### Example Implementation (east-node)

```yaml
# Bump versions first
- name: Bump east-node-std version
  if: ${{ inputs.publish_east_node_std }}
  id: version_std
  working-directory: packages/east-node-std
  run: |
    npm version ${{ inputs.release_type }} --preid=beta --no-git-tag-version
    echo "new_version=$(node -p "require('./package.json').version")" >> $GITHUB_OUTPUT

- name: Bump east-node-io version
  if: ${{ inputs.publish_east_node_io }}
  id: version_io
  working-directory: packages/east-node-io
  run: |
    npm version ${{ inputs.release_type }} --preid=beta --no-git-tag-version
    echo "new_version=$(node -p "require('./package.json').version")" >> $GITHUB_OUTPUT

# Publish with temporary resolution
- name: Publish @elaraai/east-node-std
  if: ${{ inputs.publish_east_node_std }}
  working-directory: packages/east-node-std
  run: npm publish --access public --provenance --tag ${{ steps.npm_tag.outputs.tag }}

- name: Publish @elaraai/east-node-io
  if: ${{ inputs.publish_east_node_io }}
  working-directory: packages/east-node-io
  run: |
    # Temporarily resolve * to real versions for publish
    npm pkg set "devDependencies.@elaraai/east-node-std=^${{ steps.version_std.outputs.new_version }}"
    npm pkg set "peerDependencies.@elaraai/east-node-std=^${{ steps.version_std.outputs.new_version }}"

    # Publish with resolved versions
    npm publish --access public --provenance --tag ${{ steps.npm_tag.outputs.tag }}

    # Revert back to * for clean commit
    npm pkg set "devDependencies.@elaraai/east-node-std=*"
    npm pkg set "peerDependencies.@elaraai/east-node-std=*"

# Commit clean state (only version bumps, deps are *)
- name: Commit version bumps
  run: |
    git add -A
    git commit -m "chore: bump versions - ..." || echo "No changes to commit"

- name: Push changes
  run: git push origin HEAD --tags
```

### Benefits

1. **Clean codebase**: Intra-repo deps always show as `*`, making intent clear
2. **Correct published packages**: All versions properly resolved
3. **No drift**: Version strings in codebase don't change with each publish
4. **Consistent**: Same pattern across all repos
5. **Less error-prone**: All dependency types (deps, devDeps, peerDeps) handled uniformly

---

## 8. Implementation Plan

### Phase 1: Fix the immediate bug (east-node)

**Scope**: Fix peerDependencies not being resolved in east-node-io

**Changes**:
1. Update `packages/east-node-io/package.json`:
   - Change `devDependencies.@elaraai/east-node-std` from `^0.0.1-beta.19` to `*`
2. Update `.github/workflows/publish.yml`:
   - Add resolution for peerDependencies
   - Add reversion to `*` after publish

### Phase 2: Standardize east-node

**Scope**: Implement the new pattern fully in east-node

**Changes**:
1. Ensure all intra-repo deps use `*` in package.json
2. Update publish.yml with resolve-publish-revert pattern

### Phase 3: Standardize e3

**Scope**: Convert e3 from static versions to `*` pattern

**Changes**:
1. Update all package.json files to use `*` for intra-repo deps
2. Update publish.yml with resolve-publish-revert pattern

### Phase 4: Standardize east-ui

**Scope**: Ensure consistency in east-ui

**Changes**:
1. Update east-ui-components peerDependencies to use `*`
2. Update publish.yml with resolve-publish-revert pattern

### Phase 5: Documentation

**Scope**: Document the standard pattern

**Changes**:
1. Add CONTRIBUTING.md section on dependency management
2. Update each repo's README with dependency conventions

---

## Appendix A: Complete Intra-Repo Dependency Map

### east-node

| Package | Depends On | Dep Type | Current | Target |
|---------|-----------|----------|---------|--------|
| east-node-io | east-node-std | devDependencies | `^0.0.1-beta.19` | `*` |
| east-node-io | east-node-std | peerDependencies | `*` | `*` |

### e3

| Package | Depends On | Dep Type | Current | Target |
|---------|-----------|----------|---------|--------|
| e3 | e3-types | dependencies | `^0.0.2-beta.11` | `*` |
| e3-core | e3 | dependencies | `^0.0.2-beta.11` | `*` |
| e3-core | e3-types | dependencies | `^0.0.2-beta.11` | `*` |
| e3-cli | e3 | dependencies | `^0.0.2-beta.11` | `*` |
| e3-cli | e3-core | dependencies | `^0.0.2-beta.11` | `*` |
| e3-cli | e3-types | dependencies | `^0.0.2-beta.11` | `*` |
| e3-api-client | e3-types | dependencies | `^0.0.2-beta.11` | `*` |
| e3-api-server | e3-core | dependencies | `^0.0.2-beta.11` | `*` |
| e3-api-server | e3-types | dependencies | `^0.0.2-beta.11` | `*` |

### east-ui

| Package | Depends On | Dep Type | Current | Target |
|---------|-----------|----------|---------|--------|
| east-ui-components | east-ui | peerDependencies | `^0.0.1-beta.19` | `*` |
| east-ui-showcase | east-ui | dependencies | `*` | `*` |
| east-ui-showcase | east-ui-components | dependencies | `*` | `*` |
| east-ui-preview-webview | east-ui | dependencies | `*` | `*` |
| east-ui-preview-webview | east-ui-components | dependencies | `*` | `*` |

---

## Appendix B: Summary Statistics

### Intra-Repo Dependencies by Status

| Status | Count | Packages |
|--------|-------|----------|
| ✅ Already uses `*` | 5 | east-node-io (peerDeps), east-ui-showcase (2), east-ui-preview-webview (2) |
| ⚠️ Static, needs change to `*` | 11 | east-node-io (devDeps), east-ui-components (peerDeps), all e3 internal deps |

### publish.yml Coverage

| Repo | Intra-repo deps | Covered by publish.yml | Missing |
|------|-----------------|------------------------|---------|
| east-node | 2 | 1 | peerDependencies |
| e3 | 9 | 9 | None |
| east-ui | 1 (published) | 1 | None |
