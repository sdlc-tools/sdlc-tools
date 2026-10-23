# @sdlc-tools/core

[English](./README.md) | 한국어

모든 sdlc-tools CLI 가 공유하는 기반입니다. 운영체제 키체인의 자격 증명, PKCE 를 쓰는 OAuth 2.0 로그인, 오류와 종료 코드 모델, 실패를 설명해 주는 HTTP 클라이언트, 그리고 사람과 AI 에이전트 모두에게 하나의 출력 규약을 구현하는 커맨드 계층을 제공합니다.

라이브러리입니다. 이를 기반으로 만든 도구는 커맨드만 정의하면 아래 규약 전체를 얻습니다. 바깥 세계와 닿는 모든 것(환경, 표준 입력과 출력, `fetch`, 키체인, 시계)은 주입되므로, 네트워크도 키체인도 프로세스도 없이 도구를 테스트할 수 있습니다.

Node.js 22.13 이상이 필요합니다. ESM 전용입니다.

```sh
pnpm add @sdlc-tools/core
```

## 파일 하나로 만든 도구

```ts
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
```

실행 파일은 세 줄이므로 정의를 테스트에서 import 할 수 있습니다.

```ts
#!/usr/bin/env node
import { runMain } from '@sdlc-tools/core';
import { cli } from './cli.js';

await runMain(cli);
```

이 도구를 실행하면 다음과 같이 동작합니다.

```console
$ sdlc-example show 12
error: Missing server address.

Next steps:
  - Pass --host.
  - Set the SDLC_EXAMPLE_HOST environment variable.
  - Add "host" under "example" in <user config path>.
$ echo $?
2
```

위의 모든 실패는 요청을 보내기 전에 일어납니다. 먼저 인자를 파싱하고, 그다음 설정, 자격 증명을 확인한 뒤에야 네트워크로 갑니다.

## 규약

### 종료 코드

| 코드  | 의미                                                                    | 다음에 할 일                                             |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `0`   | 성공                                                                    |                                                          |
| `1`   | 예기치 못한 오류(도구의 버그)                                           | 보고하세요. `SDLC_DEBUG=1` 이면 스택 트레이스가 붙습니다 |
| `2`   | 사용법 또는 설정 오류. 서버로는 아무것도 보내지 않았습니다              | 커맨드 라인이나 설정을 고치세요                          |
| `3`   | 인증: 자격 증명이 없거나, 거부되었거나(401), 세션을 갱신하지 못했습니다 | 다시 로그인하세요                                        |
| `4`   | 권한 없음(403)                                                          | 접근 권한을 요청하세요                                   |
| `5`   | 찾을 수 없음(404)                                                       | 식별자와 서버를 확인하세요                               |
| `6`   | 서버가 실패했거나(5xx) 요청을 거부했습니다(그 밖의 4xx, 429)            | 나중에 다시 시도하거나 요청을 고치세요                   |
| `7`   | 서버에 닿지 못했거나 시간이 초과되었습니다                              | 네트워크와 주소를 확인하세요                             |
| `130` | 사용자가 취소했습니다(Ctrl-C)                                           |                                                          |

### 출력

- 결과는 **stdout** 으로, 그 밖의 것(진행 메시지, 오류, 잘못된 사용에 대한 도움말)은 **stderr** 로 나갑니다.
- 기본적으로 커맨드는 스스로 고른 짧은 텍스트를 출력합니다. `--json` 을 주면 전체 결과를 JSON 문서 하나로 출력합니다. stdout 이 터미널이 아니면 한 줄, 터미널이면 들여쓰기를 합니다.
- `--json` 에서는 오류도 stderr 에 JSON 으로 나가므로, 호출자가 두 스트림을 모두 파싱할 수 있습니다.

  ```json
  {
    "error": {
      "kind": "not-found",
      "exitCode": 5,
      "status": 404,
      "message": "...",
      "causes": ["..."],
      "next": ["..."]
    }
  }
  ```

  `kind` 는 `usage`, `config`, `auth`, `permission`, `not-found`, `server`, `network`, `cancelled`, `unexpected` 중 하나입니다. `code` 는 `no_credentials`, `refresh_failed` 처럼 안정적인 하위 유형이며, 있을 때만 나옵니다.

- 색상 코드는 출력하지 않습니다.

### 잘못된 사용

