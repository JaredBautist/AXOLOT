export type PermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ClaudeForChromeContext {
  [key: string]: unknown;
}

export const BROWSER_TOOLS: Array<{ name: string }>;

export function createClaudeForChromeMcpServer(
  context?: ClaudeForChromeContext,
): {
  connect(transport: unknown): Promise<void>;
};
