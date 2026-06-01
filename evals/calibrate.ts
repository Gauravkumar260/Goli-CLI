import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline/promises";
import { Command } from "commander";

const program = new Command();

program
  .name("goli_cli-calibrate")
  .description("Human calibration for AI model grader")
  .option("--count <number>", "Number of tasks to calibrate", "5")
  .action(async (options) => {
    const projectRoot = process.cwd();
    const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(require('os').homedir(), '.goli_cli');
    const logPath = path.join(projectRoot, "evals", "calibration-log.jsonl");

    const sessionsDir = path.join(GOLI_CLI_HOME, "sessions");
    let files: string[] = [];
    try {
        files = await fs.readdir(sessionsDir);
    } catch (e) {
        console.log("No sessions found.");
        return;
    }
    const sessionFiles = files.filter(f => f.endsWith(".jsonl")).slice(-20);

    console.log(`\n⚖️  Starting Human Calibration ritual (${options.count} sessions)`);
    console.log("──────────────────────────────────────────────────────────");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let agreed = 0;
    let count = 0;
    const targetCount = parseInt(options.count);

    for (const file of sessionFiles) {
        if (count >= targetCount) break;

        const content = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const events = content.trim().split("\n").map(l => JSON.parse(l));
        
        const gradeEvent = events.find(e => e.type === "eval_grade" || e.grade);
        if (!gradeEvent) continue;

        console.log(`\n[Session ${file.replace('.jsonl', '')}]`);
        console.log(`Task: ${gradeEvent.task_description || "N/A"}`);
        console.log(`Model Verdict: ${gradeEvent.passed ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Model Reasoning: ${gradeEvent.reason || gradeEvent.grade?.reason}`);
        
        const answer = await rl.question("\nDo you agree with this verdict? [A] Agree  [D] Disagree  [P] Partial  [S] Skip: ");
        const verdict = answer.trim().toLowerCase();

        if (verdict === 's') continue;
        
        count++;
        if (verdict === 'a') agreed++;

        const record = {
            ts: new Date().toISOString(),
            session_id: file.replace('.jsonl', ''),
            model_verdict: gradeEvent.passed,
            human_verdict: verdict,
        };

        await fs.appendFile(logPath, JSON.stringify(record) + "\n", "utf8");
    }

    rl.close();

    if (count > 0) {
        const rate = (agreed / count) * 100;
        console.log("\n──────────────────────────────────────────────────────────");
        console.log(`🏁 Calibration complete: ${agreed}/${count} agreement.`);
        console.log(`📈 Agreement Rate: ${rate.toFixed(1)}%`);
        console.log("──────────────────────────────────────────────────────────\n");
    } else {
        console.log("No valid sessions found to calibrate.");
    }
  });

program.parse();
