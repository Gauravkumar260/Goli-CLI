// src/agent/Planner.ts
import { type Plan, type PlanStep } from "./Plan.js";
import type { ModelProvider } from "../providers/ModelProvider.js";

export async function createPlan(
        task: string,
        model: ModelProvider,
    scoutFindings?: string
): Promise<Plan> {
        const prompt = `
    You are a planning agent. Given a task and scout findings, output a JSON plan for a team of AI agents.
    
    TASK: "${task}"
    ${scoutFindings ? `SCOUT FINDINGS:\n${scoutFindings}` : ''}

    Respond ONLY with a valid JSON object matching this schema:
    {
      "taskSummary": "one sentence summary",
      "steps": [
        {
          "id": "1",
          "description": "step description",
          "files": ["path/to/file1.ts", "path/to/file2.ts"],
          "rationale": "why this step is needed",
          "dependsOn": []
        }
      ]
    }
    
    Keep steps atomic â€” each step touches at most 2-3 files.
    If multiple steps can run in parallel (no file overlap, no shared dependencies), they should have empty 'dependsOn' lists.
    `;

        const response = await model.complete(
                [{ role: "user", content: prompt }],
                "You are a planning agent. Respond only with valid JSON.",
        );

        try {
                const jsonStr = response.text.trim();
        const match = jsonStr.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON found");
                const plan = JSON.parse(match[0]) as Plan;
                return plan;
        } catch (err) {
                console.error("Plan parsing failed:", err);
                return {
            taskSummary: task,
                        steps: [
                                {
                                        id: "1",
                                        description: task,
                    files: [],
                                        rationale: "Execute task sequentially",
                                        dependsOn: [],
                                },
                        ],
                };
        }
}