- `--help` 와 `-h` 는 모든 수준(`tool --help`, `tool group --help`, `tool group command --help`)에서 도움말을 stdout 에 출력하고 `0` 으로 끝납니다. `tool help group command` 도 같습니다.
- 알 수 없는 커맨드, 알 수 없는 플래그, 값이 없는 플래그, 허용 범위 밖의 값, 빠진 필수 인자나 옵션, 남는 인자는 사용법 오류입니다. 메시지, 해당 커맨드의 사용법, 오타 제안이 stderr 로 나가고 종료 코드는 `2` 입니다.
- 옵션은 커맨드 이름 뒤에 둡니다: `tool group command --flag`. 플래그는 그것을 선언한 커맨드에 속하므로, 다른 커맨드의 플래그는 알 수 없는 플래그입니다.
- `-` 로 시작하는 값은 `--flag=value` 로 써야 하며, `--` 는 옵션 파싱을 끝냅니다.

### 서버 오류

401, 403, 404 는 서버와 리소스의 이름, 원인 후보, 다음 행동을 담은 문장이 됩니다. 맥락은 호출자가 제공합니다. 리소스(`resource: 'pull request #12'`)와 401 일 때 할 일(`context.reauth`)입니다. 404 는 일부 서버가 계정이 볼 수 없는 리소스에도 404 로 답한다는 점을 언급합니다. 전송 실패는 원인(거부됨, 찾을 수 없음, 시간 초과)을 밝히고, 신뢰할 수 없는 인증서라면 `NODE_EXTRA_CA_CERTS` 를 안내합니다.

오류에는 요청 헤더, 토큰, 쿼리 문자열이 들어가지 않습니다.

## 커맨드

`defineCommand`, `defineGroup`, `defineCli` 로 트리를 한 번만 선언하면 파싱, 검증, 도움말이 모두 그 선언에서 나옵니다.

- 옵션 키는 camelCase 이고 플래그로는 kebab-case 로 나타납니다(`dryRun` 은 `--dry-run`). 옵션 타입은 `string`(선택적으로 `multiple`, `choices`, `default`, `required`, `short`)과 `boolean` 입니다. 핸들러는 타입이 붙은 값을 받습니다. choices 는 유니온으로 좁혀지고, `multiple` 은 배열이며, `required` 와 `default` 는 `undefined` 가 되지 않습니다.
- 위치 인자도 이름과 타입이 같은 방식으로 붙고, `required` 나 `variadic` 일 수 있습니다.
- `--json` 과 `--help` 는 모든 커맨드에서 쓸 수 있으며 다시 선언할 수 없습니다.
- 핸들러는 `{ data, text }` 를 반환합니다. `data` 는 전체 결과이고 `text` 는 짧은 표현입니다(`text` 가 비어 있으면 아무것도 출력하지 않습니다).
- `context.log(message)` 는 진단 한 줄을 stderr 로 씁니다. `context.json` 은 `--json` 이 주어졌는지 알려 줍니다.
- 핸들러는 예상된 실패에 `CliError` 를 던집니다. 그 밖의 것은 종료 코드 `1` 이 됩니다.
- `runCli(cli, argv, runtime)` 은 CLI 를 메모리에서 실행하고 종료 코드로 resolve 합니다. `runMain(cli)` 는 실제 프로세스에 묶고 Ctrl-C 를 처리합니다.

## 설정

`resolveSettings(runtime, section, specs, flags)` 는 각 설정을 다음 순서로 해석합니다.

1. 플래그,
2. 환경 변수,
3. 프로젝트 파일: 작업 디렉터리에서 저장소 루트 사이에서 가장 가까운 `.sdlc-tools.json`,
4. 사용자 파일: `$XDG_CONFIG_HOME/sdlc-tools/config.json`(기본 `~/.config/sdlc-tools/config.json`, Windows 는 `%APPDATA%\sdlc-tools\config.json`),
5. 설정이 선언한 기본값.

파일은 도구마다 섹션 하나를 가진 JSON 객체이며, 값은 문자열입니다.

```json
{ "forgejo": { "host": "https://git.example.com" }, "jira": { "project": "ABC" } }
```

- 필수 설정이 없으면 종료 코드 `2` 로 실패하고, 그 값을 줄 수 있는 플래그, 환경 변수, 파일 키를 모두 알려 줍니다.
- 파일은 설정이 플래그나 환경 변수로 이미 주어지지 않았을 때만 읽습니다.
- **파일에는 자격 증명을 넣지 않습니다.** `token`, `secret`, `password`, `passwd`, `apikey`, `credential(s)` 로 끝나는 키가 있으면 도구는 그 파일을 읽지 않으며, 오류 메시지는 값을 반복하지 않습니다. 자격 증명은 키체인이나 환경 변수에 둡니다.
- 설정은 `fromProjectFile: false` 로 프로젝트 파일을 거부할 수 있습니다. 서버 주소처럼 자격 증명이 어디로 가는지를 정하는 설정에 쓰세요.
- 도구는 서버 주소, 프로젝트 키, 필드 id 를 스스로 갖지 않습니다. 이 저장소의 ESLint 규칙이 이를 강제합니다.

