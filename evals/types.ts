import { type AgentResult } from "../src/agent/AgentLoop";

export interface EvalTask {
  task_id:           string;
  task_description:  string;
  repo:              string;    // path to fixture or real repo
  base_commit:       string;    // hash to checkout before starting
  oracle_type:       'test_suite' | 'diff_match' | 'model_graded';
  oracle:            string;    // command (for test_suite) or gold-standard diff
  expected_files:    string[];  // for precision@k
  difficulty:        'low' | 'medium' | 'high';
  use_case:          'implement' | 'debug' | 'refactor' | 'test';
  language:          'typescript' | 'python' | 'go';
}

export interface Grade {
  passed:  boolean;
  score:   number;
  reason:  string;
  details?: any;
  needsHumanReview?: boolean;
}

export interface EvalRecord {
  task:      EvalTask;
  result:    AgentResult | null;
  grade:     Grade;
  sessionId: string;
}

export interface EvalResults {
  passRate:    number;
  avgCost:     number;
  avgTurns:    number;
  records:     EvalRecord[];
}
