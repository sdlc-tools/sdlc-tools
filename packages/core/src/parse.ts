import { parseArgs } from 'node:util';
import { toFlagName, type Command, type OptionSpec, type RawInput } from './command.js';
import { CliError } from './errors.js';
import { renderCommandHelp } from './help.js';
import { suggest } from './suggest.js';

export type ParseOutcome =
  | { readonly kind: 'help' }
  | { readonly kind: 'parsed'; readonly json: boolean; readonly input: RawInput };

interface KnownOption {
  readonly key: string;
  readonly spec: OptionSpec;
}

/**
 * Parses the arguments that follow a command name. Validation happens here, in
 * a fixed order, before the command's `run` is called and therefore before any
 * configuration, credential or network access:
 * unknown/malformed options, then positionals, then required options, then choices.
 * Every failure is a usage error carrying the command's help text.
 */
export function parseCommandInput(
  path: readonly string[],
  command: Command,
  argv: readonly string[],
): ParseOutcome {
  const fail = (code: string, message: string): CliError =>
    new CliError('usage', message, { code, usage: renderCommandHelp(path, command) });

  const known = new Map<string, KnownOption>();
  for (const [key, spec] of Object.entries(command.options)) {
    known.set(toFlagName(key), { key, spec });
  }

  const { tokens, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      ...Object.fromEntries(
        [...known].map(([flag, { spec }]) => [
          flag,
          { type: spec.type, ...(spec.short === undefined ? {} : { short: spec.short }) },
        ]),
      ),
    },
  });

  if (tokens.some((token) => token.kind === 'option' && token.name === 'help')) {
    return { kind: 'help' };
  }

  let json = false;
  const options: Record<string, unknown> = {};
  for (const token of tokens) {
    if (token.kind !== 'option') continue;

    if (token.name === 'json') {
      if (token.value !== undefined) {
        throw fail('unexpected_option_value', "Option '--json' does not take a value.");
      }
      json = true;
      continue;
    }

    const option = known.get(token.name);
    if (option === undefined) {
      const hint = suggest(token.name, [...known.keys(), 'json', 'help']);
      throw fail(
        'unknown_option',
        `Unknown option '${token.rawName}'.${hint === undefined ? '' : ` Did you mean '--${hint}'?`}`,
      );
    }

    const { key, spec } = option;
    const label = `--${token.name}`;
    if (spec.type === 'boolean') {
      if (token.value !== undefined) {
        throw fail('unexpected_option_value', `Option '${label}' does not take a value.`);
      }
      options[key] = true;
      continue;
    }

    if (token.value === undefined) {
      throw fail('missing_option_value', `Option '${label}' requires a value.`);
    }
    if (!token.inlineValue && token.value.startsWith('-') && token.value.length > 1) {
      throw fail(
        'missing_option_value',
        `Option '${label}' requires a value, but the next argument is '${token.value}'. ` +
          `Write '${label}=${token.value}' if that is the value.`,
      );
    }
    if (spec.choices !== undefined && !spec.choices.includes(token.value)) {
      throw fail(
        'invalid_choice',
        `Invalid value '${token.value}' for '${label}'; expected one of: ${spec.choices.join(', ')}.`,
      );
    }
    if (spec.multiple === true) {
      const existing = options[key];
      options[key] = [...(Array.isArray(existing) ? (existing as string[]) : []), token.value];
    } else {
      options[key] = token.value;
    }
  }

  const args: Record<string, unknown> = {};
  let used = 0;
  for (const spec of command.positionals) {
    const label = `<${toFlagName(spec.name)}>`;
    if (spec.variadic === true) {
      const rest = positionals.slice(used);
      if (spec.required === true && rest.length === 0) {
        throw fail('missing_argument', `Missing required argument ${label}.`);
      }
      args[spec.name] = rest;
      used = positionals.length;
      continue;
    }
    const value = positionals[used];
    if (value === undefined) {
      if (spec.required === true) {
        throw fail('missing_argument', `Missing required argument ${label}.`);
      }
      continue;
    }
    args[spec.name] = value;
    used += 1;
  }
  const extra = positionals[used];
  if (extra !== undefined) {
    throw fail('unexpected_argument', `Unexpected argument '${extra}'.`);
  }

  for (const [flag, { key, spec }] of known) {
    if (options[key] !== undefined) continue;
    if (spec.required === true) {
      throw fail('missing_option', `Missing required option '--${flag}'.`);
    }
    if (spec.type === 'boolean') options[key] = false;
    else if (spec.multiple === true) options[key] = [];
    else if (spec.default !== undefined) options[key] = spec.default;
  }

  return { kind: 'parsed', json, input: { options, args } };
}
