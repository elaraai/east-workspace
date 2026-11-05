#!/usr/bin/env bash
# Copyright (c) 2025 Elara AI Pty Ltd
# Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
#
# Starts the test services, every one or those named (`up.sh httpbin`), once
# their images are here. A registry's bad moment — Docker Hub answering 502 for
# one image — is not a failure of what is being tested, and `up` interrupts every
# other pull when one fails, so the images are pulled first, with backoff. Only
# an outage waits: a pull that works costs nothing, and starting and health
# checks are `up --wait`'s, not retried, since a service that won't start is real.

set -euo pipefail

compose=(docker compose -f "$(dirname "$0")/docker-compose.yml" --profile services)
attempts=5
delay="${SERVICES_PULL_DELAY:-15}"

for attempt in $(seq 1 "$attempts"); do
    if "${compose[@]}" pull --quiet "$@"; then
        break
    fi
    if [ "$attempt" -eq "$attempts" ]; then
        echo "up.sh: pulling the services' images failed $attempts times" >&2
        exit 1
    fi
    echo "up.sh: pulling the services' images failed (try $attempt of $attempts); trying again in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
done

"${compose[@]}" up -d --wait "$@"
