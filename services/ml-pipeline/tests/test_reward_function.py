#!/usr/bin/env python3
"""
Unit tests for the reward function.

Run: pytest tests/test_reward_function.py -v
"""

import json
import pytest
import sys
from pathlib import Path

# Add the parent directory to the path so we can import reward_function.
sys.path.insert(0, str(Path(__file__).parent.parent))
from reward_function import compute_reward, parse_metadata, TrajectoryMetadata


class TestRewardFunction:
    """Tests for compute_reward()."""

    def test_perfect_trajectory(self):
        """Tests pass, low tokens, no violations, semantic check passed."""
        sample = {
            "prompt": "Fix the bug",
            "completions": ["The fix is: change X to Y"],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 10_000,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 5,
            },
        }
        reward = compute_reward(sample)
        # 1.0 (tests) + ~0.285 (efficiency) + 0 (safety) + 0.2 (semantic) + 0 (length)
        assert reward > 1.4
        assert reward < 1.5

    def test_failed_tests(self):
        """Tests don't pass — should get a low reward."""
        sample = {
            "prompt": "Fix the bug",
            "completions": ["Wrong fix"],
            "metadata": {
                "tests_passed": False,
                "total_tokens": 10_000,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 5,
            },
        }
        reward = compute_reward(sample)
        # 0 (tests) + ~0.285 (efficiency) + 0 (safety) + 0.2 (semantic) + 0 (length)
        assert reward < 0.5
        assert reward > 0.4

    def test_safety_violation(self):
        """Safety violation (rm -rf /) — should get a strongly negative reward."""
        sample = {
            "prompt": "Clean up the project",
            "completions": ["Running: rm -rf /"],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 5_000,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 2,
                "tool_call_args": ["rm -rf /"],
            },
        }
        reward = compute_reward(sample)
        # 1.0 (tests) + ~0.29 (efficiency) - 1.0 (safety) + 0.2 (semantic) = ~0.49
        assert reward < 0.6

    def test_hardcoded_output(self):
        """Hardcoded expected output — semantic check fails."""
        sample = {
            "prompt": "Fix the function",
            "completions": ['return "success"  # hardcoded'],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 5_000,
                "hook_violations": 0,
                "semantic_check_passed": False,  # detected hardcoding
                "step_count": 3,
            },
        }
        reward = compute_reward(sample)
        # 1.0 (tests) + 0.29 (efficiency) + 0 (safety) + 0 (semantic) = ~1.29
        # (no semantic bonus because semantic_check_passed is False)
        assert reward < 1.3

    def test_meandering_trajectory(self):
        """Trajectory with >20 steps — length penalty applies."""
        sample = {
            "prompt": "Simple task",
            "completions": ["..."],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 50_000,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 50,
            },
        }
        reward = compute_reward(sample)
        # Length penalty: -0.1 * min((50-20)/30, 1.0) = -0.1
        assert reward < 1.3

    def test_high_token_count(self):
        """Trajectory with >MAX_EFFICIENCY_TOKENS — no efficiency bonus."""
        sample = {
            "prompt": "Complex task",
            "completions": ["..."],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 300_000,  # > MAX_EFFICIENCY_TOKENS (200K)
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 10,
            },
        }
        reward = compute_reward(sample)
        # 1.0 (tests) + 0 (efficiency) + 0 (safety) + 0.2 (semantic) = 1.2
        assert abs(reward - 1.2) < 0.01

    def test_metadata_extraction_from_completion(self):
        """When metadata is absent, fall back to heuristics."""
        sample = {
            "prompt": "Fix the bug",
            "completions": ["All tests passed. The fix is ready."],
        }
        meta = parse_metadata(sample)
        assert meta.tests_passed is True  # detected "all tests passed"
        assert meta.total_tokens > 0  # estimated from completion length

    def test_reward_is_float(self):
        """Reward must be a float (TRL requirement)."""
        sample = {
            "prompt": "x",
            "completions": ["y"],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 1000,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 1,
            },
        }
        reward = compute_reward(sample)
        assert isinstance(reward, float)

    def test_reward_in_expected_range(self):
        """Reward should be in roughly [-2.0, 1.5]."""
        # Worst case: safety violation + failed tests + hardcoded + meandering
        worst = {
            "prompt": "x",
            "completions": ["rm -rf /"],
            "metadata": {
                "tests_passed": False,
                "total_tokens": 300_000,
                "hook_violations": 0,
                "semantic_check_passed": False,
                "step_count": 50,
                "tool_call_args": ["rm -rf /"],
            },
        }
        worst_reward = compute_reward(worst)
        assert worst_reward >= -2.0
        assert worst_reward < 0.0

        # Best case
        best = {
            "prompt": "x",
            "completions": ["Done"],
            "metadata": {
                "tests_passed": True,
                "total_tokens": 100,
                "hook_violations": 0,
                "semantic_check_passed": True,
                "step_count": 1,
            },
        }
        best_reward = compute_reward(best)
        assert best_reward > 1.4
        assert best_reward <= 1.6


class TestParseMetadata:
    """Tests for parse_metadata()."""

    def test_dict_input(self):
        sample = {"prompt": "p", "completions": ["c"], "metadata": {}}
        meta = parse_metadata(sample)
        assert meta.prompt == "p"
        assert meta.completion == "c"

    def test_string_input(self):
        sample = json.dumps({"prompt": "p", "completions": ["c"]})
        meta = parse_metadata(sample)
        assert meta.prompt == "p"

    def test_first_completion_used(self):
        sample = {"prompt": "p", "completions": ["c1", "c2"]}
        meta = parse_metadata(sample)
        assert meta.completion == "c1"

    def test_fallback_completion_field(self):
        sample = {"prompt": "p", "completion": "c"}
        meta = parse_metadata(sample)
        assert meta.completion == "c"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
