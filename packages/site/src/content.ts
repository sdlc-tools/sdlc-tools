import type { Lang, PackageId } from './data.js';

/** A line in a terminal figure. Only commands are prefixed with a prompt. */
export interface CodeLine {
  readonly kind: 'command' | 'output' | 'comment';
  readonly text: string;
}

export interface Figure {
  readonly caption: string;
  readonly lines: readonly CodeLine[];
}

export interface Feature {
  readonly title: string;
  readonly text: string;
}

/**
 * Everything a page says. Both languages implement this one type, so a section
 * or an item present in one and missing in the other does not compile.
 */
export interface Content {
  readonly lang: Lang;
  readonly languageName: string;
  readonly title: string;
  readonly description: string;
  readonly skipLink: string;
  readonly nav: {
    readonly label: string;
    readonly contract: string;
    readonly packages: string;
    readonly examples: string;
    readonly source: string;
    readonly languageLabel: string;
  };
  readonly otherLanguage: { readonly lang: Lang; readonly name: string };
  readonly hero: {
    readonly heading: string;
    readonly lead: string;
    readonly start: string;
    readonly source: string;
    readonly install: Figure;
  };
  readonly contract: {
    readonly heading: string;
    readonly intro: string;
    readonly features: readonly [Feature, Feature, Feature, Feature, Feature, Feature];
    readonly spec: string;
  };
  readonly packages: {
    readonly heading: string;
    readonly intro: string;
    readonly summaries: Readonly<Record<PackageId, string>>;
    readonly kind: { readonly library: string; readonly tool: string };
    readonly readme: string;
    readonly npm: string;
  };
  readonly examples: {
    readonly heading: string;
    readonly intro: string;
    readonly people: Figure & { readonly text: string };
    readonly agents: Figure & { readonly text: string };
  };
  readonly footer: {
    readonly license: string;
    readonly privacy: string;
    readonly npmOrg: string;
    readonly issues: string;
  };
}

