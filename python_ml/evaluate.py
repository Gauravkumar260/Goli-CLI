#!/usr/bin/env python3
"""
GOLI-CLI Model Evaluator (Module 5/6).

Evaluates a base or fine-tuned model against a benchmark (SWE-bench,
custom tasks). Used to gate adapter adoption — an adapter must clear
the eval gate before being deployed to the live agent.

Usage:
    python evaluate.py \
        --base-model glm-5.2 \
        --adapter adapters/goli-glm-5.2-lora \
        --benchmark swe-bench-verified-50 \
        --output eval-results.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


@dataclass
class EvalResult:
    """Result of an evaluation run."""
    benchmark: str
    model: str
    adapter: str | None
    total_instances: int
    resolved_count: int
    resolution_rate: float
    semantic_error_rate: float
    total_tokens: int
    total_cost_usd: float
    duration_ms: int
    # Per-instance results (truncated to first 50 for storage)
    instances: list[dict[str, Any]]
    # Comparison vs baseline (if --baseline-results provided)
    baseline_comparison: dict[str, float] | None = None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate a model against a benchmark.")
    p.add_argument("--base-model", required=True, help="Base model ID")
    p.add_argument("--adapter", default=None, help="Path to LoRA adapter (optional)")
    p.add_argument("--benchmark", default="swe-bench-verified-50",
                   help="Benchmark name (default: swe-bench-verified-50)")
    p.add_argument("--output", default="eval-results.json", help="Output JSON path")
    p.add_argument("--baseline-results", default=None,
                   help="Previous eval results JSON (for comparison)")
    p.add_argument("--max-instances", type=int, default=50,
                   help="Max instances to evaluate (default: 50)")
    p.add_argument("--holdout", action="store_true",
                   help="Use the holdout set (for overfitting detection)")
    return p.parse_args()


def load_benchmark(name: str, max_instances: int, holdout: bool) -> list[dict[str, Any]]:
    """Load benchmark instances.

    In production, this calls the SWE-bench harness. For development,
    we generate stub instances so the eval pipeline can be tested
    without the full SWE-bench dataset.
    """
    # Stub: generate deterministic fake instances.
    # Replace with: from swebench import load_swebench; return load_swebench(name, split="test" if not holdout else "holdout")
    instances = []
    for i in range(max_instances):
        instances.append({
            "instance_id": f"{name}-{i:04d}",
            "repo": "test-repo",
            "problem_statement": f"Fix bug #{i} in the test suite.",
            "fail_to_pass": [f"test_{i}_a", f"test_{i}_b"],
            "pass_to_pass": [f"test_existing_{i}"],
        })
    return instances


def run_agent_on_instance(
    model: str,
    adapter: str | None,
    instance: dict[str, Any],
) -> dict[str, Any]:
    """Run the GOLI-CLI agent on a single benchmark instance.

    In production, this invokes the TypeScript agent via a subprocess:
        node apps/cli/dist/index.js wakeup "<problem>" --model <model>

    Returns the agent's result (patch, tests passed, tokens, etc.).
    """
    # Stub: simulate a result. Replace with the real subprocess call.
    import random
    resolved = random.random() > 0.4  # 60% baseline resolution
    return {
        "instance_id": instance["instance_id"],
        "resolved": resolved,
        "tests_pass": instance["fail_to_pass"] if resolved else [],
        "tests_fail": [] if resolved else instance["fail_to_pass"],
        "regressions": [] if resolved else instance["pass_to_pass"][:1],
        "total_tokens": random.randint(20_000, 80_000),
        "duration_ms": random.randint(5_000, 30_000),
        "patch": "diff --git a/foo.py b/foo.py\n..." if resolved else "",
    }


def compute_semantic_error_rate(results: list[dict[str, Any]]) -> float:
    """Compute the fraction of 'resolved' cases that are semantic errors.

    A semantic error is a patch that passes tests but is functionally
    wrong (hardcoded output, test modification, etc.).
    """
    resolved = [r for r in results if r["resolved"]]
    if not resolved:
        return 0.0
    # Stub: 15% semantic error rate. Replace with the LLM-based check.
    semantic_errors = sum(1 for _ in resolved if _detect_semantic_error(_))
    return semantic_errors / len(resolved)


def _detect_semantic_error(result: dict[str, Any]) -> bool:
    """Heuristic: detect semantic errors in a resolved result."""
    patch = result.get("patch", "")
    # Hardcoded expected output
    if '== "success"' in patch or "== 'success'" in patch:
        return True
    # Test file modified
    if "test_" in patch and ("+" in patch or "-" in patch):
        return True
    return False


def compare_to_baseline(
    current: EvalResult,
    baseline_path: str,
) -> dict[str, float]:
    """Compare current results to a baseline (deltas)."""
    with open(baseline_path, "r", encoding="utf-8") as f:
        baseline = json.load(f)

    return {
        "resolution_rate_delta": current.resolution_rate - baseline["resolution_rate"],
        "semantic_error_rate_delta": current.semantic_error_rate - baseline.get("semantic_error_rate", 0),
        "token_efficiency_delta": (
            (baseline["total_tokens"] / max(baseline["total_instances"], 1))
            - (current.total_tokens / max(current.total_instances, 1))
        ),
    }


def main() -> int:
    args = parse_args()

    print(f"Loading benchmark: {args.benchmark} ({'holdout' if args.holdout else 'test'})")
    instances = load_benchmark(args.benchmark, args.max_instances, args.holdout)
    print(f"Loaded {len(instances)} instances")

    print(f"Evaluating model: {args.base_model}" + (f" + adapter: {args.adapter}" if args.adapter else ""))

    results = []
    total_tokens = 0
    total_duration = 0
    for i, instance in enumerate(instances, 1):
        print(f"  [{i}/{len(instances)}] {instance['instance_id']}...", end=" ", flush=True)
        result = run_agent_on_instance(args.base_model, args.adapter, instance)
        results.append(result)
        total_tokens += result["total_tokens"]
        total_duration += result["duration_ms"]
        status = "RESOLVED" if result["resolved"] else "FAILED"
        print(status)

    resolved_count = sum(1 for r in results if r["resolved"])
    resolution_rate = resolved_count / len(results) if results else 0.0
    semantic_error_rate = compute_semantic_error_rate(results)

    eval_result = EvalResult(
        benchmark=args.benchmark,
        model=args.base_model,
        adapter=args.adapter,
        total_instances=len(results),
        resolved_count=resolved_count,
        resolution_rate=resolution_rate,
        semantic_error_rate=semantic_error_rate,
        total_tokens=total_tokens,
        total_cost_usd=total_tokens * 0.000001,  # $1/M tokens (placeholder)
        duration_ms=total_duration,
        instances=results[:50],
    )

    if args.baseline_results:
        eval_result.baseline_comparison = compare_to_baseline(eval_result, args.baseline_results)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(asdict(eval_result), f, indent=2)

    print(f"\n{'='*60}")
    print(f"Resolution rate:    {resolution_rate*100:.1f}% ({resolved_count}/{len(results)})")
    print(f"Semantic error rate: {semantic_error_rate*100:.1f}%")
    print(f"Total tokens:       {total_tokens:,}")
    print(f"Duration:           {total_duration/1000:.1f}s")
    if eval_result.baseline_comparison:
        bc = eval_result.baseline_comparison
        print(f"\nBaseline comparison:")
        print(f"  Resolution delta:  {bc['resolution_rate_delta']*100:+.1f}%")
        print(f"  Semantic delta:    {bc['semantic_error_rate_delta']*100:+.1f}%")
        print(f"  Token efficiency:  {bc['token_efficiency_delta']:+.0f} tokens/instance")
    print(f"\nResults written to: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
