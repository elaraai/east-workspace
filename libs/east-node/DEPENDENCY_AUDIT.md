# Monorepo Dependency Audit

## Monorepo Overview

| Repo | Packages |
|------|----------|
| east | `@elaraai/east` (single package, not a monorepo) |
| east-py | `@elaraai/east-py-datascience` |
| east-node | `@elaraai/east-node-std`, `@elaraai/east-node-io`, `@elaraai/east-node-cli` |
| e3 | `@elaraai/e3-types`, `@elaraai/e3`, `@elaraai/e3-core`, `@elaraai/e3-cli`, `@elaraai/e3-api-client`, `@elaraai/e3-api-server` |
| east-ui | `@elaraai/east-ui`, `@elaraai/east-ui-components`, `east-ui-preview` (vscode ext), `@elaraai/east-ui-showcase` (not published) |

---

## Dependency Classification

**INTRA-REPO**: Dependencies on packages within the SAME monorepo → should use `*`
**INTER-REPO**: Dependencies on packages from OTHER monorepos → should use static version `^x.x.x`

---

## east (single package)

No internal dependencies - this is the base package.

---

## east-py

### @elaraai/east-py-datascience

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-node-std | peerDependencies | `^0.0.1-beta.19` | INTER-REPO | ✅ Correct |

### publish.yml coverage
No intra-repo deps to update.

---

## east-node

### @elaraai/east-node-std

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

### @elaraai/east-node-io

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-node-std | peerDependencies | `*` | INTRA-REPO | ✅ Correct |
| @elaraai/east-node-std | devDependencies | `^0.0.1-beta.19` | INTRA-REPO | ❌ **Should be `*`** |

### @elaraai/east-node-cli

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

### publish.yml coverage

```yaml
- name: Update east-node-io workspace dependency
  run: |
    npm pkg set "devDependencies.@elaraai/east-node-std=^${EAST_NODE_STD_VERSION}"
```

| Dependency | Covered in publish.yml |
|------------|------------------------|
| east-node-io → east-node-std (devDeps) | ✅ Yes |
| east-node-io → east-node-std (peerDeps) | ❌ No (but uses `*` so OK) |

---

## e3

### @elaraai/e3-types

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

### @elaraai/e3

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |

### @elaraai/e3-core

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3 | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |

### @elaraai/e3-cli

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3 | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |
| @elaraai/e3-core | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |

### @elaraai/e3-api-client

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |
| @elaraai/east-node-std | devDependencies | `^0.0.1-beta.19` | INTER-REPO | ✅ Correct |

### @elaraai/e3-api-server

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-core | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |
| @elaraai/e3-types | dependencies | `^0.0.2-beta.11` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |

### publish.yml coverage

```yaml
- name: Update workspace dependencies
  run: |
    # e3 depends on e3-types
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    # e3-core depends on e3 and e3-types
    npm pkg set "dependencies.@elaraai/e3=^${E3_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    # e3-cli depends on e3, e3-core and e3-types
    npm pkg set "dependencies.@elaraai/e3=^${E3_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-core=^${E3_CORE_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    # e3-api-client depends on e3-types
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
    # e3-api-server depends on e3-core and e3-types
    npm pkg set "dependencies.@elaraai/e3-core=^${E3_CORE_VERSION}"
    npm pkg set "dependencies.@elaraai/e3-types=^${E3_TYPES_VERSION}"
```

| Dependency | Covered in publish.yml |
|------------|------------------------|
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

## east-ui

### @elaraai/east-ui

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |

### @elaraai/east-ui-components

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | peerDependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | peerDependencies | `^0.0.1-beta.19` | INTRA-REPO | ⚠️ Static (updated by publish.yml) |

### east-ui-preview (VSCode extension - published to marketplace, not npm)

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/e3-api-server | dependencies | `^0.0.2-beta.12` | INTER-REPO | ✅ Correct |

