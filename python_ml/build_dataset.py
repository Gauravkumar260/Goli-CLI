#!/usr/bin/env python3
"""
GOLI-CLI Dataset Builder for GRPO Fine-Tuning (Module 5).

Reads trajectory JSONL files produced by the TypeScript agent loop
(packages/memory-engine/src/trajectory/store.ts) and curates them into
a TRL-compatible training dataset.

Curation strategy (rejection sampling):
    1. Filter to successful trajectories (outcome == 'success').
    2. Group by task (fuzzy match on task description).
    3. For each group with >= 2 rollouts, keep the top-N by reward.
    4. Emit each kept trajectory as a TRL sample:
         {"prompt": str, "completions": [str], "rewards": [float], "metadata": {...}}

Usage:
    python build_dataset.py \
        --trajectories ~/.goli-cli/trajectories.jsonl \
        --output datasets/goli-train.jsonl \
        --min-reward 0.6 \
        --max-per-task 4
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build a GRPO training dataset from trajectories.")
    p.add_argument(
        "--trajectories",
        required=True,
        help="Path to the trajectory JSONL file (or a directory of .jsonl files).",
    )
    p.add_argument("--output", required=True, help="Output JSONL path.")
    p.add_argument(
        "--min-reward",
        type=float,
        default=0.6,
        help="Minimum reward to include a trajectory (default: 0.6).",
    )
    p.add_argument(
        "--max-per-task",
        type=int,
        default=4,
        help="Max rollouts per task group (rejection sampling, default: 4).",
    )
    p.add_argument(
        "--blocked-providers",
        default="openai,anthropic,claude,gpt-4",
        help="Comma-separated provider/model substrings to exclude (legal gate).",
    )
    return p.parse_args()


def load_trajectories(path: str) -> list[dict[str, Any]]:
    """Load all trajectories from a file or directory of .jsonl files."""
    trajectories: list[dict[str, Any]] = []
    paths: list[Path] = []

    root = Path(path)
    if root.is_dir():
        paths = sorted(root.glob("*.jsonl"))
    else:
        paths = [root]

    for p in paths:
        if not p.exists():
            print(f"WARN: {p} does not exist, skipping", file=sys.stderr)
            continue
        with open(p, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    traj = json.loads(line)
                    traj["_source_file"] = str(p)
                    traj["_source_line"] = line_num
                    trajectories.append(traj)
                except json.JSONDecodeError as e:
                    print(
                        f"WARN: malformed JSON at {p}:{line_num}: {e}",
                        file=sys.stderr,
                    )

    print(f"Loaded {len(trajectories)} trajectories from {len(paths)} file(s)")
    return trajectories


def filter_successful(trajectories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only successful trajectories."""
    kept = [t for t in trajectories if t.get("outcome") == "success"]
    print(f"Filtered to {len(kept)} successful trajectories (from {len(trajectories)})")
    return kept


def filter_blocked_providers(
    trajectories: list[dict[str, Any]], blocked: list[str]
) -> list[dict[str, Any]]:
    """Exclude trajectories from blocked (closed-weight) providers."""
    kept = []
    for t in trajectories:
        model = (t.get("model") or "").lower()
        if any(b in model for b in blocked):
            print(
                f"WARN: excluding trajectory {t.get('trajectoryId', '?')} "
                f"from blocked model '{t.get('model')}'",
                file=sys.stderr,
            )
            continue
        kept.append(t)
    print(f"Filtered to {len(kept)} trajectories after provider gate (from {len(trajectories)})")
    return kept


def compute_reward_proxy(traj: dict[str, Any]) -> float:
    """Compute a simple reward proxy for ranking within a task group.

    The actual reward is computed by reward_function.py during training.
    This proxy is only used for rejection sampling (which rollouts to keep).
    """
    # Prefer: tests passed > fewer tokens > shorter duration
    score = 0.0
    if traj.get("testsPassed"):
        score += 1.0
    # Lower tokens = higher score (efficiency)
    tokens = traj.get("totalTokens", 1_000_000)
    score += max(0.0, 1.0 - (tokens / 500_000))
    # Lower cost = higher score
    cost = traj.get("totalCostUsd", 100.0)
    score += max(0.0, 1.0 - (cost / 5.0))
    return score


