# GOLI-CLI Terms of Service

**Last Updated:** 2026-07-13
**Version:** 1.1

## 1. Acceptance of Terms

By installing, accessing, or using GOLI-CLI ("the Software"), you agree
to be bound by these Terms of Service ("Terms"). If you do not agree to
these Terms, do not use the Software.

## 2. License

GOLI-CLI is licensed under the MIT License. See `LICENSE` in the
repository root for the full license text. The MIT License permits
commercial use, modification, distribution, and private use, provided
the copyright notice and permission notice are included in all copies
or substantial portions of the Software.

## 3. Default Model Backend: Open-Weight Models via Ollama

The default model backend for GOLI-CLI is `ollama/gpt-oss:120b`, an
open-weight Mixture-of-Experts model served via **Ollama Cloud**. The
project ships an integrated providers module
(`packages/core/src/providers/`) that abstracts LLM access behind a
single `ModelProvider` interface and supports the following providers,
selected via the `GOLI_DEFAULT_MODEL` environment variable:

| Provider  | Spec prefix  | Default model                   | Notes                                                    |
| --------- | ------------ | ------------------------------- | -------------------------------------------------------- |
| Ollama    | `ollama/`    | `ollama/gpt-oss:120b` (default) | Ollama Cloud; open-weight; uses `OLLAMA_API_KEY`         |
| OpenAI    | `openai/`    | `openai/gpt-4o`                 | Closed-weight; opt-in only; requires `OPENAI_API_KEY`    |
| Anthropic | `anthropic/` | `anthropic/claude-3-5-sonnet`   | Closed-weight; opt-in only; requires `ANTHROPIC_API_KEY` |
| Gemini    | `gemini/`    | `gemini/gemini-1.5-pro`         | Closed-weight; opt-in only; requires `GEMINI_API_KEY`    |
| Mock      | `mock/`      | `mock/echo`                     | Deterministic; used by `--demo` mode and tests           |

GOLI-CLI is NOT affiliated with, endorsed by, or sponsored by Ollama,
Z.ai, OpenAI, Anthropic, or Google. GOLI-CLI uses open-weight models as
the default backend because their licenses permit commercial use,
self-hosting, and fine-tuning — properties required by the open-weight
routing policy in Section 4. Closed-weight providers may be configured
by users who accept the additional ToS + data-egress implications.

## 4. Open-Weight-Only Routing

GOLI-CLI enforces an open-weight-only routing policy by default (see
`docs/decisions/0034-open-weight-only-routing.md`). When the policy is
active, closed-weight models (GPT-4, Claude, Gemini) are blocked at the
router level. Users may opt in to closed-weight providers by setting
the `GOLI_DEFAULT_MODEL` environment variable (e.g. `openai/gpt-4o`),
but bear full responsibility for the consequences described below.

This default policy exists because the Terms of Service of closed-weight
providers (Anthropic, OpenAI) contain clauses barring the use of their
APIs to build competing products. GOLI-CLI is a competing product.
Using closed-weight models via GOLI-CLI may violate those providers' ToS.

Users MUST NOT attempt to bypass this policy in shared/multi-tenant
deployments. Bypass attempts include:

- Modifying the `BLOCKED_PROVIDERS` list in `packages/core/src/orchestration/routing/classifier.ts`
- Configuring the LiteLLM router (`infra/litellm/config.yaml`) to route to closed-weight models in shared environments
- Using `--god` mode to silently route to a closed-weight model when end-users believe open-weight is in use

Violating this policy may expose the user (not GOLI-CLI) to legal
liability from the closed-weight provider.

## 5. User Responsibilities

### 5.1 Sandbox Configuration

GOLI-CLI executes commands in a sandbox by default. Users are
responsible for:

- Ensuring the sandbox is properly configured for their platform
  (bubblewrap + Landlock on Linux, sandbox-exec / Seatbelt on macOS).
- Understanding that `--god` mode disables ALL safety gates.
- Reviewing the audit log after destructive operations.
- Verifying that the network egress allowlist (`config/default.toml`, `[sandbox].networkAllowlist`)
  matches their organizational data-loss-prevention policy.

### 5.2 Data Sovereignty

GOLI-CLI can use either hosted APIs (Ollama Cloud, Z.ai, DeepSeek,
Together AI, Moonshot) or a self-hosted vLLM instance. Users are
responsible for:

- Understanding which provider their data is sent to (the default is
  Ollama Cloud — see `packages/core/src/providers/ollama.ts`).
- Complying with GDPR, EU AI Act, and other data-protection regulations.
- Self-hosting via vLLM (see `infra/README.md`) if their use case
  requires zero data egress.

### 5.3 Fine-Tuning and SICA

GOLI-CLI's SICA (Self-Improvement with Constrained Adaptation) loop
can fine-tune open-weight models (e.g. `gpt-oss:120b`, GLM-5.2) on the
user's trajectory data. Users are responsible for:

- Ensuring their trajectory data does not contain secrets or PII.
- Understanding that fine-tuned adapters are NOT covered by the
  upstream model license — the adapter is the user's intellectual
  property, but the base model remains under its original license.
- Verifying that the base model's license permits fine-tuning for
  their intended use case (closed-weight models generally do not).

## 6. Disclaimer of Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 7. Limitation of Liability

GOLI-CLI is an autonomous agent that executes commands and writes
files. In no event shall the authors be liable for:

- Data loss caused by autonomous operations (the user is responsible
  for maintaining backups and using the checkpoint system).
- Unauthorized access caused by sandbox misconfiguration or `--god` mode.
- Costs incurred by runaway agent loops (the user is responsible for
  configuring budget limits; see `packages/core/src/agent/budget.ts`).
- Legal liability arising from the user's use of closed-weight models
  in violation of Section 4.

## 8. Indemnification

The user agrees to indemnify and hold harmless the GOLI-CLI contributors
from any claims, damages, or expenses arising from:

- The user's use of the Software in violation of these Terms.
- The user's violation of any third-party ToS (including closed-weight
  model providers).
- The user's deployment of the Software in a regulated environment
  without appropriate compliance review.

## 9. Termination

These Terms are effective until terminated. The user may terminate
at any time by ceasing use of the Software and deleting all copies.
The contributors may terminate this license immediately upon any
breach of these Terms by the user.

## 10. Governing Law

These Terms shall be governed by the laws of the jurisdiction in
which the user deploys the Software, without regard to conflict of
law principles. For disputes arising in the United States, the laws
of the State of Delaware shall apply.

## 11. Changes to These Terms

The contributors may update these Terms from time to time. The
"Last Updated" date at the top of this file indicates the most
recent revision. Continued use of the Software after any changes
constitutes acceptance of the new Terms.

## 12. Contact

For questions about these Terms, contact:

- Email: legal@goli-cli.dev
- GitHub: https://github.com/goli-cli/goli-cli/issues

---

_This document is part of the GOLI-CLI compliance baseline. It is
not legal advice. Organizations deploying GOLI-CLI should have their
own legal counsel review these Terms and the accompanying `SECURITY.md`
and `PRIVACY_POLICY.md`._