`normalizeServerUrl` 은 서버 주소를 검증합니다. https 가 필수이고(평문 http 는 `localhost`, `127.0.0.1`, `[::1]` 만), 주소에 들어 있는 사용자 이름과 비밀번호는 거부하며, 경로 접두사는 유지합니다. `urlPath` 는 태그드 템플릿으로, 각 값을 경로 세그먼트 하나로 퍼센트 인코딩하고 `.`, `..`, 빈 세그먼트를 거부합니다.

## 자격 증명

자격 증명은 운영체제 자격 증명 저장소에 보관합니다. macOS 키체인, Windows 자격 증명 관리자, Linux 에서는 Secret Service API 이며 실행 중인 서비스가 없으면 커널 키링으로 대체합니다. 네이티브 바인딩(`@napi-rs/keyring`, 사전 빌드, 설치 스크립트 없음)은 처음 쓸 때 로드되므로, 자격 증명을 건드리지 않는 커맨드는 이를 로드하지 않습니다.

- 항목은 서비스 `sdlc-tools` 와 계정 `<tool>:<origin>` 으로 저장되고, 기본이 아닌 프로필이면 `#<profile>` 이 붙습니다. origin 이 키에 들어 있으므로 자격 증명은 그것을 발급한 서버에만 제시됩니다.
- 키체인 항목 하나보다 긴 비밀은 여러 항목으로 나눠 저장하므로, OAuth 토큰 쌍도 Windows 자격 증명 관리자의 크기 제한에 들어갑니다.
- 키체인이 없는 CI, 컨테이너, SSH 세션에서는 도구가 환경 변수로 토큰을 받을 수 있습니다(`resolveCredential` 의 `tokenEnv`). 환경 변수가 키체인보다 우선하며 어디에도 기록되지 않습니다. `toolEnvVar('forgejo', 'token')` 은 관례적인 이름 `SDLC_FORGEJO_TOKEN` 을 줍니다.
- 자격 증명이 없으면 `resolveCredential` 은 요청 전에 종료 코드 `3` 으로 실패합니다. 키체인 자체를 쓸 수 없으면 오류가 이유를 말하고 환경 변수를 제안합니다.
- `bearerAuth` 와 `basicAuth` 는 `Authorization` 헤더를 만들며, 도구는 서버가 기대하는 방식을 고릅니다.

## 비밀값과 표준 입력

`runtime.stdin` 은 커맨드가 보는 표준 입력입니다. `isTTY` 는 터미널과 파이프, 파일, 입력 없음을 구분하고, `readAll()` 은 입력이 끝날 때까지의 모든 내용을 UTF-8 텍스트로 돌려주며, `readHidden(prompt)` 는 프롬프트를 stderr 에 쓴 뒤 터미널에서 입력한 한 줄을 화면에 보이지 않게 읽습니다. 커맨드가 요청하기 전에는 스트림에 손대지 않으므로 입력을 읽지 않는 커맨드는 기다리지 않고, Ctrl-C 를 누르면 파이프에서 기다리는 읽기가 끝납니다. 라이브러리 코드는 `runtime.stdin` 을 쓰고 `process.stdin` 이나 파일 디스크립터 0 을 직접 쓰지 않습니다.

`readSecret(runtime, { label })` 은 커맨드가 사용자에게서 토큰을 받는 방법입니다. 표준 입력이 터미널이면 입력을 보이지 않게 프롬프트로 받고, 아니면 파이프나 파일에서 읽습니다. 앞뒤 공백(`echo` 가 붙이는 줄바꿈)을 지우고, 아무것도 주어지지 않았거나 입력이 한 단어가 아니면 요청을 보내기 전에 종료 코드 `2` 로 실패합니다. 오류는 무엇이 빠졌는지만 알리고 입력은 되풀이하지 않습니다.

언제 읽을지는 커맨드가 정합니다. `sdlc-jira auth login` 은 `--with-token` 이 요청할 때만 표준 입력에서 토큰을 읽고, 아니면 환경 변수에서, 터미널이라면 프롬프트에서 받습니다. 그래서 입력이 끝나지 않는 호출자가 대기하는 일이 없습니다.

## OAuth 2.0 로그인

`loginWithPkce` 는 `S256` 방식의 PKCE([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636))와 루프백 리디렉션([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252))을 쓰는 authorization code grant 를 구현합니다.

