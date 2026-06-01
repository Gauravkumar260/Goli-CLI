import { runTask } from "./harness";
import * as fs from "fs/promises";
import * as path from "path";
import { type EvalTask } from "./types";
import { Command } from "commander";
import { type PromptConfig } from "../src/agent/systemPrompt";

const program = new Command();

program
  .name("goli_cli-ab")
  .description("A/B test two Goli_CLI configurations")
  .option("--modelA <name>", "Baseline model", "gemini-flash-latest")
  .option("--modelB <name>", "Challenger model", "gemini-flash-latest")
  .option("--configA <path>", "Baseline prompt config JSON")
  .option("--configB <path>", "Challenger prompt config JSON")
  .option("--tasks <ids>", "Comma-separated task IDs", "task-001,task-002,task-003")
  .action(async (options) => {
    const projectRoot = process.cwd();
    const taskIds = options.tasks.split(",");
    
    console.log(`\n⚖️  Starting A/B Test`);
    console.log(`Baseline (A):   ${options.modelA} ${options.configA ? `(${options.configA})` : ''}`);
    console.log(`Challenger (B): ${options.modelB} ${options.configB ? `(${options.configB})` : ''}`);
    console.log("──────────────────────────────────────────────────────────");

    let promptConfigA: PromptConfig | undefined;
    let promptConfigB: PromptConfig | undefined;

    if (options.configA) {
        promptConfigA = JSON.parse(await fs.readFile(options.configA, "utf-8"));
    }
    if (options.configB) {
        promptConfigB = JSON.parse(await fs.readFile(options.configB, "utf-8"));
    }

    const tasks: EvalTask[] = [];
    for (const id of taskIds) {
        let taskPath = path.join(projectRoot, "evals", "golden-set", "v1", `${id}.json`);
        const fssync = require('fs');
        if (!fssync.existsSync(taskPath)) {
            taskPath = path.join(projectRoot, "evals", "golden-set", "v2", `${id}.json`);
        }
        tasks.push(JSON.parse(await fs.readFile(taskPath, "utf-8")));
    }

    let aWins = 0;
    let bWins = 0;
    let ties = 0;

    for (const task of tasks) {
        console.log(`\nTesting Task ${task.task_id}...`);
        
        const recordA = await runTask(task, { 
            model: options.modelA, 
            maxTurns: 10, 
            sessionCostCap: 0.10,
            promptConfig: promptConfigA
        });
        
        const recordB = await runTask(task, { 
            model: options.modelB, 
            maxTurns: 10, 
            sessionCostCap: 0.10,
            promptConfig: promptConfigB
        });

        console.log(`A: ${recordA.grade.passed ? '✅' : '❌'} | Score: ${recordA.grade.score.toFixed(2)}`);
        console.log(`B: ${recordB.grade.passed ? '✅' : '❌'} | Score: ${recordB.grade.score.toFixed(2)}`);

        if (recordA.grade.score > recordB.grade.score) aWins++;
        else if (recordB.grade.score > recordA.grade.score) bWins++;
        else ties++;
    }

    console.log("\n──────────────────────────────────────────────────────────");
    console.log(`🏁 A/B Test Complete`);
    console.log(`A Wins: ${aWins} | B Wins: ${bWins} | Ties: ${ties}`);
    console.log("──────────────────────────────────────────────────────────\n");
  });

program.parse();
