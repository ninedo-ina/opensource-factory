import assert from 'node:assert/strict';
import test from 'node:test';

import { UsageError, boolFlag, intFlag, parseArgs, stringFlag } from '../src/args.js';

test('parseArgs 解析命令、位置参数与长选项', () => {
  const parsed = parseArgs(['list', '--language', 'TypeScript', '--limit=20', '--json']);
  assert.equal(parsed.command, 'list');
  assert.deepEqual(parsed.positionals, []);
  assert.equal(parsed.flags.language, 'TypeScript');
  assert.equal(parsed.flags.limit, '20');
  assert.equal(parsed.flags.json, true);
});

test('parseArgs 保留命令后的多个位置参数', () => {
  const parsed = parseArgs(['search', 'rust', 'async', '--limit', '5']);
  assert.equal(parsed.command, 'search');
  assert.deepEqual(parsed.positionals, ['rust', 'async']);
});

test('parseArgs 支持 -- 之后的裸参数', () => {
  const parsed = parseArgs(['show', '--', '--weird/repo']);
  assert.equal(parsed.command, 'show');
  assert.deepEqual(parsed.positionals, ['--weird/repo']);
});

test('parseArgs 未知短选项抛 UsageError', () => {
  assert.throws(() => parseArgs(['list', '-x']), UsageError);
});

test('stringFlag / intFlag / boolFlag 归一化', () => {
  const flags = { language: ' Go ', limit: 'abc', json: 'true', yes: true };
  assert.equal(stringFlag(flags, 'language'), 'Go');
  assert.equal(stringFlag(flags, 'missing'), '');
  assert.equal(intFlag(flags, 'limit', 20), 20);
  assert.equal(intFlag({ limit: '7' }, 'limit', 20), 7);
  assert.equal(boolFlag(flags, 'json'), true);
  assert.equal(boolFlag(flags, 'yes'), true);
  assert.equal(boolFlag(flags, 'no'), false);
});
