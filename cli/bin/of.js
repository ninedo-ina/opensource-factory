#!/usr/bin/env node
/**
 * OpenFactory CLI 入口。
 * 只做参数转发与退出码设置，逻辑都在 src/ 下，便于单测。
 */
import { run } from '../src/main.js';

const code = await run(process.argv.slice(2));
process.exitCode = code;
