# Runbook: Sandbox Escape Alert

> **Severity:** SEV-1 (security incident)
> **On-call:** Security maintainer
> **Last updated:** 2026-07-25

## 1. Detect

A sandbox escape alert fires when:

- A tool call attempts to write outside the workspace root and the
  sandbox blocks it (this is **normal operation** — not an incident).
- A tool call attempts to write outside the workspace root and
  **succeeds** (this is an **incident** — the sandbox failed).
- A tool call attempts network egress and the sandbox blocks it
  (normal).
- A tool call attempts network egress and **succeeds** (incident).
- The sandbox fails to initialize (`SANDBOX_ERROR`, exit 4).

Automated detection:

- **Audit log**: search for `sandbox_violation` entries with
  `action: "blocked"` (normal) vs `action: "allowed"` (incident).
- **OTel traces**: look for tool calls with `sandbox.bypassed = true`.
- **Endpoint detection** (if available): the host EDR may flag
  unexpected child processes or file writes.

## 2. Triage

**If the alert is `action: "blocked"`**: this is normal sandbox
operation. The agent tried to do something it shouldn't, the sandbox
blocked it, the agent was told "permission denied." No incident.
Close the alert.

**If the alert is `action: "allowed"` or `sandbox.bypassed = true`**:
this is a SEV-1 incident. Begin immediate response:

- [ ] Confirm the alert is real (not a false positive from a
      misconfigured monitor). Check the audit log for the specific
      tool call.
- [ ] Identify what the agent tried to do. What path did it write
      to? What URL did it fetch? What command did it run?
- [ ] Identify the prompt that triggered the escape. Was it a
      user prompt, or a prompt injection via a tool result?
- [ ] Check if the escape succeeded. Did the file actually get
      written? Did the network call actually go through? (Check the
      filesystem / network logs.)
- [ ] Snapshot the system state:
  ```bash
  goli sessions export <session-id> --format jsonl > /tmp/incident-session.jsonl
  cp ~/.goli/logs/audit.jsonl /tmp/incident-audit.jsonl
  ps auxf > /tmp/incident-processes.txt
  netstat -tulpn > /tmp/incident-network.txt
  ```

## 3. Mitigate

Stop the bleeding:

1. **Kill the agent process** immediately:
   ```bash
   pkill -KILL -f "goli"
   ```
2. **Isolate the host** if the escape may have installed a
   backdoor:
   ```bash
   # Disable network on the host (if you have physical access)
   sudo ip link set eth0 down
   # OR, in AWS/GCP, isolate via security group / firewall rules.
   ```
3. **Revoke credentials** that may have been exfiltrated:
   - LLM API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
   - Cloud credentials (AWS keys, GCP service account keys)
   - SSH keys (`~/.ssh/`)
   - Database passwords
4. **Capture forensic state** before rebooting:
   ```bash
   # Memory dump (if you have LiME or similar)
   # Disk image (if you can take a snapshot)
   # Process list, network connections, file changes
   ```
5. **Reboot the host** from a known-good image (if the escape may
   have installed a rootkit). Do **not** trust the current
   filesystem.

## 4. Resolve

Fix the root cause:

### Case A: Sandbox was disabled

The user ran `goli --no-sandbox` (or set `GOLI_SANDBOX=0`). This is
a user error, not a sandbox bug. Update the docs to make the
warning louder; consider refusing to run `--no-sandbox` in yolo
mode.

### Case B: Sandbox doesn't cover the affected path

The sandbox allows writes to the workspace root, but the agent
found a path that resolves outside the workspace via a symlink. The
TOCTOU defense should catch this, but if it didn't, there's a bug
in `packages/core/src/sandbox/path-validation.ts`.

Fix: add a test case for the specific path, fix the validation,
release a patch.

### Case C: Sandbox doesn't cover the affected syscall

The sandbox uses Landlock (Linux) / Seatbelt (macOS), which have
known limitations. For example, Landlock <5.13 doesn't restrict
`ptrace`; Seatbelt doesn't restrict `socket` unless explicitly
configured.

Fix: add the missing restriction to the sandbox profile. Document
the limitation in `SECURITY.md`.

### Case D: Sandbox was bypassed via a kernel bug

The sandbox depends on the kernel enforcing its restrictions. If
the kernel has a bug (e.g. a Landlock bypass via `io_uring`), the
sandbox can't help.

Fix: report the kernel bug upstream, add a defense-in-depth
mitigation (e.g. seccomp filter), and document the issue in
`SECURITY.md`.

### Case E: Sandbox was bypassed via a Goli-CLI bug

The sandbox code itself has a bug (e.g. a race condition in path
validation).

Fix: file a P0 issue, fix the bug, release a patch within 72 hours.

## 5. Post-incident

- **Write a postmortem** within 72 hours. Use the
  [postmortem template](../postmortems/_template.md). The postmortem
  must include:
  - Timeline of the incident.
  - What the agent tried to do.
  - How the sandbox failed.
  - What data was exfiltrated (if any).
  - What credentials were revoked.
  - Root cause and fix.
  - Action items (with owners and due dates).
- **Disclose to users** if the sandbox bug affects other users.
  Use the [security disclosure process](../../../SECURITY.md).
- **Update the sandbox tests** to catch the regression.
- **Update this runbook** with anything you learned.

## Escalation

- **Internal**: notify the lead maintainer + security maintainer
  immediately (Slack / Signal).
- **External** (if user data was exposed): notify affected users
  within 72 hours per GDPR / EU AI Act requirements. Coordinate
  with legal.
- **Upstream** (if the bug is in Landlock / Seatbelt / Node):
  file a bug with the upstream project.

## References

- [`SECURITY.md`](../../../SECURITY.md) — security policy + disclosure.
- [ADR 0001 — sandbox as trust boundary](../../decisions/0001-sandbox-as-trust-boundary.md)
- [ADR 0016 — kernel-enforced sandbox](../../decisions/0016-kernel-enforced-sandbox.md)
- [`tests/unit/toctou-path-safety.test.ts`](../../../tests/unit/toctou-path-safety.test.ts)
- [`tests/unit/path-safety.test.ts`](../../../tests/unit/path-safety.test.ts)
- [Explanation: sandbox is the trust boundary](../../user/explanation/sandbox-trust-boundary.md)