1. 빈 포트(서버가 정확히 등록된 리디렉션 주소를 요구하면 지정한 포트)의 `127.0.0.1` 에서 대기하고, 인가 주소를 stderr 에 출력한 뒤 브라우저를 열어 봅니다.
2. 콜백 하나를 받습니다. `state` 가 없거나 틀린 요청, 다른 경로, 다른 메서드, 다른 `Host` 헤더는 거부하고 무시하므로, 엉뚱하거나 위조된 요청이 로그인을 완료하거나 중단시킬 수 없습니다.
3. 코드를 PKCE verifier 와 함께 교환하고, 결과가 성공, 거부, 시간 초과(기본 5분), 취소 중 무엇이든 대기를 멈춥니다.

`OAuthSession` 은 저장된 OAuth 자격 증명을 위한 `AuthProvider` 입니다. 만료 1분 전에, 그리고 서버가 401 로 답했을 때 한 번 더 액세스 토큰을 갱신하고, 회전된 토큰을 자격 증명 저장소에 다시 쓰며, 프로세스 안에서는 한 번에 하나씩만 갱신합니다. 다른 프로세스가 이미 리프레시 토큰을 회전시켰다면 실패하지 않고 그 프로세스의 자격 증명을 채택합니다. 갱신할 수 없는 세션은 종료 코드 `3` 으로 실패하며 다시 로그인하라고 안내합니다.

엔드포인트, 클라이언트 id, 스코프, 콜백 포트는 언제나 매개변수입니다.

## HTTP 클라이언트

`HttpClient` 는 주입된 `fetch` 를 감쌉니다. 기본 URL(경로 접두사 유지), JSON 과 form 본문, 쿼리 매개변수, 30초 기본 타임아웃, 취소, `AuthProvider`, 위의 오류 번역을 제공합니다. 모든 2xx 는 성공입니다. 요청은 재시도하지 않으며, 인증 제공자가 자격 증명을 갱신할 수 있을 때 401 뒤에 한 번만 예외입니다.

## 도구 테스트하기

`@sdlc-tools/core/testing` 은 네트워크, 키체인, 프로세스 없이 도구가 스스로를 테스트하는 데 필요한 것을 제공합니다.

| 내보내기                                         | 용도                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `execute(cli, argv, ...)`                        | CLI 를 메모리에서 실행하고 종료 코드, stdout, stderr, 발생한 네트워크 호출, 저장소를 돌려줍니다.           |
| `mockFetch`, `forbidFetch`                       | 호출을 기록하는 `fetch`. `forbidFetch` 는 어떤 호출에도 실패해서, 커맨드가 로컬에서 실패했음을 증명합니다. |
| `jsonResponse`, `textResponse`, `networkFailure` | 응답과 전송 실패를 만드는 빌더.                                                                            |
| `MemorySecretStore`                              | 메모리 안의 자격 증명 저장소.                                                                              |
| `FakeAuthorizationServer`                        | PKCE 검증, 일회용 코드, 리프레시 토큰 회전을 강제하는 OAuth 서버와, 로그인을 승인하는 브라우저.            |

`execute` 는 기본으로 `forbidFetch` 를 쓰므로, 테스트는 네트워크 트래픽이 있을 것이라고 직접 말해야 합니다. 표준 입력은 `stdin` 옵션이 달리 말하지 않는 한 비어 있고 터미널이 아닙니다. 문자열은 파이프로 들어온 입력이고, `{ typed: '…' }` 는 표준 입력을 터미널로 만들어 사용자가 그 한 줄을 숨김 프롬프트에 입력하게 합니다. 실제 터미널처럼 프롬프트는 stderr 에 나타나고 입력한 줄은 어디에도 나타나지 않습니다.

## 보안 참고

- 프로젝트 파일이 서버를 정합니다. 직접 작성하지 않은 저장소가 도구를 다른 서버로 향하게 하는 `.sdlc-tools.json` 을 담고 있을 수 있습니다. 키체인 자격 증명은 발급받은 서버에 묶여 있어 그 서버에는 제시되지 않지만, 환경 변수로 준 토큰은 설정된 서버가 어디든 그곳으로 전송됩니다. 도구는 서버 주소에 `fromProjectFile: false` 를 설정해야 하며, 신뢰하지 않는 체크아웃에서 도구를 실행하기 전에 저장소의 `.sdlc-tools.json` 을 살펴봐야 합니다.
- 루프백 리스너는 `127.0.0.1` 에만 바인딩하고, `state` 와 `Host` 를 검증하며, 요청 내용을 되돌려 주지 않는 정적 페이지만 응답하고, `Referrer-Policy: no-referrer` 를 설정하며, 로그인이 끝나는 즉시 닫힙니다.
- 루프백 호스트를 제외한 모든 서버 주소에서 평문 http 는 거부됩니다.
- 터미널에 출력되는 OAuth 인가 주소에는 `state` 와 PKCE challenge 가 들어 있지만 이는 비밀이 아닙니다. verifier, 코드, 토큰은 출력되거나 오류에 포함되지 않습니다.
