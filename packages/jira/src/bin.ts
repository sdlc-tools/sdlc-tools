#!/usr/bin/env node
import { runMain } from '@sdlc-tools/core';
import { cli } from './cli.js';

await runMain(cli);
