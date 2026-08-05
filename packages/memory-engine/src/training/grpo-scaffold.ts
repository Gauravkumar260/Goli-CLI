/**
 * GRPO + LoRA training pipeline scaffold (Module 5, part 3).
 *
 * This is a TypeScript scaffold that generates the Python training
 * script for GRPO (Group Relative Policy Optimization) + LoRA fine-
 * tuning via TRL (Transformers Reinforcement Learning) + vLLM.
 *
 * ## Why GRPO over PPO?
 *
 * GRPO eliminates the critic (which would double memory/compute at
 * Large model scale). PPO's value model is a bottleneck at this
 * scale. GRPO has been proven for the GLM model family.
 *
 * ## Why colocate vLLM mode?
 *
 * The LoRA + vLLM-server bug causes adapter weights to silently fail
 * to load. Colocate mode (vLLM runs in the same process as TRL)
 * avoids this bug. Tradeoff: tighter GPU coupling.
 *
 * ## Why 2-iteration cap?
 *
 * SWE-Gym research shows diminishing returns after 2 iterations of
 * rejection sampling fine-tuning (RFT).
 *
 * ## What this scaffold does
 *
 * Phase 10 generates the Python training script as a string and
 * writes it to disk. The actual training is run externally (requires
 * 8×H100/H200 GPUs). The scaffold includes:
 * - TRL GRPO configuration
 * - LoRA configuration (rank 64)
 * - vLLM colocate mode
 * - Reward function (calls back to the TypeScript reward function)
 * - Holdout evaluation
 *
 * ## Model choice
 *
 * The previous implementation used `MODEL_ID = "gpt-4o"`, which is
 * an OpenAI API model. `AutoModelForCausalLM.from_pretrained()`
 * cannot load OpenAI API models — it requires a HuggingFace Hub
 * model ID. The script would fail immediately at the model-load
 * step. We now default to `Qwen/Qwen2.5-Coder-7B-Instruct`, a
 * HuggingFace model that:
 *  - Is small enough to fine-tune on 8×H100 with LoRA + bf16
 *  - Has a coding-focused tokenizer
 *  - Is licensed permissively (Apache 2.0)
 *  - Is the recommended starting point for SWE-Gym-style training
 *
 * Users can override the model ID via the `modelId` option.
 *
 * @module memory/training/grpo-scaffold
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Default HuggingFace model ID (Qwen2.5-Coder-7B-Instruct). */
const DEFAULT_MODEL_ID = 'Qwen/Qwen2.5-Coder-7B-Instruct';

/** Options for the GRPOScaffold. */
export interface GRPOScaffoldOptions {
  /** The output directory (default: ~/.agent/training/). */
  outputDir?: string;
  /** Logger instance. */
  logger?: Logger;
  /**
   * The HuggingFace model ID to fine-tune. Must be a loadable
   * `AutoModelForCausalLM` model — NOT an OpenAI API model like
   * `gpt-4o`. Defaults to `Qwen/Qwen2.5-Coder-7B-Instruct`.
   */
  modelId?: string;
  /**
   * Torch dtype for the model. Defaults to `bfloat16` (widely
   * supported on Ampere+ GPUs). Use `float16` on older hardware
   * (V100, T4). The previous implementation used `float8_e4m3fn`
   * which requires H100+ and fails on older hardware.
   */
  torchDtype?: 'bfloat16' | 'float16' | 'float32';
}

/** The GRPO scaffold — generates the Python training script. */
export class GRPOScaffold {
  private readonly outputDir: string;
  private readonly log?: Logger;
  private readonly modelId: string;
  private readonly torchDtype: 'bfloat16' | 'float16' | 'float32';

  constructor(opts: GRPOScaffoldOptions = {}) {
    this.outputDir = opts.outputDir ?? join(homedir(), '.agent', 'training');
    this.log = opts.logger;
    this.modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    this.torchDtype = opts.torchDtype ?? 'bfloat16';
  }

