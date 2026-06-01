# ADR-005: HITL Approval Policy and Safety Timeouts

## Status
Accepted (2026-05-31)

## Context
Goli-CLI has direct filesystem and shell access within a sandboxed environment. However, destructive actions (e.g., `git commit`, `delete_file`) and potentially escaping shell commands pose a risk to user data and system stability. We need a consistent policy for when the agent must stop and wait for human confirmation.

## Decision
1. **Mandatory Triggers**: HITL is required for all tools in the "Destructive" and "Tier 2 Risky" categories.
2. **Auto-Reject Timeout**: A hard 60-second timeout is enforced for all terminal approval prompts.
3. **Default Behavior**: If the timeout is reached, the action is automatically **Rejected**.
4. **Audit Requirement**: All human decisions (Approve/Reject/Modify) must be logged with a SHA-256 hash of the payload to prevent "phantom modifications" between approval and execution.

## Rationale
- **Safety Over Speed**: Auto-rejecting is safer than auto-approving if a user is away from their terminal. 
- **User Agency**: The "Modify" option ensures the user isn't just a "rubber stamp" but can correct the agent's path without restarting the session.
- **Traceability**: Cryptographic hashing ensures the integrity of the audit trail for security reviews.

## Consequences
- Long-running autonomous tasks may fail if they reach a destructive step while the user is away.
- Users can bypass this with the `--auto` flag at their own risk.
