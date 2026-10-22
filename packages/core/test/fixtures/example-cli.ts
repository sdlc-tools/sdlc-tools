import {
  HttpClient,
  bearerAuth,
  defineCli,
  defineCommand,
  normalizeServerUrl,
  resolveCredential,
  resolveSettings,
  urlPath,
} from '@sdlc-tools/core';

const show = defineCommand({
  name: 'show',
  summary: 'Show one item',
  positionals: [{ name: 'id', description: 'Item id', required: true }],
  options: { host: { type: 'string', valueName: 'url', description: 'Server address' } },
  async run({ options, args }, context) {
    const { values } = await resolveSettings(
      context,
      'example',
      {
        host: {
          label: 'server address',
          key: 'host',
          env: 'SDLC_EXAMPLE_HOST',
          flag: '--host',
          required: true,
          fromProjectFile: false,
          validate: (value) => normalizeServerUrl(value).baseUrl,
        },
      },
      { host: options.host },
    );
    const server = normalizeServerUrl(values.host);

    const { credential } = await resolveCredential(context, {
      tool: 'example',
      origin: server.origin,
      tokenEnv: 'SDLC_EXAMPLE_TOKEN',
      loginCommand: 'sdlc-example auth login',
    });

    const http = new HttpClient({
      baseUrl: server.baseUrl,
      fetch: context.fetch,
      signal: context.signal,
      auth: bearerAuth(credential.kind === 'token' ? credential.token : credential.accessToken),
      context: { reauth: ['Sign in with `sdlc-example auth login`.'] },
    });
    const { data } = await http.get<{ title: string }>(urlPath`/api/items/${args.id}`, {
      resource: `item ${args.id}`,
    });
    return { data, text: data.title };
  },
});

export const cli = defineCli({
  name: 'sdlc-example',
  version: '1.0.0',
  summary: 'Example CLI',
  commands: [show],
});
