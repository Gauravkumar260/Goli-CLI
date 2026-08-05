# Why Open-Weight First?

> **Explanation** — why Goli-CLI defaults to open-weight models, and
> what that means in practice.

Goli-CLI's default model is `ollama/gpt-oss:120b` — an **open-weight**
model hosted on Ollama Cloud. This is a deliberate architectural
choice, not a default-default. This note explains why.

## What "open-weight" means

A model is **open-weight** if its trained parameters (the "weights")
are published under a permissive license, allowing anyone to download,
host, fine-tune, and redistribute them. Contrast with **closed-weight**
models (GPT-4, Claude, Gemini) where the weights are proprietary and
only accessible via the vendor's API.

Open-weight is not the same as open-source: the training data and
training code may or may not be public. But for our purposes, the
weights being available is what matters — it means you can run the
model yourself, on your own hardware, without asking permission.

## The three reasons

### 1. No vendor ToS lock-in

When you use Claude or GPT-4, you agree to Anthropic's or OpenAI's
Terms of Service. These ToS can change at any time, and have historically
included clauses like:

- "You grant us a perpetual license to use your inputs." (Mostly
  removed in current enterprise tiers, but the history is ugly.)
- "We may terminate your access at any time, for any reason."
- "We may train future models on your inputs." (Opt-out exists but is
  not the default for all tiers.)

With open-weight models, the model doesn't have a ToS — it's a file.
You download it, you run it, the vendor can't retroactively change the
terms. The only ToS you deal with is the hosting provider's (Ollama
Cloud, your own hardware, etc.), and you can switch providers without
switching models.

### 2. Reproducibility

Closed-weight models are updated silently. OpenAI ships a new
"gpt-4o" and your prompts behave differently — same model name,
different model. There's no way to pin a version.

Open-weight models are files. You can pin a specific release
(`ollama/gpt-oss:120b@2026-07-01`) and get bit-identical behavior
forever. This is critical for:

- **Evals** — if the model changes mid-eval-run, your numbers are
  noise.
- **Production agents** — if the model changes mid-deployment, your
  agent may break in subtle ways.
- **Compliance** — auditors want to know exactly which model produced
  which output, with no ambiguity.

Goli-CLI's `--frozen-snapshot` flag (ADR 0024) goes further: it
injects a frozen filesystem snapshot into the prompt, so even the
context is reproducible.

### 3. Self-hostability

Open-weight models can be self-hosted. This matters for:

- **Regulated industries** — finance, health, EU public sector. PII
  cannot leave the building. With open-weight, you run the model
  inside your network; no data egress.
- **Cost** — for high-volume use, self-hosting on GPU instances is
  cheaper than per-token API pricing.
- **Latency** — a model on your LAN has 5-10ms latency; a model across
  the public internet has 50-200ms.
- **Sovereignty** — some jurisdictions require data and computation to
  stay in-country. Open-weight + local GPUs = sovereign AI.

Goli-CLI's `--local-llms` mode (see
[`docs/local-llms-mode.md`](../../local-llms-mode.md)) and the
`LocalLlmsRouter` are designed for exactly this use case.

## The trade-off

Open-weight models are not strictly better. The trade-offs:

- **Quality** — as of mid-2026, the best closed-weight models
  (Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro) still edge out the best
  open-weight models (Llama 3 70B, Mixtral 8x22B, gpt-oss:120b) on
  complex reasoning. The gap is closing but not closed.
- **Convenience** — the closed-weight APIs are more polished (better
  docs, better tooling, better streaming). Open-weight hosting
  requires more setup.
- **Speed** — closed-weight APIs are typically faster than
  self-hosted open-weight on consumer GPUs. (Cloud-hosted open-weight,
  like Ollama Cloud, is comparable.)

Goli-CLI's answer to these trade-offs:

1. **Multi-provider** — you can use closed-weight models when quality
   matters most; open-weight for everything else. The provider
   abstraction makes switching a one-env-var change.
2. **Local-LLMs router** — automatically routes PII to local
   open-weight and complex non-PII to cloud closed-weight.
3. **SICA self-improvement** — fine-tune the open-weight model on your
   agent's trajectories (GRPO, ADR 0027) to close the quality gap on
   your specific tasks.

## What this means in practice

If you're a casual user: just use the default (`ollama/gpt-oss:120b`
on Ollama Cloud). It's open-weight, reasonably priced, and good enough
for most coding tasks.

If you're a regulated industry: self-host vLLM with `gpt-oss:120b` or
`llama3:70b` on your own GPUs. Use `--local-llms` mode for PII gating.

If you're pushing the quality frontier: use `anthropic/claude-3-5-sonnet`
for the hardest tasks and `ollama/gpt-oss:120b` for everything else.
The `LocalLlmsRouter` automates this routing.

If you're an ML engineer: fine-tune `gpt-oss:120b` on your
trajectories via the SICA loop and `python_ml/train_grpo.py`. Pin the
fine-tuned version and use it as your default.

## See also

- [ADR 0034](../../decisions/0034-open-weight-only-routing.md) —
  open-weight-only routing as the default.
- [How-to: Configure providers](../how-to/configure-providers.md) —
  switching providers.
- [How-to: Local LLMs with PII gating](../how-to/local-llms-pii-gating.md)
- [`docs/local-llms-mode.md`](../../local-llms-mode.md) — the local-LLMs
  guide.
- [Explanation: SICA loop](sica-loop.md) — how the agent
  self-improves.