def group_by_task(trajectories: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group trajectories by fuzzy task key (first 80 chars of description)."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in trajectories:
        desc = (t.get("taskDescription") or "").strip().lower()
        # Use a content hash of the first 80 chars as the group key.
        # This is more robust than string slicing (handles whitespace diffs).
        key_source = desc[:80]
        key = hashlib.sha256(key_source.encode("utf-8")).hexdigest()[:16]
        groups[key].append(t)
    print(f"Grouped into {len(groups)} unique tasks (from {len(trajectories)} trajectories)")
    return groups


def rejection_sample(
    groups: dict[str, list[dict[str, Any]]],
    max_per_task: int,
    min_reward: float,
) -> list[list[dict[str, Any]]]:
    """For each task group, keep the top-N rollouts by reward proxy."""
    kept_groups: list[list[dict[str, Any]]] = []
    for key, rollouts in groups.items():
        # Score and sort descending
        scored = [(compute_reward_proxy(r), r) for r in rollouts]
        scored.sort(key=lambda x: x[0], reverse=True)
        # Filter by min_reward
        qualified = [r for score, r in scored if score >= min_reward]
        # Keep top-N
        top = qualified[:max_per_task]
        if len(top) >= 1:
            kept_groups.append(top)
    total = sum(len(g) for g in kept_groups)
    print(f"Rejection-sampled {total} rollouts across {len(kept_groups)} task groups")
    return kept_groups


def trajectory_to_trl_sample(
    traj: dict[str, Any],
    group: list[dict[str, Any]],
) -> dict[str, Any]:
    """Convert a trajectory into a TRL-compatible sample.

    TRL's GRPOTrainer expects:
        {
            "prompt": str,
            "completions": [str, ...],  # G rollouts
            "rewards": [float, ...],    # per-rollout reward
            "metadata": {...}           # optional, passed to reward func
        }

    We emit ALL rollouts in the group as a single sample (group-relative).
    """
    prompt = traj.get("taskDescription", "")
    completions = []
    rewards = []
    metadata_list = []

    for rollout in group:
        # Reconstruct the completion text from the trajectory steps.
        # Each step's assistant content is concatenated.
        completion_text = "\n".join(
            step.get("assistantContent", "")
            for step in rollout.get("steps", [])
            if step.get("assistantContent")
        )
        completions.append(completion_text)
        # Reward proxy (the real reward is computed during training).
        rewards.append(compute_reward_proxy(rollout))
        metadata_list.append({
            "tests_passed": rollout.get("testsPassed", False),
            "total_tokens": rollout.get("totalTokens", 0),
            "hook_violations": sum(
                1 for step in rollout.get("steps", []) if step.get("hookViolation")
            ),
            "semantic_check_passed": rollout.get("semanticCheckPassed", False),
            "step_count": len(rollout.get("steps", [])),
            "model": rollout.get("model", ""),
            "effort": rollout.get("effort", ""),
            "role": rollout.get("role", ""),
        })

    return {
        "prompt": prompt,
        "completions": completions,
        "rewards": rewards,
        "metadata": metadata_list[0] if metadata_list else {},  # TRL passes metadata per-sample
        "group_metadata": metadata_list,  # our extension for debugging
    }


def main() -> int:
    args = parse_args()
    blocked = [b.strip().lower() for b in args.blocked_providers.split(",") if b.strip()]

    # 1. Load
    trajectories = load_trajectories(args.trajectories)

    # 2. Filter: successful + non-blocked
    trajectories = filter_successful(trajectories)
    trajectories = filter_blocked_providers(trajectories, blocked)

    if not trajectories:
        print("ERROR: no trajectories survived filtering", file=sys.stderr)
        return 1

    # 3. Group by task
    groups = group_by_task(trajectories)

    # 4. Rejection sample
    kept_groups = rejection_sample(groups, args.max_per_task, args.min_reward)

    # 5. Emit TRL samples
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        for group in kept_groups:
            # Use the first rollout as the "primary" — its prompt is the same
            # as all others in the group.
            sample = trajectory_to_trl_sample(group[0], group)
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")

    print(f"Wrote {len(kept_groups)} training samples to {output_path}")
    print(f"\nNext step: python train_grpo.py --dataset {output_path} ...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
