# A local repository

Its layout on disk, and upgrades. Part of the `e3` skill.

```
repo/
├── repository.beast2  # the release that last wrote it, and the upgrades it has had
├── repository-upgrade.beast2  # while an upgrade is under way: where its last part stopped
├── metadata.beast2    # its name and status
├── objects/           # content-addressed: values, segments, manifests, programs
├── packages/          # package refs
├── workspaces/        # each workspace's state, dataset refs, and its latest run's state and events
├── dataflows/         # run records
├── executions/        # execution attempts: status, owner, logs
├── running/           # an index of the attempts recorded running, by task: what a status reads
├── runs/              # an index of each task's runs, its units left out: what its history and logs read
├── adoptions/         # the manifest each delivered file, or piece of one, became
├── locks/             # locks, their holders, and how far each says it has got
├── gc/                # gc beside running work: unreachable notes, a stepped run's parts
├── envs/              # built execution environments
├── rack/              # rack delegation: its policy, and the layers kept of environments built for a rack
└── tmp/               # scratch and staged uploads
```

An e3 opening a repository an older release wrote applies the upgrades it has
not had, in place; one a newer e3 upgraded is refused, naming that release.