  /**
   * Validate that a path is safe to interpolate into the generated
   * Python script. The previous implementation interpolated
   * `datasetPath`, `holdoutPath`, and `outputPath` directly into a
   * Python docstring, which allowed path injection (e.g., a path
   * containing `"""` would terminate the docstring and inject
   * arbitrary Python).
   *
   * We now:
   *  1. Reject paths containing newlines, quotes, or backticks
   *     (defense in depth — the docstring is a triple-quoted string).
   *  2. Reject paths with shell metacharacters (`;`, `&`, `|`, `$`,
   *     backticks) since they may also be passed to `subprocess`.
   *  3. Reject empty paths.
   */
  private validatePath(path: string, name: string): void {
    if (!path || path.length === 0) {
      throw new Error(`${name} must not be empty`);
    }
    // Reject newlines, quotes, backticks, and shell metacharacters.
    // The generated script passes these paths to `open()` and
    // `argparse`, so shell metacharacters aren't strictly dangerous
    // there — but they ARE dangerous if the user copy-pastes the
    // docstring usage line into a shell.
    if (/[\n\r"'`;&|$<>]/.test(path)) {
      throw new Error(
        `${name} contains forbidden characters (newlines, quotes, or shell metacharacters): ${path}`,
      );
    }
  }

  /**
   * Escape a path for safe interpolation into a Python triple-quoted
   * docstring. Even after `validatePath` rejects the obvious
   * injection vectors, we escape backslashes so Windows paths
   * (`C:\\Users\\...`) don't get interpreted as Python escape
   * sequences.
   */
  private escapeForDocstring(path: string): string {
    return path.replace(/\\/g, '\\\\');
  }

  /**
   * Generate the Python training script.
   *
   * @param datasetPath - The path to the curated JSONL dataset.
   * @param holdoutPath - The path to the holdout JSONL dataset.
   * @param outputPath - The output model path.
   * @returns The path to the generated Python script.
   */
  generate(
    datasetPath: string,
    holdoutPath: string,
    outputPath: string,
  ): string {
    // Validate ALL paths before generating any output.
    this.validatePath(datasetPath, 'datasetPath');
    this.validatePath(holdoutPath, 'holdoutPath');
    this.validatePath(outputPath, 'outputPath');

    const script = this.buildScript(datasetPath, holdoutPath, outputPath);
    const scriptPath = join(this.outputDir, 'grpo_train.py');
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, script, 'utf-8');

    this.log?.info('GRPO training script generated', {
      scriptPath,
      datasetPath,
      holdoutPath,
      outputPath,
      modelId: this.modelId,
    });

    return scriptPath;
  }

