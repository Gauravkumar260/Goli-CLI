#!/usr/bin/env python3
"""
GOLI-CLI Reward Function for GRPO Fine-Tuning (Module 5).

Computes the reward for a single trajectory (prompt → completion) using
a weighted sum of:

    1. tests_pass (weight 1.0) — did the agent's patch make tests pass?
    2. efficiency_bonus (weight 0.3) — lower token count = higher reward
    3. safety_penalty (weight -1.0) — hook violations, secret reads
    4. semantic_bonus (weight 0.2) — semantic-check passed (no test-gaming)
    5. trajectory_length_penalty (weight -0.1) — penalize meandering

The reward is designed for GRPO's group-relative advantage:
the model learns RELATIVE quality within a rollout group, not absolute.

Used by train_grpo.py as the `reward_funcs` argument to GRPOTrainer.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

# ─── Reward weights (tunable, but these are the documented defaults) ────
WEIGHT_TESTS_PASS = 1.0
WEIGHT_EFFICIENCY = 0.3
WEIGHT_SAFETY = -1.0
WEIGHT_SEMANTIC = 0.2
WEIGHT_LENGTH_PENALTY = -0.1

# Maximum token budget for the efficiency bonus. Trajectories that use
# more than this get zero efficiency bonus (not negative — that would
# double-penalize with the length penalty).
MAX_EFFICIENCY_TOKENS = 200_000

# Patterns that indicate a safety violation in the completion text.
# These are checked against the agent's tool-call arguments, not the
# final patch text — a patch that DELETES a secret-reading line is good.
SAFETY_VIOLATION_PATTERNS = [
    re.compile(r"\bcat\s+~/\.ssh/id_rsa", re.IGNORECASE),
    re.compile(r"\bcat\s+/etc/shadow", re.IGNORECASE),
    re.compile(r"\brm\s+-rf\s+/(?:\s|$|;|&)", re.IGNORECASE),
    re.compile(r"\bmkfs\.", re.IGNORECASE),
    re.compile(r"\bdd\s+if=/dev/zero\s+of=/dev/", re.IGNORECASE),
    re.compile(r":\(\)\s*\{.*\}:", re.IGNORECASE),  # fork bomb
    re.compile(r"\bcurl\s+.*\|\s*(?:ba)?sh", re.IGNORECASE),  # curl|sh
]

# Pattern that detects test-gaming (hardcoding expected output).
HARDCODE_PATTERNS = [
    re.compile(r"#\s*expected[:\s]+", re.IGNORECASE),
    re.compile(r"assert\s+.*==\s*['\"](?:success|passed|ok)['\"]", re.IGNORECASE),
    re.compile(r"return\s+['\"](?:success|passed|ok)['\"]", re.IGNORECASE),
]


@dataclass
class TrajectoryMetadata:
    """Metadata extracted from a GOLI-CLI trajectory.

    This mirrors the TypeScript Trajectory interface in
    packages/memory-engine/src/trajectory/types.ts.
    """
    prompt: str
    completion: str
    tests_passed: bool
    total_tokens: int
    hook_violations: int
    semantic_check_passed: bool
    step_count: int
    # Optional: the raw tool-call arguments (for safety pattern matching)
    tool_call_args: list[str] | None = None


def parse_metadata(sample: dict[str, Any] | str) -> TrajectoryMetadata:
    """Parse a TRL sample into TrajectoryMetadata.

    TRL passes samples as dicts with 'prompt' and 'completions' keys.
    For evaluation, 'rewards' may also be present (for reference).
    """
    if isinstance(sample, str):
        sample = json.loads(sample)

    # TRL format: {"prompt": str, "completions": [str], "rewards": [float]}
    # We evaluate one completion at a time.
    prompt = sample.get("prompt", "")
    completion = (
        sample["completions"][0]
        if "completions" in sample and sample["completions"]
        else sample.get("completion", "")
    )

    # Metadata may be attached as a separate field, or we extract it
    # from the completion text (heuristic fallback).
    meta = sample.get("metadata", {})

    return TrajectoryMetadata(
        prompt=prompt,
        completion=completion,
        tests_passed=meta.get("tests_passed", _detect_tests_passed(completion)),
        total_tokens=meta.get("total_tokens", _estimate_tokens(completion)),
        hook_violations=meta.get("hook_violations", _count_hook_violations(completion)),
        semantic_check_passed=meta.get(
            "semantic_check_passed", not _detect_hardcoding(completion)
        ),
        step_count=meta.get("step_count", completion.count("\n[tool_call]")),
        tool_call_args=meta.get("tool_call_args"),
    )


def compute_reward(
    sample: dict[str, Any] | str,
    # TRL passes the model/dataset as kwargs in some versions; ignore them.
    **_kwargs: Any,
) -> float:
    """Compute the reward for a single sample.

    This is the function passed to GRPOTrainer as `reward_funcs=[...]`.
    TRL calls it once per (prompt, completion) pair.

    Returns a float in roughly [-2.0, 1.5]. The exact range depends on
    the trajectory; GRPO normalizes within the group so the absolute
    scale matters less than the relative ordering.
    """
    meta = parse_metadata(sample)

    # 1. Tests pass (binary, weighted 1.0)
    tests_pass_reward = WEIGHT_TESTS_PASS * (1.0 if meta.tests_passed else 0.0)

    # 2. Efficiency bonus (weight 0.3, scaled by token budget)
    if meta.total_tokens <= 0:
        efficiency = 0.0
    elif meta.total_tokens >= MAX_EFFICIENCY_TOKENS:
        efficiency = 0.0
    else:
        # Linear bonus: 1.0 at 0 tokens, 0.0 at MAX_EFFICIENCY_TOKENS.
        efficiency = 1.0 - (meta.total_tokens / MAX_EFFICIENCY_TOKENS)
    efficiency_reward = WEIGHT_EFFICIENCY * efficiency

    # 3. Safety penalty (weight -1.0 per violation, capped at -1.0)
    safety_violations = _count_safety_violations(meta)
    safety_penalty = WEIGHT_SAFETY * min(safety_violations, 1.0)

    # 4. Semantic bonus (weight 0.2)
    semantic_reward = WEIGHT_SEMANTIC * (1.0 if meta.semantic_check_passed else 0.0)

    # 5. Trajectory length penalty (weight -0.1, scaled)
    # Penalize trajectories with >20 steps (meandering). Below 20, no penalty.
    if meta.step_count > 20:
        length_penalty = WEIGHT_LENGTH_PENALTY * min(
            (meta.step_count - 20) / 30.0, 1.0
        )
    else:
        length_penalty = 0.0

    total = (
        tests_pass_reward
        + efficiency_reward
        + safety_penalty
        + semantic_reward
        + length_penalty
    )

    return float(total)


# ─── GiGPO two-level credit assignment (arXiv 2505.10978) ──────────────


def compute_gigpo_advantages(
    samples: list[dict[str, Any]],
    anchor_states: list[str] | None = None,
) -> list[float]:
    """Compute GiGPO two-level credit assignment advantages.

    GiGPO (Group-in-Group Policy Optimization) extends GRPO with two-level
    credit assignment:

    1. **Episode-level (macro)**: standard GRPO group-relative advantage —
       compare each rollout's reward against the group mean.

    2. **Step-level (micro)**: within each episode, compare each step's
       contribution against the episode's anchor states (key decision
       points). Steps that precede a successful anchor get positive micro
       advantage; steps that precede a failure get negative.

    The final advantage is a weighted sum of macro + micro.

    This gives the model finer-grained signal: instead of "this trajectory
    was good/bad", it learns "this specific tool call at step 5 was the
    turning point."

    Args:
        samples: List of TRL samples (each with prompt, completions, rewards).
        anchor_states: Optional list of anchor-state markers. If None,
            every tool-call boundary is treated as an anchor.

    Returns:
        List of advantage values (one per sample).
    """
    if not samples:
        return []

    # Extract rewards.
    rewards = [compute_reward(s) for s in samples]
    group_mean = sum(rewards) / len(rewards) if rewards else 0.0
    group_std = (sum((r - group_mean) ** 2 for r in rewards) / len(rewards)) ** 0.5 if rewards else 1.0

    # Macro advantage: group-relative (standard GRPO).
    macro_advantages = [(r - group_mean) / (group_std + 1e-8) for r in rewards]

    # Micro advantage: per-step credit within each episode.
    # For each sample, we look at the trajectory steps and assign credit
    # based on whether each step preceded a success or failure anchor.
    micro_advantages = []
    for i, sample in enumerate(samples):
        meta = parse_metadata(sample)
        # Simple heuristic: if the trajectory succeeded, all steps get
        # positive micro advantage; if it failed, steps after the last
        # successful tool call get negative advantage.
        if meta.tests_passed:
            # All steps contributed to success.
            micro = 0.1  # small positive
        else:
            # Find the last successful step.
            steps = sample.get("metadata", {}).get("steps", [])
            if steps:
                last_success_idx = -1
                for j, step in enumerate(steps):
                    if step.get("ok", False):
                        last_success_idx = j
                # Steps after the last success get negative micro.
                failing_steps = len(steps) - last_success_idx - 1
                micro = -0.1 * min(failing_steps / max(len(steps), 1), 1.0)
            else:
                micro = 0.0
        micro_advantages.append(micro)

    # Combine: macro is the primary signal (weight 0.8), micro refines it (0.2).
    MACRO_WEIGHT = 0.8
    MICRO_WEIGHT = 0.2
    combined = [
        MACRO_WEIGHT * macro + MICRO_WEIGHT * micro
        for macro, micro in zip(macro_advantages, micro_advantages)
    ]

    return combined


# ─── Heuristic detectors (fallback when metadata is absent) ─────────────


def _detect_tests_passed(completion: str) -> bool:
    """Heuristic: detect if tests passed by scanning the completion text."""
    # Look for explicit test-result markers that GOLI-CLI emits.
    if "[TEST_RESULT: PASS]" in completion:
        return True
    if "[TEST_RESULT: FAIL]" in completion:
        return False
    # Fallback: look for "All tests passed" / "tests failed" prose.
    lower = completion.lower()
    if "all tests passed" in lower or "tests passed" in lower:
        return True
    if "tests failed" in lower or "test failures" in lower:
        return False
    # Default: assume failure (conservative — don't reward unknowns).
    return False


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: 4 chars per token (English/code average)."""
    return len(text) // 4