### east-ui-preview-webview (bundled into extension, not published separately)

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | dependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/e3-api-client | dependencies | `^0.0.2-beta.12` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | dependencies | `*` | INTRA-REPO | ✅ Correct |
| @elaraai/east-ui-components | dependencies | `*` | INTRA-REPO | ✅ Correct |

### @elaraai/east-ui-showcase (not published - internal dev tool)

| Dependency | Type | Version | Classification | Status |
|------------|------|---------|----------------|--------|
| @elaraai/east | dependencies | `^0.0.1-beta.29` | INTER-REPO | ✅ Correct |
| @elaraai/east-ui | dependencies | `*` | INTRA-REPO | ✅ Correct |
| @elaraai/east-ui-components | dependencies | `*` | INTRA-REPO | ✅ Correct |

### publish.yml coverage

```yaml
- name: Update east-ui-components workspace dependency
  run: |
    npm pkg set "peerDependencies.@elaraai/east-ui=^${EAST_UI_VERSION}"
```

| Dependency | Covered in publish.yml |
|------------|------------------------|
| east-ui-components → east-ui | ✅ Yes |

---

## Summary of Issues

### Packages using `*` for intra-repo deps (CORRECT pattern)

| Package | Dependency | Type |
|---------|------------|------|
| east-node-io | east-node-std | peerDependencies |
| east-ui-showcase | east-ui | dependencies |
| east-ui-showcase | east-ui-components | dependencies |
| east-ui-preview-webview | east-ui | dependencies |
| east-ui-preview-webview | east-ui-components | dependencies |

### Packages using static versions for intra-repo deps (INCONSISTENT)

| Package | Dependency | Type | publish.yml fixes? |
|---------|------------|------|-------------------|
| **east-node-io** | **east-node-std** | **devDependencies** | ✅ Yes |
| east-ui-components | east-ui | peerDependencies | ✅ Yes |
| e3 | e3-types | dependencies | ✅ Yes |
| e3-core | e3, e3-types | dependencies | ✅ Yes |
| e3-cli | e3, e3-core, e3-types | dependencies | ✅ Yes |
| e3-api-client | e3-types | dependencies | ✅ Yes |
| e3-api-server | e3-core, e3-types | dependencies | ✅ Yes |

---

## Recommendations

### Option A: Standardize on `*` for all intra-repo deps

Change all intra-repo dependencies to use `*` in package.json:

**east-node** (1 change):
- `east-node-io/package.json`: Change devDependencies `@elaraai/east-node-std` from `^0.0.1-beta.19` to `*`

**east-ui** (1 change):
- `east-ui-components/package.json`: Change peerDependencies `@elaraai/east-ui` from `^0.0.1-beta.19` to `*`

**e3** (9 changes):
- All intra-repo dependencies changed from `^0.0.2-beta.11` to `*`

### Option B: Keep static versions, ensure publish.yml coverage

Current approach in e3 and east-ui - all intra-repo deps use static versions, but publish.yml updates them before publish.

**east-node**: Already covered ✅

---

## Dependency Graph

```
@elaraai/east (base)
    ↑
    ├── @elaraai/east-node-std
    │       ↑
    │       └── @elaraai/east-node-io (peer + dev)
    │       └── @elaraai/east-node-cli
    │       └── @elaraai/east-py-datascience (peer)
    │       └── @elaraai/e3-api-client (dev)
    │
    ├── @elaraai/east-ui
    │       ↑
    │       └── @elaraai/east-ui-components (peer)
    │
    ├── @elaraai/e3-types
    │       ↑
    │       ├── @elaraai/e3
    │       │       ↑
    │       │       └── @elaraai/e3-core
    │       │               ↑
    │       │               ├── @elaraai/e3-cli
    │       │               └── @elaraai/e3-api-server
    │       │
    │       └── @elaraai/e3-api-client
    │
    └── @elaraai/e3-api-server (used by east-ui-preview)
```
