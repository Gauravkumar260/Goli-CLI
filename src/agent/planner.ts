import { type ModelProvider } from "../providers/ModelProvider";

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
  const signals = [
    task.split(' ').length > 20,
    /all (files|usages|instances|tests)/i.test(task),
    /migrat|refactor|replac|rename/i.test(task),
    (task.match(/and|then|also|after/g) ?? []).length > 2,
  ];
  return signals.filter(Boolean).length >= 2;
}

export async function makePlan(
  task: string,
  repoMap: string,
  model: ModelProvider
): Promise<Plan> {
  const prompt = `
You are a planning agent. Given a coding task and a repository map, produce a concise
execution plan as JSON. Be specific about which tools to call and in what order.
Estimate the number of turns needed. Flag any step that requires human review.

Task: ${task}

Repository map (top-level symbols):
${repoMap}

Respond ONLY with valid JSON matching this schema â€” no preamble, no markdown:
{
  "planId": "string (uuid)",
  "complexity": "low|medium|high",
  "steps": [{"id": 1, "tool": "tool_name", "rationale": "why"}],
  "estimatedTurns": 5,
  "requiresSubagents": false,
  "checkpointAfter": []
}
`;

  const response = await model.complete(
    [{ role: 'user', content: prompt }],
    "You are a planning agent. Respond only with valid JSON."
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in planner response");
    const plan = JSON.parse(jsonMatch[0]) as Plan;
    plan.planId = plan.planId || crypto.randomUUID();
    return plan;
  } catch {
    return {
      planId: crypto.randomUUID(),
      complexity: 'medium',
      steps: [{ id: 1, tool: 'search_code', rationale: 'Explore codebase' }],
      estimatedTurns: 15,
      requiresSubagents: false,
      checkpointAfter: [],
    };
  }
}
