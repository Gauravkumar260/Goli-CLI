import { Parser, Language } from "web-tree-sitter";
import * as path from "path";

export class CodeParser {
  private parser: Parser | null = null;
  private languages: Map<string, Language> = new Map();

  async init() {
    await Parser.init();
    this.parser = new Parser();
  }

  async loadLanguage(lang: string) {
    if (this.languages.has(lang)) return;

    let wasmPath = "";
    switch (lang) {
      case "typescript":
      case "ts":
        wasmPath = "lib/grammars/tree-sitter-typescript.wasm";
        break;
      case "tsx":
        wasmPath = "lib/grammars/tree-sitter-tsx.wasm";
        break;
      case "python":
      case "py":
        wasmPath = "lib/grammars/tree-sitter-python.wasm";
        break;
      case "go":
        wasmPath = "lib/grammars/tree-sitter-go.wasm";
        break;
      default:
        throw new Error(`Unsupported language: ${lang}`);
    }

    const langObj = await Language.load(wasmPath);
    this.languages.set(lang, langObj);
  }

  async parse(code: string, lang: string): Promise<any> {
    if (!this.parser) await this.init();
    await this.loadLanguage(lang);
    
    this.parser!.setLanguage(this.languages.get(lang)!);
    return this.parser!.parse(code);
  }

  getChunks(tree: any, code: string): { text: string, startLine: number, endLine: number }[] {
    const chunks: { text: string, startLine: number, endLine: number }[] = [];
    const lines = code.split("\n");

    const visit = (node: any) => {
      // Strategy: chunk at function and class definitions
      const isChunkable = [
        "function_definition",
        "class_definition",
        "method_definition",
        "function_declaration",
        "class_declaration",
        "method_declaration",
        "export_statement",
      ].includes(node.type);

      if (isChunkable) {
        chunks.push({
          text: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      } else {
        for (const child of node.children) {
          visit(child);
        }
      }
    };

    visit(tree.rootNode);

    if (chunks.length === 0) {
      const maxLines = 50;
      for (let i = 0; i < lines.length; i += maxLines) {
        const chunkLines = lines.slice(i, i + maxLines);
        chunks.push({
          text: chunkLines.join("\n"),
          startLine: i + 1,
          endLine: Math.min(i + maxLines, lines.length),
        });
      }
    }

    return chunks;
  }
}
