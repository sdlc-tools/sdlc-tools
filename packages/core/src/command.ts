import type { Runtime } from './runtime.js';

export interface OptionSpec {
  readonly type: 'string' | 'boolean';
  readonly description: string;
  /** Single-letter alias, used as `-x`. */
  readonly short?: string;
  /** Placeholder shown in help, such as `<key>`; defaults to `value`. */
  readonly valueName?: string;
  readonly multiple?: boolean;
  readonly required?: boolean;
  readonly default?: string;
  /** Allowed values; anything else is a usage error. */
  readonly choices?: readonly string[];
}

/** The option map of a command that declares no options; reading any option from it is a type error. */
export type NoOptions = Readonly<Record<string, never>>;

/**
 * Option keys and argument names are camelCase; help and flags show the
 * kebab-case form (`dryRun` is `--dry-run`, `pullRequest` is `<pull-request>`).
 */
export type OptionMap = Readonly<Record<string, OptionSpec>>;

export interface PositionalSpec {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  /** Collects all remaining arguments; only valid for the last positional. */
  readonly variadic?: boolean;
}

type Choice<S extends OptionSpec> = S extends {
  readonly choices: readonly (infer C extends string)[];
}
  ? C
  : string;

export type OptionValue<S extends OptionSpec> = S['type'] extends 'boolean'
  ? boolean
  : S extends { readonly multiple: true }
    ? Choice<S>[]
    : S extends { readonly required: true } | { readonly default: string }
      ? Choice<S>
      : Choice<S> | undefined;

export type PositionalValues<P extends readonly PositionalSpec[]> = {
  [S in P[number] as S['name']]: S extends { readonly variadic: true }
    ? string[]
    : S extends { readonly required: true }
      ? string
      : string | undefined;
};

export interface CommandInput<O extends OptionMap, P extends readonly PositionalSpec[]> {
  readonly options: { readonly [K in keyof O]: OptionValue<O[K]> };
  readonly args: PositionalValues<P>;
}

/**
 * What a command returns. `text` is the short rendering for people (and for
 * agents reading plain output); `data` is the complete result, printed as one
 * JSON document when the caller passes `--json`. An empty `text` prints nothing.
 */
export interface CommandResult<T = unknown> {
  readonly data: T;
  readonly text: string;
}

export interface CommandContext extends Runtime {
  /** True when the caller asked for `--json`. */
  readonly json: boolean;
  /** Writes a progress or diagnostic line to stderr, keeping stdout for results. */
  log(message: string): void;
}

export interface CommandDefinition<O extends OptionMap, P extends readonly PositionalSpec[]> {
  readonly name: string;
  readonly summary: string;
  readonly description?: string;
  readonly options?: O;
  readonly positionals?: P;
  readonly examples?: readonly string[];
  run(input: CommandInput<O, P>, context: CommandContext): CommandResult | Promise<CommandResult>;
}

export interface RawInput {
  readonly options: Readonly<Record<string, unknown>>;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface Command {
  readonly kind: 'command';
  readonly name: string;
  readonly summary: string;
  readonly description: string | undefined;
  readonly options: OptionMap;
  readonly positionals: readonly PositionalSpec[];
  readonly examples: readonly string[];
  run(input: RawInput, context: CommandContext): CommandResult | Promise<CommandResult>;
}

export interface GroupDefinition {
  readonly name: string;
  readonly summary: string;
  readonly description?: string;
  readonly commands: readonly Node[];
}

export interface Group {
  readonly kind: 'group';
  readonly name: string;
  readonly summary: string;
  readonly description: string | undefined;
  readonly commands: readonly Node[];
}

export type Node = Command | Group;

export interface CliDefinition {
  /** The executable name, such as `sdlc-forgejo`. */
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly description?: string;
  readonly commands: readonly Node[];
}

export interface Cli {
  readonly kind: 'cli';
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly description: string | undefined;
  readonly commands: readonly Node[];
}

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const OPTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const RESERVED_OPTION_KEYS = new Set(['json', 'help']);
const RESERVED_SHORTS = new Set(['h']);

export function toFlagName(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function assertName(kind: string, name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}": use lowercase words joined by "-".`);
  }
}

