import * as fs from "fs/promises";
import * as path from "path";
import { runTask } from "./harness";
import { type EvalTask, type EvalRecord } from "./types";
import { Command } from "commander";
import { ModelGrader } from "./graders/ModelGrader";
import { FailureAnalysis } from "./failure-analysis";
import { GeminiProvider } from "../src/providers/GeminiProvider";
import { detectModelDrift } from "./drift-monitor";
import dotenv from "dotenv";

dotenv.config();

const program = new Command();

program
  .name("goli-cli-eval")
  .description("Goli-CLI Evaluation Harness v2")
  .option("--split <name>", "Split to run (train|held-out)", "train")
  .option("--model <name>", "Model to evaluate", "gemini-flash-latest")
  .option("--limit <number>", "Limit number of tasks", "100")
  .option("--mock", "Use mock provider", false)
  .action(async (options) => {
    const projectRoot = process.cwd();
    const splitPath = path.join(projectRoot, "evals", "splits", `${options.split}.json`);
    
    if (options.split === "held-out") {
        console.log("\n⚠️  WARNING: You are about to run the HELD-OUT split.");
        console.log("This should only be done for final phase verification to prevent prompt overfitting.");
        const readline = require('readline/promises');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("Type 'I understand' to continue: ");
        rl.close();
        if (answer.trim() !== "I understand") {
            console.log("Aborting.");
            process.exit(0);
        }
    }

    const taskIds = JSON.parse(await fs.readFile(splitPath, "utf-8")) as string[];
    const tasks: EvalTask[] = [];

    for (const id of taskIds) {
        let taskPath = path.join(projectRoot, "evals", "golden-set", "v1", `${id}.json`);
        const fssync = require('fs');
        if (!fssync.existsSync(taskPath)) {
            taskPath = path.join(projectRoot, "evals", "golden-set", "v2", `${id}.json`);
        }
        tasks.push(JSON.parse(await fs.readFile(taskPath, "utf-8")));
    }

    const runLimit = parseInt(options.limit);
    const tasksToRun = tasks.slice(0, runLimit);

    console.log(`\n🧪 Starting Evaluation [split: ${options.split}] [tasks: ${tasksToRun.length}]`);
    console.log(`📡 Model: ${options.mock ? 'mock' : options.model}`);
    console.log("──────────────────────────────────────────────────────────");

    const apiKey = process.env.GEMINI_API_KEY!;
    const graderModel = new GeminiProvider(apiKey, "gemini-flash-lite-latest");
    const grader = new ModelGrader(graderModel);
    const analyst = new FailureAnalysis(graderModel);

    if (options.mock) {
        process.env.GOLI_CLI_PROVIDER = "mock";
    }

    const records: EvalRecord[] = [];
    let successCount = 0;
    let totalLatency = 0;

    for (const task of tasksToRun) {
        try {
            const t0 = Date.now();
            const record = await runTask(task, {
                model: options.model,
                maxTurns: 10,
                sessionCostCap: 0.10
            });
            totalLatency += (Date.now() - t0);

            if (task.oracle_type !== 'test_suite' && record.result) {
                record.grade = await grader.grade(task, record.result);
            }

            if (!record.grade.passed) {
                const analysis = await analyst.analyze(task, record);
                console.log(`[${task.task_id}] ❌ FAILED | Mode: ${analysis.failure_class} | Evidence: ${analysis.evidence}`);
            } else {
                successCount++;
                console.log(`[${task.task_id}] ✅ PASSED | Score: ${record.grade.score.toFixed(2)} | Reason: ${record.grade.reason}`);
            }
            
            records.push(record);
        } catch (e: any) {
            console.error(`💥 [${task.task_id}] ERROR: ${e.message}`);
        }
    }

    const currentPassRate = successCount / tasksToRun.length;
    const avgLatency = totalLatency / tasksToRun.length;

    console.log("\n──────────────────────────────────────────────────────────");
    console.log(`🏁 Eval Complete: ${successCount}/${tasksToRun.length} passed.`);
    console.log(`📈 Pass Rate: ${(currentPassRate * 100).toFixed(1)}%`);
    
    // Drift Monitoring
    const baselinePassRate = 0.65; // Phase 7 Baseline
    const report = await detectModelDrift(baselinePassRate, currentPassRate, 2000, avgLatency, 1.0);
    
    if (report.drifts.length > 0) {
        console.log("\n📡 Drift Alerts Detected:");
        report.drifts.forEach(d => {
            console.log(`- [${d.severity.toUpperCase()}] ${d.type}: ${d.message}`);
            console.log(`  └─ Action: ${d.action}`);
        });
    }

    console.log("──────────────────────────────────────────────────────────\n");
  });

async function fileExists(p: string) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

program.parse();
