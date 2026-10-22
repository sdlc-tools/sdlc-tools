#!/usr/bin/env node
import { runMain } from '@sdlc-tools/core';
import { createCli } from './cli.js';
import { createNodePorts, readPackageVersion } from './node.js';

await runMain(createCli({ version: await readPackageVersion(), ports: createNodePorts() }));
