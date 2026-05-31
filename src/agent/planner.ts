import { ModelProvider } from "../providers/ModelProvider";

export interface PlanStep {
  id: number;
  tool: string;
  rationale: string;
  forEach?: string;
}

export interface Plan {
  planId: string;
  complexity: 'low' | 'medium' | 'high';
  steps: PlanStep[];
  estimatedTurns: number;
  requiresSubagents: boolean;
  checkpointAfter: number[];
}

export function needsPlan(task: string): boolean {
  // Heuristics for deliberative planning
  const signals = [
    task.split(' ').length > 20,                          // long task description
    /all (files|usages|instances|tests)/i.test(task),    // "all X" implies many files
    /migrat|refactor|replac|rename/i.test(task),          // broad structural change
    (task.match(/and|then|also|after/g) ?? []).length > 2, // multi-step implied
  ];
  return signals.filter(Boolean).length >= 2;
}

export async function makePlan(
  task: string,
  repoMap: string,
  model: ModelProvider
): Promise<Plan> {
  const prompt = `
You are a planning agent for APEX, a CLI coding assistant. 
Given a coding task and a repository map, produce a concise execution plan as JSON.
Be specific about which tools to call and in what order.
Estimate the number of turns needed. Flag any step that requires human review (checkpoint).

Available tools:
- read_file, read_file_lines, list_directory, edit_file, write_file, shell_exec, run_tests, search_code, git_diff, git_status, git_create_branch

Task: ${task}

Repository map (top-level symbols):
${repoMap}

Respond ONLY with valid JSON matching this schema — no preamble, no markdown:
{
  "planId": "string (uuid)",
  "complexity": "low|medium|high",
  "steps": [{"id": 1, "tool": "tool_name", "rationale": "why"}],
  "estimatedTurns": 5,
  "requiresSubagents": false,
  "checkpointAfter": [1]
}
`;

  const response = await model.complete(
    [{ role: 'user', content: prompt }],
    'You are a planning agent. Respond only with valid JSON.'
  );

  try {
    // Clean JSON from potential markdown blocks
    const jsonStr = response.match(/\{[\s\S]*\}/)?.[0] || response;
    const plan = JSON.parse(jsonStr) as Plan;
    plan.planId = plan.planId || Math.random().toString(36).substring(7);
    return plan;
  } catch (e) {
    console.error("Failed to parse plan JSON:", e);
    // Fallback simple plan
    return {
      planId: "fallback",
      complexity: 'medium',
      steps: [{ id: 1, tool: 'search_code', rationale: 'Explore codebase to determine steps' }],
      estimatedTurns: 10,
      requiresSubagents: false,
      checkpointAfter: [],
    };
  }
}
