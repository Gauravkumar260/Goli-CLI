import { appendFileSync } from 'node:fs';
import { join }           from 'node:path';
import { randomUUID }     from 'node:crypto';
import os                 from 'node:os';

export interface TrainingExample {
  example_id:     string;
  task:           string;
  repo_language:  string;
  context_chunks: string[];
  diff:           string;
  turns:          number;
  model:          string;
  ts:             string;
  accepted:       boolean;
  edit_distance:  number;
}

export async function collectTrainingExample(
  meta: any,
  diff: string,
  accepted: boolean
): Promise<void> {
  if (!accepted) return;
  if (meta.costUsd > 0.15) return;

  const example: TrainingExample = {
    example_id:     randomUUID(),
    task:           meta.task,
    repo_language:  meta.language,
    context_chunks: (meta.retrievedChunks || []).map((c: any) => c.text),
    diff,
    turns:          meta.turns,
    model:          meta.model,
    ts:             new Date().toISOString(),
    accepted:       true,
    edit_distance:  0,
  };

  const month   = new Date().toISOString().slice(0, 7);
  const outDir = join(os.homedir(), '.goli_cli', 'training-data');
  const outPath = join(outDir, `${month}.jsonl`);
  
  const fssync = require('fs');
  if (!fssync.existsSync(outDir)) {
      fssync.mkdirSync(outDir, { recursive: true });
  }

  appendFileSync(outPath, JSON.stringify(example) + '\n');
}
