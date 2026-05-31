export interface Sandbox {
  init(): Promise<void>;
  execute(command: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  destroy(): Promise<void>;
  
  // Phase 5: Staging and Diff extraction
  extractDiff(): Promise<string>;
  applyDiffToHost(diff: string): Promise<void>;
}
