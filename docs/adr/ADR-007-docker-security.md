# ADR-007: Docker Security and Non-Root Execution

## Status
Accepted (2026-05-31)

## Context
Initial implementation of the Docker sandbox used `wsl -u root docker` to bypass permission issues with the Docker socket in WSL2. This posed a security risk: if an agent achieved a container breakout, it would land in a root-privileged WSL environment.

## Decision
1. **Elimination of sudo/root**: All `wsl -u root` calls are removed from the codebase.
2. **Non-Root Access**: The developer must add the local WSL user to the `docker` group (`sudo usermod -aG docker $USER`).
3. **Sandbox User**: The container image (`goli_cli-sandbox:v1`) is configured to run as a non-root user where possible, although the daemon orchestration now happens via a standard user socket.

## Rationale
- **Final Containment Layer**: Removing root elevation ensures that even a successful sandbox breakout is limited to the privileges of the standard WSL user.
- **Modern Standards**: Adheres to the principle of least privilege.

## Consequences
- Developers must perform a one-time setup (`usermod`) to allow Docker access without sudo.
- Failed orchestration (Permission Denied) will be caught and logged by the telemetry system.
