# Breaking Changes Workflow

This document describes the recommended workflow for making **breaking changes** that affect multiple East repositories.

## Why This Matters

The East project consists of multiple components that must remain compatible:
- **Core IR format** defined in `east` (TypeScript)
- **Backend compilers** in `East.jl` and `east-py`
- **Platform bindings** in `east-node*` and `east-py*`

A breaking change in the IR format requires coordinated updates across all backends. This workspace ensures changes don't break compatibility.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  1. Create branch in meta repo                              │
│  2. Make coordinated changes in affected submodules         │
│  3. Update meta repo to track feature branches              │
│  4. CI tests all components together                        │
│  5. Iterate until tests pass                                │
│  6. Merge submodule PRs in order                            │
│  7. Update meta repo to track merged commits                │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Guide

### 1. Create a Feature Branch in Meta Repo

Start by creating a branch in `east-workspace` to track your breaking change:

```bash
cd /path/to/east-workspace
git checkout -b breaking/new-ir-feature
```

**Why?** This branch will coordinate the compatible versions of all submodules during development.

### 2. Make Changes in Affected Submodules

For each submodule that needs changes:

```bash
# Example: Update the core IR format
cd east
git checkout -b feature/new-ir-format
# Make your changes...
git add .
git commit -m "feat: Add new IR node type for async operations"
git push origin feature/new-ir-format

# Return to workspace root
cd ..
```

**Important:**
- Create a branch in the submodule (don't work on detached HEAD)
- Push the branch to GitHub so CI can access it
- Don't merge to main yet!

### 3. Update Backend Compilers

Update each backend to support the new IR:

```bash
# Update Julia backend
cd East.jl
git checkout -b feature/support-async-ir
# Implement support for new IR nodes...
git commit -m "feat: Add support for async IR nodes"
git push origin feature/support-async-ir
cd ..

# Update Python backend
cd east-py
git checkout -b feature/support-async-ir
# Implement support for new IR nodes...
git commit -m "feat: Add support for async IR nodes"
git push origin feature/support-async-ir
cd ..
```

### 4. Update Meta Repo to Track Feature Branches

Tell the meta repo to track these feature branches:

```bash
# From workspace root
git add east East.jl east-py
git commit -m "WIP: Breaking change - async IR nodes

This commit coordinates:
- east: Add new IR node types
- East.jl: Add compiler support
- east-py: Add runtime support
"
git push origin breaking/new-ir-feature
```

### 5. Verify CI Passes

Create a PR in `east-workspace` from `breaking/new-ir-feature` → `main`.

CI will:
- ✅ Check out all submodules at your feature branch commits
- ✅ Build all TypeScript projects together
- ✅ Run all Python tests
- ✅ Run Julia tests
- ✅ Verify everything compiles and tests pass

**If CI fails:**
- Fix the issues in the appropriate submodule
- Commit and push to the feature branch
- Update the submodule reference in meta repo
- CI will re-run automatically

### 6. Merge Submodule PRs (Order Matters!)

Once CI passes, merge PRs **in dependency order**:

**Safe merge order:**
1. **Backends first:** `East.jl` and `east-py` (they consume IR)
2. **Core second:** `east` (generates IR)
3. **Bindings last:** `east-node`, `east-py-std`, etc. (depend on core and backends)

**Why this order?**
- Backends can be backwards compatible (support old + new IR)
- Once backends are deployed, core can start emitting new IR
- Bindings can safely update once both are ready

### 7. Update Meta Repo to Main Branches

After all PRs are merged:

```bash
# Update each submodule to latest main
cd east
git checkout main
git pull
cd ..

cd East.jl
git checkout main
git pull
cd ..

cd east-py
git checkout main
git pull
cd ..

# Update meta repo to track these commits
git add east East.jl east-py
git commit -m "Release: Async IR support in all backends

Merged PRs:
- East.jl#42: Support for async IR nodes
- east-py#18: Support for async IR nodes
- east#156: Add async IR node types
"
git push origin main
```

### 8. Tag a Release (Optional)

If this is a significant change, tag the meta repo:

```bash
git tag -a v0.2.0 -m "Release v0.2.0: Async IR support"
git push origin v0.2.0
```

You may also want to tag each submodule with coordinated versions.

## Examples

### Example 1: Adding a New IR Node Type

**Scenario:** Add `loop` node to the IR.

1. Branch in `east-workspace`: `breaking/add-loop-ir`
2. Add loop IR type in `east` (TypeScript definitions)
3. Implement loop compiler in `East.jl`
4. Implement loop runtime in `east-py`
5. Update bindings if needed
6. CI ensures all components work together
7. Merge in order: backends → core → bindings

### Example 2: Changing Function Call Semantics

**Scenario:** Change how function arguments are encoded in IR.

1. Branch in `east-workspace`: `breaking/new-call-encoding`
2. Update IR generation in `east`
3. Update IR parsing in `East.jl` and `east-py`
4. Update any tests that depend on encoding
5. CI catches any incompatibilities
6. Merge atomically to avoid broken intermediate states

## Best Practices

### ✅ DO

- Create a meta repo branch for coordinated changes
- Push submodule branches early so CI can test them
- Write tests for the new behavior in all affected repos
- Document the change in CHANGELOG of each affected repo
- Use semantic versioning (breaking change = major version bump)

### ❌ DON'T

- Merge to main in one repo without updating others
- Work on detached HEAD in submodules
- Skip CI checks ("it works on my machine")
- Forget to update the meta repo after merging PRs

## Handling Conflicts

If you need to sync with main while working on a breaking change:

```bash
# In each submodule
cd east
git checkout feature/new-ir-format
git fetch origin
git rebase origin/main
git push --force-with-lease
cd ..

# Update meta repo to new commit
git add east
git commit -m "Rebase east feature branch on latest main"
```

## Emergency Rollback

If you need to revert a breaking change:

```bash
# In meta repo
git revert <commit-sha>
git push origin main

# This will revert all submodules to their previous commits
# Individual repos are unchanged - just the coordination is reverted
```

## Questions?

- Check `README.md` for git submodules basics
- See `.github/workflows/integration-test.yml` for what CI tests
- Ask the team if you're unsure about merge order

---

**Remember:** The whole point of this workspace is to prevent breaking changes from making it to production. Use it!
