/**
 * Dataset builder (Module 5, part 3).
 *
 * Builds training datasets from curated trajectories. Separates
 * training data from evaluation holdout (SWE-bench Verified) to
 * prevent benchmark overfitting.
 *
 * @module memory/training/dataset-builder
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { TrainingDataset } from '../trajectory/types.js';

/** Options for the DatasetBuilder. */
export interface DatasetBuilderOptions {
  /** The output directory for datasets (default: ~/.agent/datasets/). */
  outputDir?: string;
}

/** The DatasetBuilder — saves training datasets in JSONL format. */
export class DatasetBuilder {
  private readonly outputDir: string;

  constructor(opts: DatasetBuilderOptions = {}) {
    this.outputDir = opts.outputDir ?? join(homedir(), '.agent', 'datasets');
  }

  /**
   * Save a training dataset as JSONL.
   *
   * @param dataset - The dataset to save.
   * @returns The file path.
   */
  save(dataset: TrainingDataset): string {
    const filePath = join(this.outputDir, `${dataset.name}.jsonl`);
    mkdirSync(dirname(filePath), { recursive: true });

    const lines = dataset.examples.map((ex) => JSON.stringify(ex));
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    return filePath;
  }

  /**
   * Split a dataset into train and holdout.
   *
   * The holdout is NEVER used for training — it's used to detect
   * benchmark overfitting (SICA changes that help the benchmark but
   * hurt the holdout are rejected).
   *
   * ## Reproducibility
   *
   * The previous implementation used `Math.random()` for the
   * Fisher-Yates shuffle, which made the split non-reproducible —
   * re-running the build produced a different holdout set, so
   * benchmark-overfitting detection was comparing apples to oranges
   * across runs. We now accept an optional `seed` parameter and use
   * a seeded PRNG (mulberry32) when provided. When `seed` is
   * omitted, we fall back to `Math.random()` (preserving the
   * previous behavior for callers that don't care about
   * reproducibility).
   *
   * @param dataset - The full dataset.
   * @param holdoutRatio - The fraction to hold out (default: 0.1 = 10%).
   * @param seed - Optional seed for reproducible splits.
   * @returns The train and holdout datasets.
   */
  split(
    dataset: TrainingDataset,
    holdoutRatio: number = 0.1,
    seed?: number,
  ): {
    train: TrainingDataset;
    holdout: TrainingDataset;
  } {
    // Fisher-Yates shuffle. The previous implementation used
    // `.sort(() => Math.random() - 0.5)` which is NOT a valid shuffle —
    // the comparator is inconsistent (a<b and b<a can both be true), so
    // different JS engines produce different biased orderings. Fisher-Yates
    // is O(n) and produces a uniform random permutation.
    const rng = seed !== undefined ? mulberry32(seed) : Math.random;
    const shuffled = [...dataset.examples];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const holdoutSize = Math.max(1, Math.floor(shuffled.length * holdoutRatio));
    const holdoutExamples = shuffled.slice(0, holdoutSize);
    const trainExamples = shuffled.slice(holdoutSize);

    return {
      train: {
        ...dataset,
        name: `${dataset.name}-train`,
        examples: trainExamples,
      },
      holdout: {
        ...dataset,
        name: `${dataset.name}-holdout`,
        examples: holdoutExamples,
      },
    };
  }

  /**
   * Filter examples by reward threshold.
   * @param dataset
   * @param minReward
   */
  filterByReward(dataset: TrainingDataset, minReward: number): TrainingDataset {
    return {
      ...dataset,
      examples: dataset.examples.filter((ex) => ex.reward >= minReward),
    };
  }

  /**
   * Get dataset statistics.
   *
   * The previous implementation used `Math.min(...rewards)` and
   * `Math.max(...rewards)` — the spread operator puts every element
   * on the call stack. For a dataset with >100K examples, this
   * exceeds the JS engine's max argument count and throws
   * `RangeError: Maximum call stack size exceeded`. We now compute
   * min/max via a single `reduce` pass (O(n), no stack growth).
   *
   * @param dataset
   */
  getStats(dataset: TrainingDataset): {
    exampleCount: number;
    avgReward: number;
    minReward: number;
    maxReward: number;
    avgPromptLength: number;
    avgCompletionLength: number;
  } {
    if (dataset.examples.length === 0) {
      return {
        exampleCount: 0,
        avgReward: 0,
        minReward: 0,
        maxReward: 0,
        avgPromptLength: 0,
        avgCompletionLength: 0,
      };
    }

    // Single-pass min/max/sum (avoids the spread-operator stack overflow).
    let minReward = Infinity;
    let maxReward = -Infinity;
    let rewardSum = 0;
    let promptLenSum = 0;
    let completionLenSum = 0;
    for (const ex of dataset.examples) {
      if (ex.reward < minReward) minReward = ex.reward;
      if (ex.reward > maxReward) maxReward = ex.reward;
      rewardSum += ex.reward;
      promptLenSum += ex.prompt.length;
      completionLenSum += ex.completion.length;
    }
    const n = dataset.examples.length;

    return {
      exampleCount: n,
      avgReward: rewardSum / n,
      minReward,
      maxReward,
      avgPromptLength: Math.round(promptLenSum / n),
      avgCompletionLength: Math.round(completionLenSum / n),
    };
  }
}

/**
 * Mulberry32 — a tiny seeded PRNG.
 *
 * Returns a function that produces a deterministic sequence of
 * pseudo-random numbers in [0, 1) given a 32-bit seed. Used by
 * `split()` to produce reproducible train/holdout splits.
 *
 * Not cryptographically secure — fine for dataset shuffling.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
