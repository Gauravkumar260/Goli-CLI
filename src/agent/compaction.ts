import { AgentContext } from "./AgentContext";
import { ModelProvider } from "../providers/ModelProvider";

export async function compactContext(
  context: AgentContext,
  compactModel: ModelProvider
): Promise<AgentContext> {
  const messagesToCompact = context.messages.slice(1, -2); // keep system prompt + last 2 turns
  
  if (messagesToCompact.length === 0) return context;

  const response = await compactModel.complete([
    ...messagesToCompact,
    { role: 'user', content: 'Summarize the technical progress, decisions made, and current diff state in 300 words.' }
  ], 'You are a context compaction agent. Summarize concisely.');

  const newContext = new AgentContext([
    context.messages[0], // system prompt
    { role: 'assistant', content: `Summary of prior turns: ${response}` },
    ...context.messages.slice(-2) // last 2 turns
  ]);
  
  newContext.systemPrompt = context.systemPrompt;
  return newContext;
}
