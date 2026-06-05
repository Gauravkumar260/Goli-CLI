# Goli-CLI sandbox image. Used by `goli run` to execute agent commands
# in an isolated, non-root container. The image contract is:
#   - a non-root user `goli` (UID 1000) exists and owns /workspace
#   - /workspace is world-readable, writable by `goli`
#   - the container is started as `goli` (defense in depth — even if a
#     code path forgets --user goli, the agent still runs unprivileged)
#   - the standard tools the agent needs (git, bash) are present
FROM node:20-slim

# Install the runtime tools the agent needs. node:20-slim already ships
# bash + ca-certificates; we add git because the agent uses it for
# baseline / diff operations.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Create the unprivileged user the sandbox runtime expects.
# - UID/GID 1000 matches the default first non-root UID on most Linux hosts,
#   so any future bind-mount ownership lines up without remapping.
# - /home/goli is the default HOME; we set git config and similar tools
#   to target this directory.
# - /workspace is owned by goli so `docker cp` (which preserves the host
#   tarball ownership) and the in-container git/commit flows all work
#   without a runtime chown.
RUN groupadd --gid 1000 goli \
	&& useradd --uid 1000 --gid 1000 --create-home --home-dir /home/goli --shell /bin/bash goli \
	&& mkdir -p /workspace \
	&& chown -R goli:goli /workspace /home/goli

WORKDIR /workspace

# Default to the unprivileged user. `goli run` (and any other consumer)
# should not need to drop privileges manually.
USER goli
