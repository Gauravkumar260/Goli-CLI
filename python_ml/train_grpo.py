#!/usr/bin/env python3
"""
GOLI-CLI GRPO Fine-Tuning Pipeline (Module 5).

Trains a LoRA adapter on GLM-5.2 (or any open-weight model) using
Group Relative Policy Optimization (TRL) with vLLM co-located inference.

Usage:
    python train_grpo.py \
        --model glm-5.2 \
        --dataset datasets/goli-train.jsonl \
        --output adapters/goli-glm-5.2-lora \
        --vllm-mode colocate \
        --gpu-memory-utilization 0.9

This script is invoked by the SICA loop after a trajectory curation
cycle produces a new training dataset. The resulting adapter is then
evaluated by `evaluate.py` before being considered for adoption.

Legal: Only open-weight models are supported. The script refuses to
train closed-weight models (GPT-4, Claude, etc.) — see BLOCKED_MODELS.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Block closed-weight models at the top level — fail fast.
BLOCKED_MODELS = frozenset({
    "gpt-4", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo",
    "o1", "o1-preview", "o1-mini", "o3", "o3-mini",
    "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
    "claude-3.5-sonnet", "claude-3.5-haiku",
})


@dataclass
class GRPOConfig:
    """Configuration for a GRPO training run."""
    model: str
    dataset_path: str
    output_dir: str
    # Training hyperparameters
    learning_rate: float = 5e-6
    num_train_epochs: int = 1
    per_device_train_batch_size: int = 4
    gradient_accumulation_steps: int = 8
    warmup_ratio: float = 0.1
    weight_decay: float = 0.01
    max_grad_norm: float = 1.0
    # GRPO-specific
    num_generations: int = 8  # rollout group size G
    beta: float = 0.04  # KL penalty coefficient
    # LoRA
    lora_r: int = 64
    lora_alpha: int = 128
    lora_dropout: float = 0.05
    lora_target_modules: list[str] = field(
        default_factory=lambda: ["q_proj", "k_proj", "v_proj", "o_proj"]
    )
    # vLLM co-location
    vllm_mode: str = "colocate"  # "colocate" or "server"
    gpu_memory_utilization: float = 0.9
    # Logging
    logging_steps: int = 10
    save_steps: int = 500
    wandb_project: str | None = None


def parse_args() -> GRPOConfig:
    """Parse command-line arguments into a GRPOConfig."""
    p = argparse.ArgumentParser(
        description="GOLI-CLI GRPO fine-tuning for open-weight models."
    )
    p.add_argument("--model", required=True, help="Base model ID (e.g. glm-5.2)")
    p.add_argument("--dataset", required=True, help="Path to JSONL training dataset")
    p.add_argument("--output", required=True, help="Output directory for LoRA adapter")
    p.add_argument("--vllm-mode", default="colocate", choices=["colocate", "server"])
    p.add_argument("--gpu-memory-utilization", type=float, default=0.9)
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--lr", type=float, default=5e-6)
    p.add_argument("--num-generations", type=int, default=8, help="GRPO group size G")
    p.add_argument("--lora-r", type=int, default=64)
    p.add_argument("--wandb-project", default=None, help="W&B project name (optional)")
    args = p.parse_args()

    # Legal gate: refuse closed-weight models.
    model_lower = args.model.lower()
    for blocked in BLOCKED_MODELS:
        if blocked in model_lower:
            print(
                f"ERROR: Model '{args.model}' is blocked (closed-weight, ToS "
                f"competing-product clause). Only open-weight models are "
                f"supported. See docs/decisions/0034-open-weight-only-routing.md",
                file=sys.stderr,
            )
            sys.exit(2)

    return GRPOConfig(
        model=args.model,
        dataset_path=args.dataset,
        output_dir=args.output,
        vllm_mode=args.vllm_mode,
        gpu_memory_utilization=args.gpu_memory_utilization,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        num_generations=args.num_generations,
        lora_r=args.lora_r,
        wandb_project=args.wandb_project,
    )


def load_dataset(path: str) -> list[dict[str, Any]]:
    """Load a JSONL training dataset.

    Each line must be a JSON object with:
        - prompt: str (the task description)
        - completions: list[str] (G rollouts)
        - rewards: list[float] (per-rollout reward)
    """
    examples: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                ex = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"WARN: malformed JSON at {path}:{line_num}: {e}", file=sys.stderr)
                continue
            # Validate required fields.
            for field_name in ("prompt", "completions", "rewards"):
                if field_name not in ex:
                    print(
                        f"WARN: missing field '{field_name}' at {path}:{line_num}",
                        file=sys.stderr,
                    )
                    ex = None
                    break
            if ex is None:
                continue
            if len(ex["completions"]) != len(ex["rewards"]):
                print(
                    f"WARN: completions/rewards length mismatch at "
                    f"{path}:{line_num}",
                    file=sys.stderr,
                )
                continue
            examples.append(ex)
    print(f"Loaded {len(examples)} training examples from {path}")
    return examples


def build_trl_config(cfg: GRPOConfig) -> "GRPOConfig_TRL":
    """Build a TRL GRPOConfig from our simplified config.

    We use a lazy import so the script can run --help without torch
    installed (useful for CI linting).
    """
    try:
        from trl import GRPOConfig as TRLGRPOConfig
    except ImportError as e:
        print(
            f"ERROR: trl is not installed. Run `pip install -r requirements.txt`.\n"
            f"Original error: {e}",
            file=sys.stderr,
        )
        sys.exit(3)

    trl_cfg = TRLGRPOConfig(
        output_dir=cfg.output_dir,
        learning_rate=cfg.learning_rate,
        num_train_epochs=cfg.num_train_epochs,
        per_device_train_batch_size=cfg.per_device_train_batch_size,
        gradient_accumulation_steps=cfg.gradient_accumulation_steps,
        warmup_ratio=cfg.warmup_ratio,
        weight_decay=cfg.weight_decay,
        max_grad_norm=cfg.max_grad_norm,
        num_generations=cfg.num_generations,
        beta=cfg.beta,
        logging_steps=cfg.logging_steps,
        save_steps=cfg.save_steps,
        # vLLM co-location (TRL ≥ 0.12)
        vllm_mode=cfg.vllm_mode,
        vllm_gpu_memory_utilization=cfg.gpu_memory_utilization,
        # Use bfloat16 for training (matches GLM-5.2 native precision)
        bf16=True,
        # Disable checkpoint resume — each SICA cycle is a fresh run.
        overwrite_output_dir=True,
    )

    if cfg.wandb_project:
        os.environ.setdefault("WANDB_PROJECT", cfg.wandb_project)
        trl_cfg.report_to = ["wandb"]
    else:
        trl_cfg.report_to = ["tensorboard"]

    return trl_cfg


def main() -> int:
    """Entry point."""
    cfg = parse_args()

    # Validate dataset exists.
    if not Path(cfg.dataset_path).exists():
        print(f"ERROR: dataset not found: {cfg.dataset_path}", file=sys.stderr)
        return 1

    # Create output directory.
    Path(cfg.output_dir).mkdir(parents=True, exist_ok=True)

    # Load dataset.
    examples = load_dataset(cfg.dataset_path)
    if not examples:
        print("ERROR: no valid training examples loaded", file=sys.stderr)
        return 1

    # Build TRL config.
    trl_cfg = build_trl_config(cfg)

    # Lazy-import the heavy modules (torch, trl, vllm) only when we
    # actually need them. This keeps `--help` fast and lets CI lint
    # the script without a GPU environment.
    try:
        from trl import GRPOTrainer
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:
        print(
            f"ERROR: missing ML dependency. Run `pip install -r requirements.txt`.\n"
            f"Original error: {e}",
            file=sys.stderr,
        )
        return 3

    print(f"Loading base model: {cfg.model}")
    tokenizer = AutoTokenizer.from_pretrained(cfg.model, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        cfg.model,
        torch_dtype="auto",
        device_map="auto",
        trust_remote_code=True,
    )

    # LoRA configuration.
    peft_config = LoraConfig(
        r=cfg.lora_r,
        lora_alpha=cfg.lora_alpha,
        lora_dropout=cfg.lora_dropout,
        target_modules=cfg.lora_target_modules,
        task_type="CAUSAL_LM",
        bias="none",
    )

    print(f"Initializing GRPOTrainer (G={cfg.num_generations}, beta={cfg.beta})")
    trainer = GRPOTrainer(
        model=model,
        args=trl_cfg,
        train_dataset=examples,
        peft_config=peft_config,
        # The reward function is imported from reward_function.py
        # to keep this file focused on training orchestration.
        reward_funcs=[__import__("reward_function").compute_reward],
    )

    print("Starting training...")
    trainer.train()

    print(f"Saving LoRA adapter to {cfg.output_dir}")
    trainer.save_model(cfg.output_dir)
    tokenizer.save_pretrained(cfg.output_dir)

    print("Training complete. Run evaluate.py to benchmark the adapter.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
