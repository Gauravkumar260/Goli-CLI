/**
 * Agent Panel — VS Code tree view for the GOLI agent status.
 *
 * Shows the agent's current state (idle, thinking, executing tool, etc.)
 * and provides quick actions (wake up, stop, view audit log).
 *
 * @module vscode-ext/agent_panel
 */

import * as vscode from 'vscode';

/** The agent's current state. */
export type AgentState = 'idle' | 'thinking' | 'executing-tool' | 'waiting-approval' | 'done' | 'error';

/** A tree item in the agent panel. */
export class AgentPanelItem extends vscode.TreeItem {
  constructor(
    public readonly state: AgentState,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description?: string,
    public readonly tooltip?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = tooltip;
  }
}

/**
 * Tree data provider for the GOLI Agent panel.
 */
export class GoliAgentPanel implements vscode.TreeDataProvider<AgentPanelItem> {
  private state: AgentState = 'idle';
  private currentTask: string | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<AgentPanelItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  /**
   * Update the agent state (called from the extension when stdout events arrive).
   * @param state
   * @param task
   */
  setState(state: AgentState, task?: string): void {
    this.state = state;
    if (task) this.currentTask = task;
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: AgentPanelItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentPanelItem): AgentPanelItem[] {
    if (element) return [];

    const iconForState: Record<AgentState, string> = {
      idle: 'circle-outline',
      thinking: 'loading~spin',
      'executing-tool': 'tools',
      'waiting-approval': 'key',
      done: 'check',
      error: 'error',
    };

    const labelForState: Record<AgentState, string> = {
      idle: 'Agent: Idle',
      thinking: 'Agent: Thinking...',
      'executing-tool': 'Agent: Executing Tool',
      'waiting-approval': 'Agent: Waiting for Approval',
      done: 'Agent: Done',
      error: 'Agent: Error',
    };

    const items: AgentPanelItem[] = [
      new AgentPanelItem(
        this.state,
        labelForState[this.state],
        vscode.TreeItemCollapsibleState.None,
        this.currentTask,
        `State: ${this.state}${this.currentTask ? ` | Task: ${this.currentTask}` : ''}`,
      ),
    ];

    // Add quick-action items based on state.
    if (this.state === 'idle') {
      items.push(
        new AgentPanelItem(
          'idle',
          'Wake Up Agent',
          vscode.TreeItemCollapsibleState.None,
          'Click to start',
          'Run the GOLI agent on a task',
        ),
      );
    } else if (this.state === 'thinking' || this.state === 'executing-tool') {
      items.push(
        new AgentPanelItem(
          this.state,
          'Stop Agent',
          vscode.TreeItemCollapsibleState.None,
          'Click to abort',
          'Abort the current run',
        ),
      );
    }

    // Always show the audit log entry.
    items.push(
      new AgentPanelItem(
        'idle',
        'View Audit Log',
        vscode.TreeItemCollapsibleState.None,
        'Recent agent actions',
        'Open the audit log viewer',
      ),
    );

    // Set icons.
    for (const item of items) {
      item.iconPath = new vscode.ThemeIcon(iconForState[item.state] ?? 'circle-outline');
    }

    return items;
  }
}
