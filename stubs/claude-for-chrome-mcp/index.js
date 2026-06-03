export const BROWSER_TOOLS = [];

export function createClaudeForChromeMcpServer() {
  return {
    async connect() {
      throw new Error(
        '@ant/claude-for-chrome-mcp is not available in this install. Claude in Chrome is disabled.',
      );
    },
  };
}
