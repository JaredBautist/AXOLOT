import memoize from 'lodash-es/memoize.js';
import addDir from './commands/add-dir/index.js';
import clear from './commands/clear/index.js';
import theme from './commands/theme/index.js';
import help from './commands/help/index.js';
import exit from './commands/exit/index.js';
import logout from './commands/logout/index.js';
import model from './commands/model/index.js';
import config from './commands/config/index.js';
import { context } from './commands/context/index.js';
import usage from './commands/usage/index.js';
import { type Command } from './types/command.js';

export const getCommandName = (cmd: Command) => cmd.name;
export const isCommandEnabled = (cmd: Command) => true;

export const getCommands = memoize(async (cwd: string): Promise<Command[]> => {
  return [addDir, clear, theme, help, exit, logout, model, config, context, usage];
});

export const getSkillToolCommands = async () => [];
export const getSlashCommandToolSkills = async () => [];
export const clearCommandsCache = () => {};
export const clearCommandMemoizationCaches = () => {};
export const isBridgeSafeCommand = () => true;
export const filterCommandsForRemoteMode = (cmds: any) => cmds;
export const findCommand = (name: string, cmds: any) => cmds.find((c: any) => c.name === name);
export const hasCommand = (name: string, cmds: any) => cmds.some((c: any) => c.name === name);
export const getCommand = (name: string, cmds: any) => cmds.find((c: any) => c.name === name);
export const formatDescriptionWithSource = (cmd: any) => cmd.description;
export const builtInCommandNames = () => new Set(['add-dir', 'clear', 'theme', 'help', 'exit', 'logout', 'model', 'config', 'context', 'usage']);
export const getMcpSkillCommands = (cmds: any) => [];

export const REMOTE_SAFE_COMMANDS: Set<Command> = new Set([clear, theme, help, exit, model, config]);
export default [addDir, clear, theme, help, exit, logout, model, config, context, usage];