function assertUniqueNames(owner: string, nodes: readonly Node[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.name)) throw new Error(`Duplicate command "${node.name}" under ${owner}.`);
    seen.add(node.name);
  }
}

function assertOptions(command: string, options: OptionMap): void {
  const shorts = new Set<string>();
  const flags = new Set<string>();
  for (const [key, spec] of Object.entries(options)) {
    if (!OPTION_KEY_PATTERN.test(key) || RESERVED_OPTION_KEYS.has(key)) {
      throw new Error(`Invalid option key "${key}" in command "${command}".`);
    }
    const flag = toFlagName(key);
    if (flags.has(flag)) throw new Error(`Duplicate flag --${flag} in command "${command}".`);
    flags.add(flag);
    if (spec.short !== undefined) {
      if (
        !/^[a-zA-Z]$/.test(spec.short) ||
        RESERVED_SHORTS.has(spec.short) ||
        shorts.has(spec.short)
      ) {
        throw new Error(`Invalid or duplicate short flag -${spec.short} in command "${command}".`);
      }
      shorts.add(spec.short);
    }
    if (
      spec.type === 'boolean' &&
      (spec.multiple === true || spec.choices !== undefined || spec.default !== undefined)
    ) {
      throw new Error(
        `Boolean option --${flag} in command "${command}" cannot use multiple, choices or default.`,
      );
    }
    if (spec.required === true && spec.default !== undefined) {
      throw new Error(
        `Option --${flag} in command "${command}" cannot be both required and have a default.`,
      );
    }
  }
}

function assertPositionals(command: string, positionals: readonly PositionalSpec[]): void {
  let optionalSeen = false;
  positionals.forEach((spec, index) => {
    if (!OPTION_KEY_PATTERN.test(spec.name)) {
      throw new Error(`Invalid argument name "${spec.name}" in command "${command}".`);
    }
    if (spec.variadic === true && index !== positionals.length - 1) {
      throw new Error(`Variadic argument <${spec.name}> must be last in command "${command}".`);
    }
    if (spec.required === true && optionalSeen) {
      throw new Error(
        `Required argument <${spec.name}> follows an optional one in command "${command}".`,
      );
    }
    if (spec.required !== true) optionalSeen = true;
  });
}

export function defineCommand<
  const O extends OptionMap = NoOptions,
  const P extends readonly PositionalSpec[] = readonly [],
>(definition: CommandDefinition<O, P>): Command {
  assertName('command', definition.name);
  const options: OptionMap = definition.options ?? {};
  const positionals: readonly PositionalSpec[] = definition.positionals ?? [];
  assertOptions(definition.name, options);
  assertPositionals(definition.name, positionals);

  return {
    kind: 'command',
    name: definition.name,
    summary: definition.summary,
    description: definition.description,
    options,
    positionals,
    examples: definition.examples ?? [],
    run: (input, context) => definition.run(input as CommandInput<O, P>, context),
  };
}

export function defineGroup(definition: GroupDefinition): Group {
  assertName('group', definition.name);
  assertUniqueNames(definition.name, definition.commands);
  return {
    kind: 'group',
    name: definition.name,
    summary: definition.summary,
    description: definition.description,
    commands: definition.commands,
  };
}

export function defineCli(definition: CliDefinition): Cli {
  assertUniqueNames(definition.name, definition.commands);
  if (definition.commands.some((node) => node.name === 'help')) {
    throw new Error('"help" is reserved for the built-in help command.');
  }
  return {
    kind: 'cli',
    name: definition.name,
    version: definition.version,
    summary: definition.summary,
    description: definition.description,
    commands: definition.commands,
  };
}