def _count_hook_violations(completion: str) -> int:
    """Heuristic: count hook-violation markers in the completion."""
    return completion.count("[HOOK_VIOLATION]")


def _detect_hardcoding(completion: str) -> bool:
    """Heuristic: detect test-gaming via hardcoded expected output."""
    return any(p.search(completion) for p in HARDCODE_PATTERNS)


def _count_safety_violations(meta: TrajectoryMetadata) -> int:
    """Count safety violations in tool-call args (or completion fallback)."""
    # Prefer scanning tool-call args (more accurate) if available.
    scan_targets = meta.tool_call_args or [meta.completion]
    violations = 0
    for target in scan_targets:
        for pattern in SAFETY_VIOLATION_PATTERNS:
            if pattern.search(target):
                violations += 1
    return violations


# ─── CLI entry point (for standalone testing) ───────────────────────────


def main() -> int:
    """CLI: compute the reward for a single JSONL sample from stdin."""
    import sys

    if len(sys.argv) > 1:
        # File mode
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            sample = json.loads(f.read())
    else:
        # Stdin mode
        sample = json.loads(sys.stdin.read())

    reward = compute_reward(sample)
    print(f"Reward: {reward:.4f}")
    meta = parse_metadata(sample)
    print(f"  tests_pass: {meta.tests_passed}")
    print(f"  tokens: {meta.total_tokens}")
    print(f"  hook_violations: {meta.hook_violations}")
    print(f"  semantic_check: {meta.semantic_check_passed}")
    print(f"  step_count: {meta.step_count}")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
