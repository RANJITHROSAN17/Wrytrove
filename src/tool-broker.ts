export type WorkspaceTrustState = 'untrusted' | 'trusted';

export interface ToolResourcePolicy {
  readonly allowedEnvKeys: readonly string[];
  readonly allowNetwork: boolean;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_TOOL_POLICY: ToolResourcePolicy = {
  allowedEnvKeys: ['PATH', 'LANG', 'LC_ALL'],
  allowNetwork: false,
  maxStdoutBytes: 256 * 1024,
  maxStderrBytes: 64 * 1024,
  timeoutMs: 30_000,
};

export interface ToolApprovalRequest {
  readonly workspaceId: string;
  readonly toolId: string;
  readonly executablePath: string;
  readonly fromProjectConfig?: boolean;
}

export interface BrokeredProcessHandle {
  readonly pid: number;
  kill(): void;
}

export interface ActiveToolSession {
  readonly workspaceId: string;
  readonly toolId: string;
  readonly executablePath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly policy: ToolResourcePolicy;
  readonly handle: BrokeredProcessHandle;
}

export function filterEnvironment(
  sourceEnv: Readonly<Record<string, string | undefined>>,
  allowedKeys: readonly string[],
): Record<string, string> {
  const allow = new Set(allowedKeys);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (allow.has(key) && typeof value === 'string') {
      filtered[key] = value;
    }
  }
  return filtered;
}

export class ToolBroker {
  private trustByWorkspace = new Map<string, WorkspaceTrustState>();
  private approvals = new Map<string, string>(); // `${workspaceId}::${toolId}` -> executablePath
  private active = new Map<string, ActiveToolSession>();

  private key(workspaceId: string, toolId: string): string {
    return `${workspaceId}::${toolId}`;
  }

  getWorkspaceTrust(workspaceId: string): WorkspaceTrustState {
    return this.trustByWorkspace.get(workspaceId) ?? 'untrusted';
  }

  setWorkspaceTrust(workspaceId: string, state: WorkspaceTrustState): void {
    this.trustByWorkspace.set(workspaceId, state);
    if (state === 'untrusted') {
      this.revokeWorkspace(workspaceId);
    }
  }

  approveTool(req: ToolApprovalRequest): void {
    if (req.fromProjectConfig) {
      throw new Error('Project-provided command configuration cannot grant executable permission.');
    }
    if (!req.executablePath.trim()) {
      throw new Error('Executable path must be non-empty.');
    }
    if (this.getWorkspaceTrust(req.workspaceId) !== 'trusted') {
      throw new Error('Cannot approve tool in an untrusted workspace.');
    }
    this.approvals.set(this.key(req.workspaceId, req.toolId), req.executablePath);
  }

  startTool(input: {
    workspaceId: string;
    toolId: string;
    sourceEnv: Readonly<Record<string, string | undefined>>;
    policy?: Partial<ToolResourcePolicy>;
    spawn: (executablePath: string, env: Record<string, string>, policy: ToolResourcePolicy) => BrokeredProcessHandle;
  }): ActiveToolSession {
    if (this.getWorkspaceTrust(input.workspaceId) !== 'trusted') {
      throw new Error('Untrusted workspace: subprocess execution is disabled.');
    }
    const k = this.key(input.workspaceId, input.toolId);
    const executablePath = this.approvals.get(k);
    if (!executablePath) {
      throw new Error(`Tool "${input.toolId}" is not explicitly approved for workspace "${input.workspaceId}".`);
    }

    const policy: ToolResourcePolicy = {
      ...DEFAULT_TOOL_POLICY,
      ...input.policy,
      allowNetwork: false, // Network remains disabled by default in the broker.
    };
    const env = filterEnvironment(input.sourceEnv, policy.allowedEnvKeys);
    const handle = input.spawn(executablePath, env, policy);

    const session: ActiveToolSession = {
      workspaceId: input.workspaceId,
      toolId: input.toolId,
      executablePath,
      env,
      policy,
      handle,
    };
    this.active.set(k, session);
    return session;
  }

  stopTool(workspaceId: string, toolId: string): boolean {
    const k = this.key(workspaceId, toolId);
    const session = this.active.get(k);
    if (!session) return false;
    session.handle.kill();
    this.active.delete(k);
    return true;
  }

  revokeWorkspace(workspaceId: string): number {
    let stopped = 0;
    for (const [k, session] of this.active.entries()) {
      if (session.workspaceId === workspaceId) {
        session.handle.kill();
        this.active.delete(k);
        stopped += 1;
      }
    }
    for (const k of Array.from(this.approvals.keys())) {
      if (k.startsWith(`${workspaceId}::`)) {
        this.approvals.delete(k);
      }
    }
    return stopped;
  }

  getActiveCount(): number {
    return this.active.size;
  }
}
