/**
 * 极简参数解析：`of <command> [positionals] [--flag value] [--flag=value] [--bool]`
 * 不依赖第三方库，保持零依赖。
 */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const SHORT_FLAGS = new Map([
  ['-h', 'help'],
  ['-j', 'json'],
  ['-v', 'version'],
]);

/**
 * @param {string[]} argv
 * @returns {{command: string, positionals: string[], flags: Record<string, string|boolean>}}
 */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (SHORT_FLAGS.has(arg)) {
      flags[SHORT_FLAGS.get(arg)] = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      if (!body) throw new UsageError('无效选项 --');
      const eq = body.indexOf('=');
      if (eq >= 0) {
        const key = body.slice(0, eq);
        if (!key) throw new UsageError('无效选项 --=');
        flags[key] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      throw new UsageError(`未知选项 ${arg}`);
    }
    positionals.push(arg);
  }

  const command = positionals.shift() ?? '';
  return { command, positionals, flags };
}

/** 读取字符串型 flag（布尔 true 视为未提供）。 */
export function stringFlag(flags, name) {
  const value = flags[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** 读取整数 flag，非法值回退默认值。 */
export function intFlag(flags, name, fallback) {
  const value = stringFlag(flags, name);
  if (!value) return fallback;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

/** 布尔 flag：--json / --json=true 都算真。 */
export function boolFlag(flags, name) {
  const value = flags[name];
  if (value === undefined) return false;
  if (value === true) return true;
  return value === 'true' || value === '1' || value === 'yes';
}
