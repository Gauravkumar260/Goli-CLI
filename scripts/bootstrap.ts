// scripts/bootstrap.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dirs = [
	path.join(os.homedir(), ".goli"),
	path.join(os.homedir(), ".goli", "sessions"),
	path.join(os.homedir(), ".goli", "training-data"),
	path.join(os.homedir(), ".goli", "workspaces"),
];

for (const dir of dirs) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(`✓ ${dir}`);
	} else {
		console.log(`- ${dir} (exists)`);
	}
}

// Create default config if missing
const configPath = path.join(os.homedir(), ".goli", "config.json");
if (!fs.existsSync(configPath)) {
	const defaultConfig = {
		version: "0.1.0",
		defaultModel: "gemini/gemini-flash-latest",
		features: {
			subagents: false,
			mcpServer: true,
			planningAlwaysOn: false,
			anonymousTelemetry: false,
			autoCommitMode: false,
			gitHubIntegration: false,
			rlaifFeedback: false,
		},
	};
	fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
	console.log(`✓ Created ${configPath}`);
}

console.log("\n✅ V2 Bootstrap complete");