export const en: Content = {
  lang: 'en',
  languageName: 'English',
  title: 'sdlc-tools: CLIs for people and AI agents',
  description:
    'Command-line tools for the development lifecycle, designed to be used by humans and AI agents alike: short output, --json, local failure, distinct exit codes, translated errors and keychain credentials.',
  skipLink: 'Skip to content',
  nav: {
    label: 'Main',
    contract: 'Contract',
    packages: 'Packages',
    examples: 'Examples',
    source: 'GitHub',
    languageLabel: 'Language',
  },
  otherLanguage: { lang: 'ko', name: '한국어' },
  hero: {
    heading: 'Lifecycle CLIs for people and AI agents',
    lead: 'sdlc-tools is a family of command-line tools for the development lifecycle: Jira issues, Forgejo pull requests and the foundation they share. A person and an agent get the same short answers, the same errors and the same exit codes from the same command.',
    start: 'Choose a tool',
    source: 'View on GitHub',
    install: {
      caption: 'Install the tools you need',
      lines: [
        { kind: 'command', text: 'npm install --global @sdlc-tools/jira' },
        { kind: 'command', text: 'npm install --global @sdlc-tools/forgejo' },
        { kind: 'comment', text: '# Node.js 22.13 or newer' },
      ],
    },
  },
  contract: {
    heading: 'One contract, every tool',
    intro:
      'A person at a terminal and an agent driving a shell need the same things from a CLI. Every tool here follows one specification, so what you learn from one carries over to the next.',
    features: [
      {
        title: 'Short by default',
        text: 'A few lines meant to be read. Add --json and the complete result arrives as a single JSON document on stdout.',
      },
      {
        title: 'Fails locally first',
        text: 'A missing argument, setting or credential is reported before any request is sent. A wrong flag prints the usage of that command.',
      },
      {
        title: 'Exit codes that mean something',
        text: '0 success, 2 usage, 3 authentication, 4 permission, 5 not found, 6 server, 7 network. A script branches without parsing text.',
      },
      {
        title: 'Errors that help',
        text: 'A 401, 403 or 404 becomes a sentence with likely causes and next steps. Under --json the error is JSON on stderr too.',
      },
      {
        title: 'Credentials in the keychain',
        text: 'Tokens live in the macOS Keychain, Windows Credential Manager or Linux Secret Service, bound to the server that issued them, never in a configuration file.',
      },
      {
        title: 'No built-in addresses',
        text: 'Hosts, project keys and field ids come from flags, environment variables or configuration, so the same tool fits any site.',
      },
    ],
    spec: 'Read the specification',
  },
  packages: {
    heading: 'Packages',
    intro:
      'Each tool is its own npm package, versioned independently, and depends only on the shared core.',
    summaries: {
      core: 'The foundation: keychain credentials, OAuth 2.0 PKCE sign-in, the error and exit-code model, an HTTP client that explains failures, and the output contract. Build your own tool on it.',
      forgejo:
        'Pull requests on Forgejo and Gitea. Sign in with OAuth or a token, open and review pull requests, merge under a policy of statuses, approvals and merge method, and clean up branches.',
      jira: 'Jira Cloud from the terminal. Search, view, create, edit, transition, assign and comment on issues, and log work, with an API token in the keychain.',
    },
    kind: { library: 'Library', tool: 'Command' },
    readme: 'README',
    npm: 'npm',
  },
  examples: {
    heading: 'See it work',
    intro: 'The same command serves both readers.',
    people: {
      caption: 'A person at a terminal',
      lines: [
        { kind: 'command', text: 'sdlc-jira issue list --assignee me --status "In Progress"' },
        { kind: 'output', text: 'ABC-1  In Progress  Ada Lovelace  Fix the login page' },
        { kind: 'output', text: '' },
        { kind: 'output', text: '1 issue' },
        { kind: 'command', text: 'sdlc-jira issue transition ABC-1 --to "In Review"' },
        { kind: 'output', text: 'ABC-1: In Progress -> In Review' },
      ],
      text: 'Short answers in aligned columns, one line per result, nothing to scroll past.',
    },
    agents: {
      caption: 'An agent in a shell',
      lines: [
        { kind: 'command', text: 'sdlc-jira issue view ABC-404 --json' },
        {
          kind: 'comment',
          text: '# stderr: {"error":{"kind":"not-found","exitCode":5,"status":404, ...}}',
        },
        { kind: 'command', text: 'echo $?' },
        { kind: 'output', text: '5' },
      ],
      text: 'The result or the error is one JSON document, and the exit code says what kind of failure it was. The agent branches on both and never scrapes text.',
    },
  },
  footer: {
    license: 'MIT licensed',
    privacy: 'This site sets no cookies and loads no scripts, fonts or trackers.',
    npmOrg: 'npm',
    issues: 'Issues',
  },
};

