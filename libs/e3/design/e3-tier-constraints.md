# A project and its tier resolve the same torch (#1662)

Status: **proposed 17 Nov 2026. Not approved, and nothing is built.** It
follows [`e3-environment-over-tier.md`](e3-environment-over-tier.md) (#1655),
and is what makes that change pay off for a project that uses torch.

## 1. The problem, measured

An environment built over its tier leaves a distribution to the tier only
when the tier holds **that exact build**: the same name, version and installed
files. Nothing makes a project and a tier resolve the same builds, and today
they do not.

Resolved on 17 Nov 2026 for Python 3.11 on Linux x86_64, at release 1.0.108:

| Who resolves | torch | Its NVIDIA libraries |
|---|---|---|
| The workspace's lock (`libs/east-py/uv.lock`), which the package's own tests run against | 2.10.0 | `nvidia-*-cu12`, CUDA 12.8 |
| A `py-datascience` image built today, unlocked: `uv pip install "elaraai-east-py-datascience[all]==1.0.108"` | 2.15.0 | CUDA 13 |
| A project that asks for the `torch` extra today (`torch>=2.4.0`) | 2.15.0 | CUDA 13 |

The last two agree only because both were resolved on the same day. An image
is resolved when its release is built, and a project when it locks.

Three faults follow, and the first is the one the issue names.

1. **A project's torch is not its tier's.** Against a tier that holds the
   workspace's lock, a project that asks for torch and pytorch-lightning today
   resolves 46 distributions, of which 11 are the tier's build and **none of
   the 20 that make up torch, its NVIDIA libraries and triton**. Those 20 are
   nearly all of an environment's size: 3.08 GB of layers in #1655's
   measurement.
2. **The image is not what was tested.** Of the 116 distributions the lock
   and today's image both hold, **70 are at another version**.
3. **The image misses the workspace's override.** The workspace sets
   `override-dependencies = ["shap>=0.51.0"]`, because econml pins `shap<0.49`
   and, as its comment says, shap before 0.51 cannot read current xgboost
   models. An override belongs to the workspace and is not part of what a
   package publishes, so the image resolves **shap 0.48.0** beside xgboost
   3.2.0, where the lock holds 0.51.0.

## 2. What a user sees

A member that uses torch asks for it through the package's extras, and names
no torch of its own:

```toml
# packages/python/trainer/pyproject.toml
[project]
name = "trainer"
dependencies = [
  "elaraai-east-py-datascience[torch,lightning]",   # not "torch", "pytorch-lightning"
]
```

Its lock then holds the torch its release was tested with, which is the torch
of that release's `py-datascience` image. On a rack that boots such an image,
the member's environment leaves torch to the tier, and its `[ENV]` line says
how much it left:

```
today      [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 11 distributions from the tier
pinned     [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 29 distributions from the tier
```

The counts are resolved the same way as section 1; the sizes wait on a build.
With the extras pinned a torch member resolves 44 distributions, **30 of them
the tier's build, and 18 of the 19 in torch's family**. What still ships:

- 14 distributions that nothing pins, numpy the largest: aiohttp and four it
  needs, filelock, fsspec, idna, markupsafe, numpy, packaging, tqdm,
  typing-extensions and cuda-pathfinder;
- cuda-bindings, 107 MB installed, though it is the tier's build: it shares
  the `cuda` package with cuda-pathfinder, and distributions that share a
  package are left to the tier together or not at all.

So the pin takes an environment from gigabytes to about a hundred megabytes
installed, and the release's constraints (3.5) take it to the project's own
code.

| The project | The rack's tier image | What its environment ships |
|---|---|---|
| Asks for `[torch,lightning]`; the image is of a release with the same pin | Holds that torch | Its own code, and what nothing pins (numpy and the like) |
| The same, and adds the release's constraints (3.5) | Holds every pin | Its own code |
| Lists `torch` itself, any version | Any | Its own torch, whole, as today |
| Asks for the extras; the image is of a release with another pin | Holds another torch | Its own torch, whole: right, and no saving |
| Needs another torch than the release pins | Any | It drops the extras and lists torch: the row above the last |
| Uses no torch | Any | Nothing of torch: #1654 already left it out |

## 3. Design

### 3.1 The extras pin torch and pytorch-lightning exactly

`libs/east-py/packages/east-py-datascience/pyproject.toml`:

```diff
 torch = [
-    "torch>=2.4.0",
+    "torch==2.10.0",
     "cloudpickle>=3.0.0",
 ]
 lightning = [
-    "torch>=2.4.0",
-    "pytorch-lightning>=2.2.0",
+    "torch==2.10.0",
+    "pytorch-lightning==2.6.1",
     "cloudpickle>=3.0.0",
 ]
```

and the same two lines in `all`. torch pins its NVIDIA libraries and triton
exactly, so the one pin fixes all 20.

- **The first pin is the lock's**: torch 2.10.0 and pytorch-lightning 2.6.1.
  It is what the package's tests run against today, and it changes no entry
  of the lock.
- **The pin and the lock are held together** by `scripts/check-version-drift.mjs`,
  which runs on every pull request: the three extras pin both exactly, the
  same in each, at the versions the lock holds.
- **Moving the pin is one pull request**: the pin, and `uv lock
  --upgrade-package torch`. The package's suites then run against the new
  torch before any release ships it.

What it costs, said plainly:

- A project that asks for the extras **and** names another torch no longer
  resolves. It drops the extras and lists torch itself.
- A project on the `torch` extra today resolves the newest torch (2.15.0). At
  its next lock after this ships it resolves 2.10.0: the tested one, and an
  older one.
- A Python the pinned torch has no wheel for cannot install the extras until
  the pin moves.

### 3.2 One constraints file, exported from the lock

The release's pins are **the workspace's lock, exported**:

```sh
uv export --frozen --all-packages --all-extras --no-default-groups \
          --no-emit-workspace --no-emit-local -o east-py-constraints.txt
```

- `east-py-constraints.txt`: every third-party pin of the lock, with hashes
  and platform markers: 204 pins, 244 KB. It covers both python tiers, and
  anything built from a part of them.
- `east-py-overrides.txt`: the workspace's `override-dependencies`, a line
  each. One line today.

One script writes both, `docker/images/east-py-constraints.sh <workspace>
<out>`, from the workspace root's `pyproject.toml` and `uv.lock` alone: a
frozen export reads no member's manifest. The same commit writes the same
bytes.

This departs from the issue, which proposed `uv pip compile --universal
--generate-hashes` of the released package:

- **A compile at release time is a new resolution that nothing tested.** The
  lock is what the suites ran against.
- **A compile cannot reproduce the lock.** Under the lock's pins alone,
  `elaraai-east-py-datascience[all]` does not resolve: econml 0.16.0 depends
  on `shap>=0.38.1,<0.49.0`. With the override beside them it resolves to the
  lock exactly: 0 of 132 distributions differ.
- It needs no network, and no package to be published first.

The file is named for what it holds, the east-py packages' pins, where the
issue named it for one tier.

### 3.3 The images install under them

`Dockerfile.east-py` and `Dockerfile.e3` copy the workspace root's manifest
and lock, run the script, and keep its two files in the image at
`/opt/e3/east-py-constraints.txt` and `/opt/e3/east-py-overrides.txt`.
`install-packages.sh` passes them to each `uv pip install` it runs, and
`Dockerfile.east-py-datascience`, built from the east-py image, passes that
image's own.

```dockerfile
RUN uv pip install --constraint /opt/e3/east-py-constraints.txt \
                   --override /opt/e3/east-py-overrides.txt \
                   "elaraai-east-py-datascience[all]==${EAST_PY_VERSION}"
```

So an image holds the lock's build of everything, shap 0.51.0 included, and
its tier manifest says so.

| The build | Installs |
|---|---|
| A version is named (`EAST_PY_VERSION=1.0.110`): a release's images | Under the constraints of the checkout it is built from |
| That checkout's lock is of another version | Refused, by name: the constraints would be another release's |
| `latest`, a local convenience | Unconstrained, as today |

**An image built elsewhere for a tier**, a GPU guest image say, takes three
files from the release (3.4): the two here and `tier-manifest.py`. It installs
with uv under both files, then writes its manifest. pip takes constraints and
no overrides, so it cannot install under these.

### 3.4 The release attaches them

`release.yml`'s `finalize` job runs the script on the tree it tags, and
attaches both files beside `tier-manifest.py`. The images are built afterwards
from the same tag, so what they install under is what the release attached.

### 3.5 A project that wants every pin

The extras' pin leaves torch to the tier, which is nearly all of the size.
For the rest, a project puts the release's pins in its workspace root:

```toml
[tool.uv]
constraint-dependencies = [
  "cuda-pathfinder==1.5.3",   # and cuda-bindings' 107 MB stay in the tier
  "numpy==2.4.4",
  # … the lines of the release's east-py-constraints.txt it wants held
]
override-dependencies = ["shap>=0.51.0"]   # the release's east-py-overrides.txt
```

The override line is worth having on its own for a project that uses the
`causal` and `shap` extras together: without it, it resolves shap 0.48.0.

### 3.6 What says it

- `east-py-datascience`'s README and skill: ask for the extras, not for torch.
- The rack docs' section on environments over a tier: how a project gets the
  saving, and the table of section 2.
- [`e3-environment-over-tier.md`](e3-environment-over-tier.md): its pointer
  to this issue becomes a pointer to what was built.

## 4. What this does not do

- **Move torch.** The first pin is the tested one. A newer torch is its own
  pull request (3.1).
- **Pin anything else.** xgboost, pymc and the rest float in a project's
  lock, and ship when they differ from the tier's. None is near torch's size.
- **Write a project's constraints for it.** Section 3.5 is by hand. A command
  that writes them from a release could follow, if the by-hand step is used.
- **Change the project template.** It lists the package with no extras, and a
  member that wants torch asks for the extras itself.
- **Fix the override for a project's own installs.** An override is not
  published with a package. Section 3.5 documents the line.

## 5. Decisions asked

1. The first pin is the lock's: torch 2.10.0, pytorch-lightning 2.6.1 (3.1).
2. The constraints are the lock's export, not a compile at release time, with
   the overrides beside them (3.2).
3. One file for both python tiers, named `east-py-constraints.txt` (3.2).
4. A named version is built under them; `latest` is not (3.3).
5. The pin is checked against the lock in the version drift check (3.1).

## 6. Tests

- The drift check: an extra that pins another torch than the lock, one that
  pins a range, and two extras that disagree, each refused by name.
- The script: from the root's manifest and lock alone; the same bytes twice;
  torch's pin is the lock's; the overrides are the workspace's.
- The image test, for a named version: every distribution its manifest holds
  that the constraints name is at the constrained version; torch is the
  extras' pin; shap is the lock's.
- A build whose checkout's lock is of another version is refused.
- A project that asks for `[torch,lightning]`, built over a tier of the same
  pin: torch and its family are left to the tier.
