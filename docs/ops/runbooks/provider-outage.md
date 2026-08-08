# Runbook: Provider Outage

> **Severity:** SEV-2 (degraded service)
> **On-call:** Any maintainer
> **Last updated:** 2026-07-25

## 1. Detect

A provider outage is when the LLM provider (Anthropic, OpenAI,
Gemini, Ollama Cloud) is unreachable or returning errors.

Symptoms:

- Users report "Agent isn't responding."
- The TUI shows "retrying (attempt 2/5)..." for >30 seconds.
- Headless runs return `PROVIDER_AUTH_ERROR` (exit 8) or
  `PROVIDER_RATE_LIMIT` (exit 9).
- The audit log shows repeated 5xx or 429 responses from the
  provider.

Automated detection:

- **OTel traces**: look for `provider.error` spans with `status_code
  > = 500`.
- **Langfuse**: filter traces by `error = true` and group by
  provider.

## 2. Triage

Quick checks:

- [ ] Confirm the outage. Try a simple curl to the provider:
  ```bash
  curl -sS https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
  ```
  If you get a 5xx, the provider is down.
- [ ] Check the provider's status page:
  - Anthropic: <https://status.anthropic.com>
  - OpenAI: <https://status.openai.com>
  - Gemini: <https://status.cloud.google.com>
  - Ollama Cloud: <https://status.ollama.com>
- [ ] Check if it's a rate limit (429) vs an outage (5xx). Rate
      limits are user-specific; outages are global.

## 3. Mitigate

Stop the bleeding:

1. **Switch to a different provider**:

   ```bash
   # For Ollama Cloud outage → switch to Anthropic
   export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet"
   export ANTHROPIC_API_KEY="sk-ant-..."

   # For Anthropic outage → switch to OpenAI
   export GOLI_DEFAULT_MODEL="openai/gpt-4o"
   export OPENAI_API_KEY="sk-..."

   # For all-cloud outage → switch to local Ollama
   export GOLI_DEFAULT_MODEL="ollama/llama3:70b"
   export OLLAMA_BASE_URL="http://localhost:11434"
   ```

2. **For self-hosted stacks**, switch LiteLLM's routing config to
   failover to a backup provider:

   ```yaml
   # infra/litellm/config.yaml
   model_list:
     - model_name: ollama/gpt-oss:120b
       litellm_params:
         model: openai/gpt-oss:120b
         api_base: http://vllm.goli.svc.cluster.local:8000/v1
       # Failover:
       - model_name: ollama/gpt-oss:120b
         litellm_params:
           model: anthropic/claude-3-5-sonnet
           api_key: os.environ/ANTHROPIC_API_KEY
   ```

   Restart LiteLLM:

   ```bash
   docker compose restart litellm
   ```

3. **For CI pipelines**, fail gracefully:
   ```bash
   goli -p "..." --headless-output json --timeout-ms 30000
   # If exit code is 8 or 9, skip the AI review step.
   ```

## 4. Resolve

### Case A: Provider-side outage

Nothing to fix on our side. Wait for the provider to recover.
Subscribe to their status page for updates.

If the outage lasts >1 hour, post a notice in the Goli-CLI
community channel (Discord / GitHub Discussions) so users know
it's not their fault.

### Case B: Rate limit (429)

The user is hitting their rate limit. Options:

- **Reduce concurrency**: run fewer parallel agents.
- **Upgrade tier**: contact the provider for a higher rate limit.
- **Switch to local**: use `ollama/llama3:70b` for high-volume tasks.

### Case C: Auth error (401/403)

The user's API key is wrong or expired. Verify:

```bash
echo $ANTHROPIC_API_KEY
curl -sS https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  ...
```

If the curl works but Goli-CLI doesn't, there's a bug in
`packages/llm-providers/src/anthropic.ts`. File an issue.

### Case D: Goli-CLI bug

The provider is up, but Goli-CLI can't reach it. Possible causes:

- **DNS resolution failure** (check `dig api.anthropic.com`).
- **TLS interception** (corporate proxy — check
  `NODE_EXTRA_CA_CERTS`).
- **Bug in the provider adapter** (file an issue with the audit log).

## 5. Post-incident

- **Post an incident summary** in the community channel.
- **Update LiteLLM's failover config** if the outage revealed a gap.
- **Update this runbook** with anything you learned.
- **Write a postmortem** if the outage affected >10 users or lasted
  > 2 hours.

## Escalation

- **Internal**: notify the maintainers via Slack / Signal.
- **External**: if the outage is on Goli-CLI's side (e.g. a bug in
  the provider adapter), file an issue and tag it `incident`.

## References

- [How-to: Configure providers](../../user/how-to/configure-providers.md)
- [Reference: Exit codes](../../user/reference/exit-codes.md) —
  exit 8 (auth) and 9 (rate limit).
- [ADR 0007 — OpenAI-compatible client](../../decisions/0007-openai-compatible-client.md)
- [ADR 0034 — open-weight only routing](../../decisions/0034-open-weight-only-routing.md)
