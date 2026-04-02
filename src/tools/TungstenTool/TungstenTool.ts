import { Tool, type Tools } from '../../Tool.js'

export const TungstenTool: Tool = {
  name: 'tungsten',
  description: 'Tungsten tool (stub)',
  inputSchema: { type: 'object' },
  call: async () => ({ result: 'ok' }),
  isEnabled: () => false,
  isConcurrencySafe: () => true,
}