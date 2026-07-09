# Security Policy

GOLI-CLI is an enterprise AI coding agent. Its security posture is defined
by three principles:

1. **The sandbox is the trust boundary** — kernel-enforced, not prompt-level.
2. **Hooks are deterministic guardrails** — fire regardless of model
   compliance, never bypassed by context pressure.
3. **Zero data egress by default** — telemetry is redacted; observability
   backends are self-hosted; closed-weight model providers are
   hard-blocked in routing config.

For the architectural rationale, see
`docs/decisions/0001-sandbox-as-trust-boundary.md`.

---

## Supported Versions

GOLI-CLI is pre-1.0. Security fixes are applied to the latest `main` only.
Once 1.0 ships, we will maintain a rolling window of the latest two minor
releases.

| Version | Supported      |
| ------- | -------------- |
| main    | ✅ latest      |
| < 1.0   | ⚠️ best-effort |

---

## Reporting a Vulnerability

**DO NOT open a public GitHub issue for a suspected vulnerability.**

Email `security@goli-cli.dev` with:

1. A description of the issue and its impact
2. A minimal reproduction (PoC, payload, command, or transcript)
3. Affected versions (commit SHA or release tag)
4. Suggested fix, if any

You will receive an acknowledgement within **72 hours**. We will
coordinate disclosure and credit. We do not currently offer a bug bounty,
but critical reports will be acknowledged in the release notes.

### Disclosure Timeline

- **Day 0**: You report. We acknowledge within 72h.
- **Day 7**: We confirm or refute. If confirmed, propose an embargo date
  (typically 90 days).
- **Day 30–90**: Patch developed privately. CVE requested if appropriate.
- **Embargo expiry**: Public release + advisory published in
  `docs/security/advisories/`.

---

## Threat Model (Summary)

A full threat model lives in `docs/security/threat-model.md` (added in
Phase 5, when the sandbox lands). The headline categories:

| Threat                           | Primary control                               | Module |
| -------------------------------- | --------------------------------------------- | ------ |
| Prompt injection (OWASP LLM01)   | Input/output separation + PreToolUse hooks    | M3     |
| Sandbox escape (path traversal)  | `O_NOFOLLOW` + `realpath()` + kernel boundary | M4     |
| Sandbox escape (syscall)         | seccomp + Landlock / Seatbelt                 | M4     |
| Network exfiltration (SSH keys)  | SOCKS5 egress filter + domain allowlist       | M4     |
| Fork bomb / resource exhaustion  | cgroups v2 (`pids.max`, `memory.max`)         | M4     |
| Tool-call JSON malformation      | Strict JSON Schema validation + repair        | M3     |
| Runaway loop / cost exhaustion   | 4-condition stop engine + budget caps         | M1     |
| Memory poisoning (RSI)           | Immutable safety registry + LLM overseer      | M5     |
| Benchmark overfitting (RSI)      | Held-out eval set + overfit detector          | M5, M6 |
| Provider ToS violation           | Hard-blocked provider list in routing         | M7     |
| Supply-chain (GPL/AGPL, malware) | SBOM gate + Trivy + npm audit in CI           | CI     |
| Data egress (GDPR)               | Self-hosted Langfuse + redaction layer        | M6     |

---

## Security-Critical Code Paths

Changes to the following directories require **two human reviewers** and
a red-team test pass. CI will block merges that touch these paths
without the `security-reviewed` label.

- `src/sandbox/` — OS-native sandbox implementation
- `src/approval/` — tiered approval policy engine
- `src/tools/hooks/builtin/` — `block_destructive`, `block_secrets`, etc.
- `src/sica/` — recursive self-improvement loop
- `src/evals/redteam/` — red-team harness
- `src/orchestration/routing/` — provider blocklist enforcement
- `config/sandbox.toml` — sandbox profiles
- `config/routing.toml` — provider allowlist/blocklist

---

## Incident Response

If a vulnerability is exploited in production:

1. **Quarantine**: roll back the agent version via Langfuse trace →
   identify offending session → revert to the previous known-good
   container image / commit.
2. **Preserve**: snapshot audit logs (Module 4 audit log + Module 6 OTel
   traces) to immutable storage before any cleanup.
3. **Notify**: follow the GDPR Art. 33 breach-notification workflow
   (72-hour window) if personal data was involved.
4. **Postmortem**: a public incident report in `docs/security/incidents/`
   within 14 days.

---

## Compliance Posture

GOLI-CLI is designed to satisfy the compliance gates laid out in the
roadmap (`docs/source-roadmap/enterprise-ai-coding-agent-roadmap.md`).
The gates are:

| Gate | Phase | Status                                     |
| ---- | ----- | ------------------------------------------ |
| 1    | P1    | MIT license + attribution in repo root     |
| 2    | P1    | SBOM clean, zero GPL/AGPL in CI            |
| 3    | P7    | Self-hosted GLM-5.2 (post-prototype)       |
| 4    | P12   | Authorship ledger live                     |
| 5    | P11+  | Liability shield (ToS + insurance + audit) |

Gates 1 and 2 are in force from Phase 1 onward. Gate 3 lands when the
self-hosted vLLM endpoint replaces the prototype Z.ai/OpenAI-compatible
endpoint. Gates 4 and 5 are runtime/process gates that land later.
