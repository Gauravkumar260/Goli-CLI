# User Documentation — Diátaxis Framework

Goli-CLI's user documentation follows the
[Diátaxis framework](https://diataxis.fr/), which divides documentation
into four kinds based on the user's intent:

| Kind            | User intent                                 | Path                           | Tone                           |
| --------------- | ------------------------------------------- | ------------------------------ | ------------------------------ |
| **Tutorial**    | Learning (a beginner is being guided)       | [`tutorials/`](tutorials/)     | Step-by-step, hand-holding     |
| **How-to**      | Doing (a practitioner is solving a problem) | [`how-to/`](how-to/)           | Task-oriented, concise         |
| **Reference**   | Describing (a user is looking something up) | [`reference/`](reference/)     | Technical, exhaustive, neutral |
| **Explanation** | Understanding (a user is studying)          | [`explanation/`](explanation/) | Discursive, opinionated        |

> **The Diátaxis Discipline**
>
> | Doc Type                    | Never Mix With |
> | --------------------------- | -------------- |
> | Tutorial (learning)         | Reference      |
> | How-to (doing)              | Explanation    |
> | Reference (describing)      | Tutorial       |
> | Explanation (understanding) | How-to         |
>
> Mixing types is the #1 cause of documentation rot. If you find
> yourself writing "now, you might be wondering why…" in a Reference
> doc, that content belongs in an Explanation doc.

## Tutorials

| Tutorial                          | File                                                                       | Length |
| --------------------------------- | -------------------------------------------------------------------------- | ------ |
| Getting Started (5-minute tour)   | [getting-started.md](../getting-started.md)                               | 5 min  |
| Your First Multi-Agent Task       | [tutorials/first-multi-agent-task.md](tutorials/first-multi-agent-task.md) | 15 min |
| Writing a Custom Slash Command    | [tutorials/custom-slash-command.md](tutorials/custom-slash-command.md)     | 10 min |
| Running Goli Studio (Web Console) | [tutorials/running-studio.md](tutorials/running-studio.md)                 | 10 min |

## How-to guides

| How-to                             | File                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| Configure multiple providers       | [how-to/configure-providers.md](how-to/configure-providers.md)       |
| Use local LLMs with PII gating     | [how-to/local-llms-pii-gating.md](how-to/local-llms-pii-gating.md)   |
| Resume or branch a session         | [how-to/resume-branch-sessions.md](how-to/resume-branch-sessions.md) |
| Run Goli-CLI in CI (headless mode) | [how-to/ci-headless-mode.md](how-to/ci-headless-mode.md)             |
| Add an MCP server                  | [how-to/add-mcp-server.md](how-to/add-mcp-server.md)                 |
| Write a custom hook                | [how-to/custom-hook.md](how-to/custom-hook.md)                       |
| Generate an SBOM                   | [how-to/generate-sbom.md](how-to/generate-sbom.md)                   |
| Self-host with k8s                 | [how-to/self-host-k8s.md](how-to/self-host-k8s.md)                   |

## Reference

| Reference                 | File                                                         |
| ------------------------- | ------------------------------------------------------------ |
| CLI flags                 | [reference/cli-flags.md](reference/cli-flags.md)             |
| Environment variables     | [reference/env-vars.md](reference/env-vars.md)               |
| Exit codes                | [reference/exit-codes.md](reference/exit-codes.md)           |
| Config file format (TOML) | [reference/config-format.md](reference/config-format.md)     |
| Tools (full list)         | [reference/tools.md](reference/tools.md)                     |
| Slash commands            | [reference/slash-commands.md](reference/slash-commands.md)   |
| Themes (catalog)          | [../cli/themes.md](../../cli/themes.md)                      |
| ADRs (index)              | [../../design/decision-log.md](../../design/decision-log.md) |

## Explanation

| Explanation                       | File                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Why open-weight first?            | [explanation/why-open-weight.md](explanation/why-open-weight.md)               |
| The sandbox is the trust boundary | [explanation/sandbox-trust-boundary.md](explanation/sandbox-trust-boundary.md) |
| Hooks vs. prompt-based safety     | [explanation/hooks-vs-prompts.md](explanation/hooks-vs-prompts.md)             |
| SICA: how the agent self-improves | [explanation/sica-loop.md](explanation/sica-loop.md)                           |
| The footprint ladder              | [explanation/footprint-ladder.md](explanation/footprint-ladder.md)             |
| Single-threaded agent loop        | [explanation/single-threaded-loop.md](explanation/single-threaded-loop.md)     |
| Why we built Goli Studio          | [explanation/why-studio.md](explanation/why-studio.md)                         |
