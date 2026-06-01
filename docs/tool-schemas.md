# Goli-CLI Tool Schemas (Phase 4)

This document defines the interface between the Goli-CLI agent and its environment. These schemas are injected into the system prompt and validated during execution.

## 1. Filesystem Tools

### `read_file`
Read the complete contents of a single file.
- **Risk Tier**: Safe
- **Parameters**: 
  - `path` (string): Relative path from repo root.

### `read_file_lines`
Read specific lines from a file. Use for large files to save tokens.
- **Risk Tier**: Safe
- **Parameters**: 
  - `path` (string)
  - `start` (number)
  - `end` (number)

### `list_directory`
List files in a directory.
- **Risk Tier**: Safe
- **Parameters**: 
  - `path` (string): Default is ".".

### `write_file`
Create a new file or overwrite an existing one.
- **Risk Tier**: Risky
- **Parameters**: 
  - `path` (string)
  - `content` (string)

### `edit_file`
Targeted string replacement. Safer than `write_file` for existing code.
- **Risk Tier**: Risky
- **Parameters**: 
  - `path` (string)
  - `old_str` (string): Exact content to find.
  - `new_str` (string): Replacement content.

### `delete_file`
Delete a file from the repository.
- **Risk Tier**: Destructive (Triggers HITL)
- **Parameters**: 
  - `path` (string)

## 2. Git Tools

### `git_diff`
Show pending changes in the workspace.
- **Risk Tier**: Safe
- **Parameters**: {}

### `git_status`
Show current git status.
- **Risk Tier**: Safe
- **Parameters**: {}

### `git_create_branch`
Create a new feature branch.
- **Risk Tier**: Safe
- **Parameters**: 
  - `name` (string)

### `git_commit`
Commit pending changes.
- **Risk Tier**: Destructive (Triggers HITL)
- **Parameters**: 
  - `message` (string)

## 3. Environment & Search

### `shell_exec`
Execute a command in the WSL2/Docker sandbox.
- **Risk Tier**: Risky (Triggers HITL for Tier 2 commands)
- **Parameters**: 
  - `command` (string)
  - `rationale` (string): Explanation for the audit log.

### `run_tests`
Run the project's test suite.
- **Risk Tier**: Risky
- **Parameters**: 
  - `scope` (string, optional): Filter for specific tests.

### `search_code`
Semantic search via LanceDB vector store.
- **Risk Tier**: Safe
- **Parameters**: 
  - `query` (string)
  - `topK` (number): Default is 5.
