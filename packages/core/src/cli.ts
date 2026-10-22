import type { Cli, Command, CommandContext, Group, Node } from './command.js';
import { CliError, describeUnknownError, ExitCode, isCliError } from './errors.js';
import { renderCommandHelp, renderGroupHelp } from './help.js';
import { writeError, writeLine, writeResult } from './output.js';
import { parseCommandInput } from './parse.js';
import type { Runtime } from './runtime.js';
import { suggest } from './suggest.js';

type Routed =
  | { readonly kind: 'help'; readonly text: string }
  | { readonly kind: 'version' }
  | {
      readonly kind: 'run';
      readonly command: Command;
      readonly path: readonly string[];
      readonly rest: readonly string[];
    };

function isHelpFlag(token: string): boolean {
  return token === '--help' || token === '-h';
}

function helpFor(path: readonly string[], node: Cli | Group | Command): string {
  return node.kind === 'command' ? renderCommandHelp(path, node) : renderGroupHelp(path, node);
}

/**
 * Walks the leading words of `argv` down the command tree. Command words must
 * come first; once a command is reached everything after it belongs to that
 * command's own arguments. Usage problems throw a usage error carrying the help
 * of the deepest group reached.
 */
function route(cli: Cli, argv: readonly string[]): Routed {
  if (argv[0] === 'help') {
    return routeHelp(cli, argv.slice(1));
  }

  let node: Cli | Group = cli;
  const path = [cli.name];
  for (let index = 0; ; index += 1) {
    const token = argv[index];
    const usage = renderGroupHelp(path, node);

    if (token === undefined) {
      throw new CliError('usage', `Missing command for '${path.join(' ')}'.`, {
        code: 'missing_command',
        usage,
      });
    }
    if (isHelpFlag(token)) return { kind: 'help', text: usage };
    if (node.kind === 'cli' && (token === '--version' || token === '-V'))
      return { kind: 'version' };
    if (token.startsWith('-')) {
      throw new CliError(
        'usage',
        `Unexpected option '${token}' before a command. Put options after the command name.`,
        { code: 'option_before_command', usage },
      );
    }

    const child: Node | undefined = node.commands.find((candidate) => candidate.name === token);
    if (child === undefined) {
      const hint = suggest(
        token,
        node.commands.map((candidate) => candidate.name),
      );
      throw new CliError(
        'usage',
        `Unknown command '${token}'.${hint === undefined ? '' : ` Did you mean '${hint}'?`}`,
        { code: 'unknown_command', usage },
      );
    }

    path.push(child.name);
    if (child.kind === 'command') {
      return { kind: 'run', command: child, path, rest: argv.slice(index + 1) };
    }
    node = child;
  }
}

function routeHelp(cli: Cli, words: readonly string[]): Routed {
  let node: Cli | Group | Command = cli;
  const path = [cli.name];
  for (const word of words) {
    if (node.kind === 'command') break;
    const child: Node | undefined = node.commands.find((candidate) => candidate.name === word);
    if (child === undefined) {
      throw new CliError('usage', `Unknown command '${word}'.`, {
        code: 'unknown_command',
        usage: renderGroupHelp(path, node),
      });
    }
    node = child;
    path.push(word);
  }
  return { kind: 'help', text: helpFor(path, node) };
}

function wantsJson(argv: readonly string[]): boolean {
  const terminator = argv.indexOf('--');
  return (terminator === -1 ? argv : argv.slice(0, terminator)).includes('--json');
}

function toCliError(error: unknown, runtime: Runtime): { error: CliError; stack?: string } {
  if (isCliError(error)) return { error };
  if (runtime.signal?.aborted === true) {
    return { error: new CliError('cancelled', 'Cancelled.', { cause: error }) };
  }
  const wrapped = new CliError('unexpected', `Unexpected error: ${describeUnknownError(error)}`, {
    code: 'unexpected',
    next: ['This is a bug. Run again with SDLC_DEBUG=1 to print a stack trace, and report it.'],
    cause: error,
  });
  const stack =
    runtime.env.SDLC_DEBUG !== undefined && error instanceof Error ? error.stack : undefined;
  return { error: wrapped, ...(stack === undefined ? {} : { stack }) };
}

/**
 * Runs a CLI definition against an argument vector and resolves with the exit
 * code. It never throws and never exits the process: results go to
 * `runtime.stdout`, diagnostics and errors to `runtime.stderr`.
 *
 * - `--help` prints help to stdout and exits 0; a wrong or incomplete command
 *   prints the error and the relevant help to stderr and exits 2.
 * - `--json` switches the result (and any error) to JSON.
 */
export async function runCli(cli: Cli, argv: readonly string[], runtime: Runtime): Promise<number> {
  let json = wantsJson(argv);
  try {
    const routed = route(cli, argv);

    if (routed.kind === 'help') {
      writeLine(runtime.stdout, routed.text);
      return ExitCode.Ok;
    }
    if (routed.kind === 'version') {
      writeLine(runtime.stdout, `${cli.name} ${cli.version}`);
      return ExitCode.Ok;
    }

    const parsed = parseCommandInput(routed.path, routed.command, routed.rest);
    if (parsed.kind === 'help') {
      writeLine(runtime.stdout, renderCommandHelp(routed.path, routed.command));
      return ExitCode.Ok;
    }

    json = parsed.json;
    const context: CommandContext = {
      ...runtime,
      json,
      log: (message) => {
        writeLine(runtime.stderr, message);
      },
    };
    const result = await routed.command.run(parsed.input, context);
    writeResult(runtime.stdout, result, json);
    return ExitCode.Ok;
  } catch (thrown) {
    const { error, stack } = toCliError(thrown, runtime);
    writeError(runtime.stderr, error, json, stack);
    return error.exitCode;
  }
}
