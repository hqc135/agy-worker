#!/usr/bin/env node
import {stateContext, inspectState} from './task-lifecycle.mjs';
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--workspace')
    throw new Error('Usage: node task-state.mjs --workspace <directory>');
  process.stdout.write(JSON.stringify(inspectState(stateContext(process.argv[3])), null, 2) + '\n');
} catch (error) {process.stderr.write(error.message + '\n'); process.exitCode=1;}
