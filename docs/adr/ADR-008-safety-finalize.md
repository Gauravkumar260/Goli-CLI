# ADR-008: Final Safety and Alignment Architecture

## Status
Accepted (2026-05-31)

## Context
Goli_CLI Phase 5 required a layered defense model to handle both deterministic threats (network access, shell escapes) and probabilistic ones (prompt injection, social engineering). We needed to finalize how these layers interact and ensure long-term accountability.

## Decision
The finalized safety architecture consists of four primary gates:

1. **Gate 0: Deterministic Deny-List**: Regex-based blocking of forbidden commands (curl, wsl.exe, etc.) and paths (.ssh, .env).
2. **Gate 1: Ephemeral Clone Model**: All agent operations happen in a non-mounted container. Changes are staged as a git diff and require host-side approval via `goli_cli commit`.
3. **Gate 2: Reasoning-Blind Classifier**: A separate Gemini Flash Lite call that audits Tier 2 (Risky) and Tier 3 (Destructive) actions against the user task without internal agent chain-of-thought.
4. **Gate 3: Chain-Hash Audit Log**: All HITL decisions and high-risk actions are logged with SHA-256 hash chaining to ensure the audit trail is tamper-proof.

## Rationale
- **Defense in Depth**: No single layer is foolproof. By combining regex, isolation, LLM classification, and cryptographic logging, we minimize the residual risk of a breakout or data loss.
- **Independence**: Gate 2 (Classifier) being reasoning-blind prevents "jailbreak by persuasion" where the agent's reasoning might trick the safety model.
- **Staging**: The Ephemeral Clone model is the strongest protection against accidental data loss, as the host filesystem is never touched during the session.

## Consequences
- Every risky action incurs a small latency penalty for classification.
- Tampering with the audit log will be detected by `goli_cli audit verify`.
- The agent's "Blast Radius" is strictly capped at 10 files and 20 shell commands per session.
