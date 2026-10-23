import { defineCli, type Cli } from '@sdlc-tools/core';
import { authGroup } from './commands/auth.js';
import { branchGroup } from './commands/branch.js';
import { prGroup } from './commands/pr.js';
import type { Ports } from './ports.js';

export interface CreateCliOptions {
  readonly version: string;
  readonly ports: Ports;
}

/** The `sdlc-forgejo` command tree; everything it touches outside `Runtime` comes through `ports`. */
export function createCli({ version, ports }: CreateCliOptions): Cli {
  return defineCli({
    name: 'sdlc-forgejo',
    version,
    summary: 'Pull requests on Forgejo and Gitea, for people and AI agents',
    description: [
      'Signs in with OAuth (PKCE) or a personal access token, keeps credentials in the operating system keychain,',
      'and opens, reviews and merges pull requests. Merges always create a merge commit.',
      '',
      'The server comes from --host, SDLC_FORGEJO_HOST or the configuration; the repository from --repo,',
      'SDLC_FORGEJO_REPO, the configuration or the origin remote of the current checkout.',
    ].join('\n'),
    commands: [authGroup(), prGroup(ports), branchGroup(ports)],
  });
}
