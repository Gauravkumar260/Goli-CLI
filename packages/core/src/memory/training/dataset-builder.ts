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
   * @param dataset - The full dataset.
   * @param holdoutRatio - The fraction to hold out (default: 0.1 = 10%).
   * @returns The train and holdout datasets.
   */
  split(dataset: TrainingDataset, holdoutRatio: number = 0.1): {
    train: TrainingDataset;
    holdout: TrainingDataset;
  } {
    // Fisher-Yates shuffle. The previous implementation used
    // `.sort(() => Math.random() - 0.5)` which is NOT a valid shuffle —
    // the comparator is inconsistent (a<b and b<a can both be true), so
    // different JS engines produce different biased orderings. Fisher-Yates
    // is O(n) and produces a uniform random permutation.
    const shuffled = [...dataset.examples];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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

    const rewards = dataset.examples.map((e) => e.reward);
    const promptLengths = dataset.examples.map((e) => e.prompt.length);
    const completionLengths = dataset.examples.map((e) => e.completion.length);

    return {
      exampleCount: dataset.examples.length,
      avgReward: rewards.reduce((a, b) => a + b, 0) / rewards.length,
      minReward: Math.min(...rewards),
      maxReward: Math.max(...rewards),
      avgPromptLength: Math.round(promptLengths.reduce((a, b) => a + b, 0) / promptLengths.length),
      avgCompletionLength: Math.round(completionLengths.reduce((a, b) => a + b, 0) / completionLengths.length),
    };
  }
}
