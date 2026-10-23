/** Facts shared by both languages: names, commands and where things live. */

export const REPOSITORY_URL = 'https://github.com/sdlc-tools/sdlc-tools';
export const NPM_ORG_URL = 'https://www.npmjs.com/org/sdlc-tools';
/** Where the site is served; used for the language alternates only. */
export const SITE_URL = 'https://sdlc-tools.github.io/sdlc-tools/';

export const packageIds = ['core', 'forgejo', 'jira'] as const;
export type PackageId = (typeof packageIds)[number];

export interface PackageFacts {
  readonly name: string;
  /** The executable a tool installs; the library has none. */
  readonly command: string | null;
  readonly install: string;
}

export const packageFacts: Readonly<Record<PackageId, PackageFacts>> = {
  core: { name: '@sdlc-tools/core', command: null, install: 'pnpm add @sdlc-tools/core' },
  forgejo: {
    name: '@sdlc-tools/forgejo',
    command: 'sdlc-forgejo',
    install: 'npm install --global @sdlc-tools/forgejo',
  },
  jira: {
    name: '@sdlc-tools/jira',
    command: 'sdlc-jira',
    install: 'npm install --global @sdlc-tools/jira',
  },
};

export type Lang = 'en' | 'ko';

export const npmUrl = (id: PackageId): string =>
  `https://www.npmjs.com/package/${packageFacts[id].name}`;

/** Each language links to the README written in it. */
export const readmeUrl = (lang: Lang, id: PackageId): string =>
  lang === 'en'
    ? `${REPOSITORY_URL}/tree/main/packages/${id}#readme`
    : `${REPOSITORY_URL}/blob/main/packages/${id}/README.ko.md`;

export const specUrl = (lang: Lang): string =>
  lang === 'en'
    ? `${REPOSITORY_URL}/tree/main/packages/core#the-contract`
    : `${REPOSITORY_URL}/blob/main/packages/core/README.ko.md#규약`;