export const ko: Content = {
  lang: 'ko',
  languageName: '한국어',
  title: 'sdlc-tools: 사람과 AI 에이전트를 위한 CLI',
  description:
    '사람과 AI 에이전트가 함께 쓰도록 설계된 개발 생명주기 커맨드라인 도구: 기본은 짧은 출력, --json, 로컬 우선 실패, 의미 있는 종료 코드, 번역된 오류, 키체인 자격 증명.',
  skipLink: '본문으로 건너뛰기',
  nav: {
    label: '주요 메뉴',
    contract: '규약',
    packages: '패키지',
    examples: '예시',
    source: 'GitHub',
    languageLabel: '언어',
  },
  otherLanguage: { lang: 'en', name: 'English' },
  hero: {
    heading: '사람과 AI 에이전트가 함께 쓰는 개발 생명주기 CLI',
    lead: 'sdlc-tools 는 개발 생명주기를 위한 커맨드라인 도구 모음입니다. Jira 이슈, Forgejo 풀 리퀘스트, 그리고 둘이 공유하는 기반을 다룹니다. 같은 커맨드에서 사람과 에이전트가 같은 짧은 답, 같은 오류, 같은 종료 코드를 받습니다.',
    start: '도구 고르기',
    source: 'GitHub 에서 보기',
    install: {
      caption: '필요한 도구를 설치하세요',
      lines: [
        { kind: 'command', text: 'npm install --global @sdlc-tools/jira' },
        { kind: 'command', text: 'npm install --global @sdlc-tools/forgejo' },
        { kind: 'comment', text: '# Node.js 22.13 이상' },
      ],
    },
  },
  contract: {
    heading: '하나의 규약, 모든 도구',
    intro:
      '터미널 앞의 사람과 셸을 다루는 에이전트는 CLI 에 같은 것을 바랍니다. 여기 있는 모든 도구는 하나의 명세를 따르므로, 한 도구에서 익힌 것이 다음 도구에도 그대로 이어집니다.',
    features: [
      {
        title: '기본은 짧게',
        text: '읽기 위한 몇 줄. --json 을 주면 전체 결과가 stdout 에 JSON 문서 하나로 나옵니다.',
      },
      {
        title: '로컬에서 먼저 실패',
        text: '빠진 인자, 설정, 자격 증명은 요청을 보내기 전에 알려 줍니다. 틀린 플래그에는 해당 커맨드의 사용법을 출력합니다.',
      },
      {
        title: '의미 있는 종료 코드',
        text: '0 성공, 2 사용법, 3 인증, 4 권한, 5 없음, 6 서버, 7 네트워크. 스크립트는 텍스트를 파싱하지 않고 분기합니다.',
      },
      {
        title: '도움이 되는 오류',
        text: '401, 403, 404 는 원인 후보와 다음 행동이 담긴 문장이 됩니다. --json 에서는 stderr 의 오류도 JSON 입니다.',
      },
      {
        title: '키체인에 자격 증명',
        text: '토큰은 macOS 키체인, Windows 자격 증명 관리자, Linux Secret Service 에 발급한 서버에 묶어 저장하며, 설정 파일에는 두지 않습니다.',
      },
      {
        title: '내장 주소 없음',
        text: '호스트, 프로젝트 키, 필드 id 는 플래그, 환경 변수, 설정에서 받으므로 같은 도구를 어느 사이트에나 쓸 수 있습니다.',
      },
    ],
    spec: '명세 읽기',
  },
  packages: {
    heading: '패키지',
    intro: '각 도구는 독립된 npm 패키지로 버전을 따로 관리하며, 공유 core 에만 의존합니다.',
    summaries: {
      core: '도구들의 기반: 키체인 자격 증명, OAuth 2.0 PKCE 로그인, 오류·종료 코드 모델, 실패를 설명하는 HTTP 클라이언트, 출력 규약. 이 위에 직접 도구를 만들 수 있습니다.',
      forgejo:
        'Forgejo·Gitea 풀 리퀘스트. OAuth 또는 토큰으로 로그인하고, 풀 리퀘스트를 열고 리뷰하며, 상태·승인·머지 방식의 정책에 따라 머지하고, 브랜치를 정리합니다.',
      jira: '터미널에서 쓰는 Jira Cloud. 이슈 검색·조회·생성·수정·전환·담당자 지정·코멘트와 작업 시간 기록을 API 토큰을 키체인에 두고 처리합니다.',
    },
    kind: { library: '라이브러리', tool: '커맨드' },
    readme: 'README',
    npm: 'npm',
  },
  examples: {
    heading: '이렇게 동작합니다',
    intro: '같은 커맨드가 두 독자를 모두 만족시킵니다.',
    people: {
      caption: '터미널 앞의 사람',
      lines: [
        { kind: 'command', text: 'sdlc-jira issue list --assignee me --status "In Progress"' },
        { kind: 'output', text: 'ABC-1  In Progress  Ada Lovelace  Fix the login page' },
        { kind: 'output', text: '' },
        { kind: 'output', text: '1 issue' },
        { kind: 'command', text: 'sdlc-jira issue transition ABC-1 --to "In Review"' },
        { kind: 'output', text: 'ABC-1: In Progress -> In Review' },
      ],
      text: '정렬된 열에 결과당 한 줄, 넘겨 볼 것이 없는 짧은 답입니다.',
    },
    agents: {
      caption: '셸 안의 에이전트',
      lines: [
        { kind: 'command', text: 'sdlc-jira issue view ABC-404 --json' },
        {
          kind: 'comment',
          text: '# stderr: {"error":{"kind":"not-found","exitCode":5,"status":404, ...}}',
        },
        { kind: 'command', text: 'echo $?' },
        { kind: 'output', text: '5' },
      ],
      text: '결과도 오류도 JSON 문서 하나이고, 종료 코드는 어떤 종류의 실패인지 알려 줍니다. 에이전트는 둘로 분기하며 텍스트를 긁어 오지 않습니다.',
    },
  },
  footer: {
    license: 'MIT 라이선스',
    privacy: '이 사이트는 쿠키를 설정하지 않으며 스크립트, 글꼴, 추적기를 불러오지 않습니다.',
    npmOrg: 'npm',
    issues: '이슈',
  },
};