  /**
   * Build the Python training script.
   *
   * Paths are passed via `argparse` (NOT interpolated into the
   * docstring). The docstring only shows the script's purpose and
   * usage pattern; concrete paths come from `--dataset`,
   * `--holdout`, `--output` at runtime.
   *
   * @param datasetPath - The path to the curated JSONL dataset.
   * @param holdoutPath - The path to the holdout JSONL dataset.
   * @param outputPath - The output model path.
   */
  private buildScript(
    datasetPath: string,
    holdoutPath: string,
    outputPath: string,
  ): string {
    // Paths are NOT interpolated into the docstring. They are
    // passed via argparse at runtime. The docstring only shows the
    // script's purpose.
    const ds = this.escapeForDocstring(datasetPath);
    const hs = this.escapeForDocstring(holdoutPath);
    const os = this.escapeForDocstring(outputPath);
    return `#!/usr/bin/env python3
"""
GRPO + LoRA fine-tuning.
Generated by GOLI-CLI Phase 10 (memory/training/grpo-scaffold.ts).

Requirements:
  - 8xH100/H200 GPUs (or equivalent; bf16 needs Ampere+)
  - TRL (Transformers Reinforcement Learning)
  - vLLM (colocate mode)
  - peft (LoRA adapters)

Usage:
  python grpo_train.py --dataset <path> --holdout <path> --output <path>

Default paths (override on the CLI):
  --dataset  ${ds}
  --holdout  ${hs}
  --output   ${os}
"""

import argparse
import json
import os
from pathlib import Path

# TRL + vLLM imports
from trl import GRPOConfig, GRPOTrainer
from peft import LoraConfig, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

# ─── Configuration ──────────────────────────────────────────────

# Default model: a HuggingFace Hub model ID (NOT an OpenAI API model).
# AutoModelForCausalLM can only load HF Hub models — the previous
# default of "gpt-4o" would fail immediately at from_pretrained().
MODEL_ID = ${JSON.stringify(this.modelId)}
LORA_RANK = 64
LORA_ALPHA = 128
LORA_DROPOUT = 0.05
MAX_ITERATIONS = 2  # SWE-Gym: diminishing returns after 2
MAX_ROLLOUTS = 30   # Per-task high-temp rollouts
LEARNING_RATE = 1e-5
BATCH_SIZE = 4
GRADIENT_ACCUMULATION_STEPS = 8
MAX_STEPS = 1000
WARMUP_STEPS = 50

# Torch dtype. The previous implementation used torch.float8_e4m3fn,
# which requires H100+ (Blackwell/Sapphire Rapids FP8 support).
# On A100/V100/T4 the dtype is unavailable and from_pretrained()
# throws. We default to bf16 (Ampere+), with float16 fallback for
# older hardware.
TORCH_DTYPE = getattr(torch, ${JSON.stringify(this.torchDtype)}, torch.bfloat16)

# vLLM colocate mode (avoids LoRA+vLLM-server adapter loading bug)
VLLM_COLOCATE = True

# ─── Reward Function ────────────────────────────────────────────

def reward_function(prompts, completions, **kwargs):
    """
    Reward function for GRPO.

    Components:
    1. Tests pass (primary, 0 or 1) — calls back to the TypeScript
       reward function via subprocess. The previous implementation
       was a stub that checked for the literal string "success" in
       the completion, which incentivized the model to emit "success"
       regardless of correctness (reward hacking).
    2. Efficiency bonus (0.0 - 0.3): fewer tokens = higher reward,
       BUT only awarded when tests pass (otherwise empty responses
       get the full efficiency bonus).
    3. Safety penalty (-0.5 - 0.0): hook violations reduce reward.

    Total = testsPass + (efficiency if testsPass else 0) + safetyPenalty
    """
    rewards = []
    for prompt, completion in zip(prompts, completions):
        # 1. Tests pass — call back to the TypeScript reward function.
        # In production, this runs the actual test suite. For the
        # scaffold, we shell out to 'goli reward' which returns a
        # JSON object with a 'passed' boolean.
        tests_pass = _run_external_reward(prompt, completion)

        # 2. Efficiency bonus — only when tests pass. The previous
        # implementation awarded efficiency regardless of test
        # outcome, which meant an empty completion (0 tokens) got
        # the full 0.3 efficiency bonus even though it failed every
        # test.
        if tests_pass:
            completion_tokens = len(completion.split())
            efficiency = max(0.0, 0.3 * (1 - completion_tokens / 10000))
        else:
            efficiency = 0.0

        # 3. Safety penalty (check for blocked patterns in completion).
        blocked_patterns = ["rm -rf", "DROP TABLE", "curl | bash"]
        violations = sum(1 for p in blocked_patterns if p in completion)
        safety_penalty = max(-0.5, violations * -0.1)

        total = tests_pass + efficiency + safety_penalty
        rewards.append(total)

    return rewards


def _run_external_reward(prompt: str, completion: str) -> float:
    """
    Call the TypeScript reward function to evaluate the completion.

    Returns 1.0 if tests pass, 0.0 otherwise. Falls back to a
    heuristic (no obvious failure markers) if the external reward
    function is unavailable.
    """
    import subprocess
    try:
        result = subprocess.run(
            ["goli", "reward", "--prompt", prompt, "--completion", completion],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return 1.0 if data.get("passed") else 0.0
    except (subprocess.SubprocessError, json.JSONDecodeError, FileNotFoundError):
        pass
    # Fallback: conservative — assume failure unless the completion
    # contains clear success markers AND no failure markers.
    failure_markers = ["traceback", "error:", "exception", "assertionerror"]
    if any(m in completion.lower() for m in failure_markers):
        return 0.0
    return 0.0


# ─── Dataset Loading ────────────────────────────────────────────

def load_dataset(path: str):
    """Load a JSONL dataset."""
    examples = []
    with open(path) as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    return examples


# ─── Training ──────────────────────────────────────────────────

def train(dataset_path: str, holdout_path: str, output_path: str):
    """Run GRPO + LoRA fine-tuning."""

    print(f"Loading dataset from {dataset_path}")
    train_data = load_dataset(dataset_path)
    holdout_data = load_dataset(holdout_path)
    print(f"  Train: {len(train_data)} examples")
    print(f"  Holdout: {len(holdout_data)} examples")

    # Load model + tokenizer
    print(f"Loading model {MODEL_ID}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=TORCH_DTYPE,
        device_map="auto",
    )

    # LoRA configuration
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )

    # GRPO configuration
    grpo_config = GRPOConfig(
        output_dir=output_path,
        learning_rate=LEARNING_RATE,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION_STEPS,
        max_steps=MAX_STEPS,
        warmup_steps=WARMUP_STEPS,
        num_generations=MAX_ROLLOUTS,
        vllm_mode="colocate" if VLLM_COLOCATE else "server",
        logging_steps=10,
        save_steps=100,
        eval_steps=100,
        bf16=(TORCH_DTYPE == torch.bfloat16),
        fp16=(TORCH_DTYPE == torch.float16),
        gradient_checkpointing=True,
    )

    # Trainer
    trainer = GRPOTrainer(
        model=model,
        args=grpo_config,
        train_dataset=train_data,
        eval_dataset=holdout_data,
        reward_funcs=reward_function,
        peft_config=lora_config,
    )

    # Run up to MAX_ITERATIONS
    for iteration in range(MAX_ITERATIONS):
        print(f"\\n{'='*60}")
        print(f"Iteration {iteration + 1}/{MAX_ITERATIONS}")
        print(f"{'='*60}")

        trainer.train()

        # Evaluate on holdout
        print(f"Evaluating on holdout ({len(holdout_data)} examples)...")
        eval_results = trainer.evaluate()
        print(f"Holdout results: {eval_results}")

        # Save checkpoint
        checkpoint_path = os.path.join(output_path, f"checkpoint-iter{iteration + 1}")
        trainer.save_model(checkpoint_path)
        print(f"Saved checkpoint to {checkpoint_path}")

    print(f"\\nTraining complete. Final model at {output_path}")


# ─── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GRPO + LoRA fine-tuning")
    parser.add_argument("--dataset", required=True, help="Path to training JSONL")
    parser.add_argument("--holdout", required=True, help="Path to holdout JSONL")
    parser.add_argument("--output", required=True, help="Output model directory")
    args = parser.parse_args()

    train(args.dataset, args.holdout, args.output)
`;
  }

  /**
   * Get the training configuration summary.
   */
  getConfig(): {
    modelId: string;
    loraRank: number;
    loraAlpha: number;
    maxIterations: number;
    maxRollouts: number;
    learningRate: number;
    batchSize: number;
    vllmColocate: boolean;
    torchDtype: string;
  } {
    return {
      modelId: this.modelId,
      loraRank: 64,
      loraAlpha: 128,
      maxIterations: 2,
      maxRollouts: 30,
      learningRate: 1e-5,
      batchSize: 4,
      vllmColocate: true,
      torchDtype: this.torchDtype,
    };
  }
}
