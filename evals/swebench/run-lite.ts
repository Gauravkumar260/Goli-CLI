import * as fs from "fs/promises";
import { loadSWEBenchLite } from "./loader";
import { runTask } from "../harness";

const SWEB_COST_CAP_USD = 5.00;

async function runSWEBenchLite() {
  const tasks = await loadSWEBenchLite();
  let spent = 0;
  const results = [];

  console.log(`\n🏆 Goli-CLI Industry Benchmark: SWE-bench Lite (${tasks.length} tasks)`);
  console.log(`💰 Budget Cap: $${SWEB_COST_CAP_USD.toFixed(2)}`);
  console.log("──────────────────────────────────────────────────────────");

  for (const [i, task] of tasks.entries()) {
    if (spent >= SWEB_COST_CAP_USD) {
      console.log(`⚠️ Budget cap reached. Skipping remaining tasks.`);
      break;
    }

    console.log(`[${i+1}/${tasks.length}] Evaluating ${task.instance_id}...`);
    
    try {
        const record = await runTask(task, {
            model: 'gemini-flash-latest',
            maxTurns: 15,
            sessionCostCap: 0.10
        });
        
        spent += record.result?.costUsd || 0;
        results.push(record);
        
        console.log(`   └─ Result: ${record.grade.passed ? '✅ PASSED' : '❌ FAILED'} | Cost: $${(record.result?.costUsd || 0).toFixed(4)}`);
    } catch (e: any) {
        console.error(`   └─ 💥 ERROR: ${e.message}`);
    }
  }

  const resolved = results.filter(r => r.grade.passed).length;
  const passRate = results.length > 0 ? (resolved / results.length) * 100 : 0;

  console.log("──────────────────────────────────────────────────────────");
  console.log(`🏁 SWE-bench Lite Complete`);
  console.log(`📊 Resolved: ${resolved}/${results.length} (${passRate.toFixed(1)}%)`);
  console.log(`💸 Total Cost: $${spent.toFixed(2)}`);
  console.log("──────────────────────────────────────────────────────────\n");
}

runSWEBenchLite().catch(console.error);
