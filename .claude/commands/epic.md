
---
description: Work an epic's sub-issues one at a time on the epic branch
argument-hint: [epic-number]
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
disable-model-invocation: true
---
## Epic #$0

!`gh issue view $0 --comments`

## Draft PR number

!`gh pr list --head elaraai/feat/engine-epic-$0 --json number --jq '.[0].number'`

## Task

Setup: git fetch origin, then git switch elaraai/feat/engine-epic-$0 and rebase
on origin/main if it has moved. All work lands on this branch; the draft PR is
the one shown above. Do NOT branch elsewhere and do NOT merge the PR.

Loop — repeat until every sub-issue is checked or you are blocked:

1. Using the epic body above, find the FIRST unchecked sub-issue in its task list
2. Read the WHOLE sub-issue — the full body AND every comment
   (`gh issue view <n> --comments`). Comments may contain scope changes,
   constraints, or decisions that override the body.
3. Implement it using the east:east-contribute skill workflow: triage to the
   right lib(s), do the anti-duplication feature-register discovery, keep East
   diagnostics live, honor the examples↔tests East-code contract.
4. Validate: run make build, make test, make lint in every affected lib (and
   repo-root make lint if multiple libs changed). Fix everything you introduced;
   all gates must be green locally before committing.
5. Commit — ONE commit for the sub-issue, message referencing it
   (e.g. "fix(east): ... (#XYZ)") — and push to elaraai/feat/engine-epic-$0.
6. Wait for CI on the draft PR (`gh pr checks <pr> --watch`). If CI fails, fix on
   the same branch and repush until green — do not proceed with red CI.
7. Only after CI passes: edit epic #$0's body to check off that sub-issue
   (- [ ] → - [x]) and leave a short comment on the sub-issue summarizing what
   landed and the commit SHA. Do not close the sub-issue; landing the epic PR
   closes them.
8. Move to the next unchecked sub-issue.

If a sub-issue is blocked (needs a decision, spec is contradicted by the code,
or CI failure is pre-existing on main), leave a comment on it explaining the
blocker, skip it WITHOUT checking it off, and continue with the next one.
