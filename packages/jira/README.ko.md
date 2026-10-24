# @sdlc-tools/jira

[English](./README.md) | 한국어

사람과 AI 에이전트가 함께 쓰도록 설계된 Jira Cloud 커맨드라인 클라이언트입니다. 이슈를 검색, 조회, 생성, 수정, 전환, 담당자 지정, 링크하고 코멘트와 작업 시간을 기록합니다. 브라우저에서 OAuth 2.0(3LO)으로 로그인하거나 Atlassian API 토큰으로 로그인하며, 자격 증명은 운영체제 키체인에 보관합니다.

모든 커맨드는 기본적으로 짧게 답하고, `--json` 을 주면 전체 결과를 JSON 문서 하나로 출력합니다. 사이트, 자격 증명, 인자가 빠져 있으면 요청을 보내기 전에 알려 주고, 틀린 플래그에는 해당 커맨드의 사용법을 출력하며, 종료 코드는 스크립트가 다음에 할 일을 알려 줍니다. 공유 동작의 명세는 [`@sdlc-tools/core`](../core/README.ko.md#규약) 에 있습니다.

Node.js 22.13 이상이 필요합니다. Jira Cloud 전용입니다(REST API v3).

```sh
npm install --global @sdlc-tools/jira   # `sdlc-jira` 커맨드가 설치됩니다
```

## 로그인

로그인 방법은 두 가지입니다. 둘 다 macOS 키체인, Windows 자격 증명 관리자, Linux Secret Service 에 저장되고, 모든 커맨드에서 쓸 수 있습니다.

|              | OAuth 2.0(3LO)                                                                     | API 토큰                                                          |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 로그인       | 브라우저에서 Atlassian 계정으로                                                    | Atlassian 계정에서 토큰을 만들어 입력                             |
| 준비         | Atlassian 개발자 콘솔의 OAuth 앱, 그리고 설정 두 개                                | 없음                                                              |
| 접근 범위    | 앱의 Jira 스코프와 허용한 사이트로 제한, 앱 단위로 철회                            | 만료되거나 철회할 때까지 내 계정 권한 그대로                      |
| 갱신         | 자동. 90일 동안 쓰지 않으면 다시 로그인                                            | 없음. 만료되면 새 토큰 발급                                       |
| 필요한 것    | 커맨드를 실행하는 머신의 브라우저와 키체인                                         | 없음. `SDLC_JIRA_TOKEN` 은 키체인 없이도 동작                     |
| 이럴 때 선택 | 내 워크스테이션에서, 셸에 오래 가는 토큰을 두지 않고 철회할 수 있는 접근을 원할 때 | CI, 컨테이너, SSH 세션, 스크립트, 또는 OAuth 앱을 만들 수 없을 때 |

### API 토큰

Atlassian 계정에서 API 토큰을 만든 뒤(Security, API tokens) 로그인합니다. 터미널에서는 커맨드가 토큰을 물어보며, 입력하는 내용은 화면에 보이지 않습니다.

```sh
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

스크립트나 AI 에이전트에서는 `--with-token` 으로 토큰을 파이프로 넘기세요.

```sh
<토큰을 출력하는 커맨드> | sdlc-jira auth login --site your-team.atlassian.net --email you@example.com --with-token
```

토큰을 화면에 에코하지 않고 환경 변수에 넣어도 됩니다.

```sh
read -rs SDLC_JIRA_TOKEN && export SDLC_JIRA_TOKEN
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

토큰은 다음 순서로 찾습니다. `--with-token`(표준 입력이며, 표준 입력이 터미널이면 프롬프트), `SDLC_JIRA_TOKEN` 변수, 터미널이라면 프롬프트입니다. 표준 입력은 `--with-token` 을 줄 때만 읽습니다. 입력이 비었거나 한 단어가 아니면 요청을 보내기 전에 실패합니다.

`auth login` 은 먼저 사이트에서 토큰을 확인한 뒤, 이메일 주소와 함께 키체인에 저장합니다. 토큰은 커맨드 라인, 셸 히스토리, 출력(`--json` 포함), 오류 메시지 어디에도 나타나지 않습니다. 자격 증명은 사이트별로 저장되어, 토큰은 발급받은 사이트에만 제시됩니다. 한 사이트에서 계정을 여럿 쓰려면 `--profile <name>` 을 사용하세요.

키체인이 없는 CI, 컨테이너, SSH 세션에서는 `SDLC_JIRA_EMAIL` 과 `SDLC_JIRA_TOKEN` 을 설정하세요. 이 값이 키체인보다 우선하며 어디에도 기록되지 않습니다.

### OAuth 2.0(3LO)

Atlassian 은 커맨드라인 도구가 혼자서 로그인하도록 허용하지 않습니다. OAuth 앱에는 반드시 client secret 이 있고, 토큰 교환에 그 secret 이 필요하기 때문입니다. 그래서 비공개 앱을 직접 한 번 만들고, `sdlc-jira` 가 그 앱으로 동작하며 client secret 을 키체인에만 보관합니다.

**1. 앱 만들기** — [Atlassian 개발자 콘솔](https://developer.atlassian.com/console/myapps/)에서:

1. Create, 그리고 **OAuth 2.0 integration**. 이름을 정하고 **Resource-level grant** 를 고르면, 동의가 선택한 사이트로 제한됩니다.
2. **Authorization**, 그리고 OAuth 2.0 (3LO) 옆의 **Configure**: callback URL 을 `http://127.0.0.1:8766/callback` 으로 입력하고 저장합니다. 포트는 비어 있는 아무 것이나 고르세요. Atlassian 은 여기에 등록한 URL 로만, 글자 하나 다르지 않게 리디렉션하므로 `localhost` 가 아닌 `127.0.0.1`, 그 포트, 경로 `/callback` 이어야 합니다.
3. **Permissions**, 그리고 Jira API 옆의 **Add**: classic 스코프 `read:jira-work`, `write:jira-work`, `read:jira-user` 를 줍니다.
4. **Settings** 에 client id 와 client secret 이 있습니다. **Distribution** 은 건드리지 마세요. 공유를 켜기 전까지 앱은 비공개입니다.

**2. client id 와 포트 설정** — 첫 로그인에 필요하며 `~/.config/sdlc-tools/config.json` 에 넣습니다([설정](#설정) 참고). 다른 설정과 마찬가지로 포트도 문자열입니다.

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "clientId": "<client id>",
    "callbackPort": "8766"
  }
}
```

**3. 로그인.** 처음에는 터미널에서 커맨드가 client secret 을 물어보며, 입력하는 내용은 화면에 보이지 않습니다.

```sh
sdlc-jira auth login --oauth
```

파일 대신 `--client-id <id> --callback-port <port>` 를 주거나 `SDLC_JIRA_CLIENT_ID`, `SDLC_JIRA_CALLBACK_PORT` 를 설정해도 됩니다. client id 는 개발자 콘솔에서 앱의 **Settings** 에, 포트는 **Authorization** 의 callback URL 에 있습니다.

스크립트에서는 `--client-secret-stdin` 으로 secret 을 파이프로 넘기세요.

```sh
<secret 을 출력하는 커맨드> | sdlc-jira auth login --oauth --client-secret-stdin
```

앱 정보는 한 번만 주면 됩니다. 키체인이 client id, callback 포트, client secret 을 보관하므로, 이후 로그인(예: 리프레시 토큰이 만료된 뒤)은 플래그도 설정도 질문도 없이 `sdlc-jira auth login --oauth` 만으로 됩니다. 플래그, 환경 변수, 사용자 파일은 저장된 값보다 여전히 우선합니다. 이전 버전이 저장한 앱에는 포트가 없으므로, `--callback-port` 나 `callbackPort` 설정으로 한 번 주면 그것도 저장됩니다. 저장된 앱도 client id 도 없으면 아무것도 보내기 전에 실패합니다.

secret 을 다시 묻는 경우는 저장된 secret 이 없을 때, 플래그나 설정의 client id 가 다른 앱의 것일 때, 그리고 `--client-secret-stdin` 을 줄 때뿐이며, 이 플래그는 새 secret 을 기존 것 대신 저장합니다. 개발자 콘솔에서 secret 을 다시 발급한 뒤에 쓰세요. 저장된 secret 이 거부되면 오류가 그렇게 알려 줍니다.

브라우저에 Atlassian 동의 화면이 열리고, 거기서 사이트를 고르고 승인합니다. 이어서 커맨드는 허용한 사이트 가운데 설정한 사이트를 찾고(다른 사이트를 골랐다면 허용된 사이트를 알려 주고 아무것도 저장하지 않은 채 멈춥니다), API 로 로그인을 확인한 뒤, 토큰과 client secret, 사이트의 cloud id 를 키체인에 저장합니다.

- client secret 에는 플래그도 환경 변수도 없습니다. 키체인, 프롬프트, `--client-secret-stdin` 으로만 받습니다. 커맨드 라인, 출력(`--json` 포함), 오류 메시지, 설정 파일 어디에도 나타나지 않으며, `clientSecret` 이 들어 있는 설정 파일은 거부됩니다. 터미널이 아닐 때는 `--client-secret-stdin` 을 주지 않으면 표준 입력을 읽지 않습니다.
- 요청은 사이트 주소 대신 그 사이트의 cloud id 로 Atlassian API 게이트웨이를 거칩니다. 나머지 동작은 같고, 이슈 링크는 계속 내 사이트를 가리킵니다.
- 액세스 토큰은 한 시간 동안 유효합니다. 만료 직전에 갱신하고, Jira 가 401 로 답했을 때 한 번 더 갱신합니다. Atlassian 은 갱신할 때마다 리프레시 토큰을 바꾸며, 새 토큰은 키체인에 다시 기록됩니다. 다른 프로세스가 이미 갱신해 두었다면 그 프로세스의 토큰을 씁니다. 90일 동안 쓰지 않으면 리프레시 토큰이 만료되고, 커맨드가 다시 로그인하라고 알려 줍니다(종료 코드 `3`).
- `auth login --oauth` 는 이전 로그인을 대체합니다. API 토큰으로 로그인하면 OAuth 로그인이 대체되고 그 client secret 도 삭제됩니다. `auth logout` 은 둘 다 삭제합니다. `SDLC_JIRA_TOKEN` 이 설정되어 있으면 여전히 키체인보다 우선합니다.
- OAuth 로그인에는 같은 머신의 키체인과 브라우저가 필요하고, 승인하는 동안 callback 포트가 비어 있어야 합니다. 그렇지 않은 환경에서는 API 토큰을 쓰세요.

| 커맨드        | 용도                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth login`  | API 토큰을 확인하고 저장. `--oauth` 를 주면 브라우저로 로그인                                                                                      |
| `auth status` | 현재 자격 증명이 어느 계정의 것인지, 어떻게 로그인했는지(`oauth` 또는 `token`)와 어디서 왔는지, OAuth 는 client id 와 액세스 토큰의 만료 시각 표시 |
| `auth logout` | 사이트에 저장된 자격 증명 삭제. OAuth client secret 도 함께 삭제                                                                                   |

## 설정

사이트에 대한 정보는 도구에 내장되어 있지 않습니다. 각 설정은 다음 순서로 결정됩니다. 플래그, 환경 변수, 작업 디렉터리와 저장소 루트 사이에서 가장 가까운 `.sdlc-tools.json`, 그리고 `~/.config/sdlc-tools/config.json`(`$XDG_CONFIG_HOME` 을 따르며, Windows 는 `%APPDATA%\sdlc-tools\config.json`)입니다.

| 설정           | 플래그            | 환경 변수                 | 파일                       |
| -------------- | ----------------- | ------------------------- | -------------------------- |
| `site`         | `--site`          | `SDLC_JIRA_SITE`          | 사용자 파일만              |
| `project`      | `--project`       | `SDLC_JIRA_PROJECT`       | 프로젝트 파일, 사용자 파일 |
| `profile`      | `--profile`       | `SDLC_JIRA_PROFILE`       | 사용자 파일만              |
| `clientId`     | `--client-id`     | `SDLC_JIRA_CLIENT_ID`     | 사용자 파일만              |
| `callbackPort` | `--callback-port` | `SDLC_JIRA_CALLBACK_PORT` | 사용자 파일만              |
| `fields`       |                   |                           | 프로젝트 파일, 사용자 파일 |
| `workflow`     |                   |                           | 프로젝트 파일, 사용자 파일 |

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "project": "ABC",
    "fields": {
      "points": "customfield_10016",
      "started": { "id": "customfield_10020", "type": "datetime" },
      "begins": { "id": "customfield_10021", "type": "date" }
    },
    "workflow": ["To Do", "In Progress", "In Review", "Done"]
  }
}
```

- 사이트는 자격 증명이 전송되는 곳을, client id 와 callback 포트는 로그인을 받는 OAuth 앱을 정하므로, 저장소의 `.sdlc-tools.json` 은 이 중 어느 것도 설정할 수 없습니다.
- `clientId` 와 `callbackPort` 는 `auth login --oauth` 에서만 쓰이며 둘 다 필수입니다. 플래그, 환경 변수, 사용자 파일, 마지막으로 이전 로그인이 저장한 앱 순으로 찾으며, 하나라도 없으면 아무것도 보내기 전에 실패하고 어디에 설정하는지 알려 줍니다.
- 설정 파일에는 토큰, 비밀번호, client secret 을 넣을 수 없으며, 들어 있으면 파일을 거부합니다.
- `fields` 는 직접 정한 짧은 이름을 필드 id 에 연결합니다([커스텀 필드](#커스텀-필드) 참고).
- `workflow` 는 이슈가 거치는 순서대로 워크플로우의 상태를 나열합니다([상태까지 이동](#상태까지-이동) 참고).

## 이슈

```sh
sdlc-jira issue view ABC-123
sdlc-jira issue list --assignee me --status "In Progress"
sdlc-jira issue list --jql "project = ABC AND updated >= -7d ORDER BY updated DESC" --limit 50
sdlc-jira issue create --type Task --summary "Rotate the signing key" --label security --assignee me
sdlc-jira issue edit ABC-123 --summary "Better title" --due 2026-12-31 --add-label urgent
sdlc-jira issue transitions ABC-123
sdlc-jira issue transition ABC-123 "In Progress"
sdlc-jira issue transition ABC-123 --to Done
sdlc-jira issue link add ABC-123 Relates ABC-456
sdlc-jira issue assign ABC-123 ada@example.com
sdlc-jira issue comment add ABC-123 "Fixed in **build 42**"
sdlc-jira issue worklog add ABC-123 "1d 2h" --started 2026-03-02T09:00:00+09:00 --comment "Reviewed the migration"
```

| 커맨드                                 | 동작                                                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue view <key>`                     | 요약, 상태, 관련자, 연결된 이슈, `jira.fields` 에 설정한 필드, 설명, 최근 코멘트. `--json` 은 모든 필드를 돌려주고, 설정한 필드는 `aliases` 아래에 별칭으로 한 번 더 돌려줍니다.                                                   |
| `issue list`                           | `--jql` 로 검색하거나 `--project`, `--assignee`, `--status`, `--type`, `--label` 필터로 검색합니다. `--limit` 까지 페이지를 넘겨 가져옵니다.                                                                                       |
| `issue create`                         | `--type`, `--summary`, 프로젝트가 필요합니다. `--description`, `--description-file`, `--priority`, `--due`, `--estimate`, `--label`, `--parent`, `--assignee`, `--field` 도 쓸 수 있습니다.                                        |
| `issue edit <key>`                     | 넘긴 것만 바꿉니다. `--label` 은 교체, `--add-label` 과 `--remove-label` 은 조정, `--clear-due` 는 마감일 제거입니다.                                                                                                              |
| `issue transitions <key>`              | 지금 가능한 전환을 id 와 함께 보여 줍니다.                                                                                                                                                                                         |
| `issue transition <key> <target>`      | 전환 하나를 수행합니다. target 은 전환 id, 전환 이름, 또는 전환이 가리키는 상태 이름입니다. 여러 전환에 걸리는 이름은 실패하고 id 를 나열합니다. `--comment` 는 코멘트를 달고, `--field` 는 워크플로우가 요구하는 필드를 채웁니다. |
| `issue transition <key> --to <status>` | 여러 전환 너머에 있을 수 있는 상태까지 전환을 순서대로 수행합니다([상태까지 이동](#상태까지-이동) 참고).                                                                                                                           |
| `issue link add <key> <type> <target>` | 링크 유형 이름이나 문구와 방향으로 두 이슈를 연결합니다([이슈 링크](#이슈-링크) 참고).                                                                                                                                             |
| `issue link types`                     | 사이트의 링크 유형과 양쪽 문구.                                                                                                                                                                                                    |
| `issue assign <key> <who>`             | `who` 는 `me`, 지정 해제용 `none`, 계정 id, 또는 그 이슈에 지정 가능한 사용자 중에서 조회하는 이름이나 이메일입니다. 여러 명이 맞으면 추측하지 않고 후보를 나열하며 실패합니다.                                                    |
| `issue comment add <key> [body]`       | 인자 또는 `--body-file` 로 코멘트를 추가합니다.                                                                                                                                                                                    |
| `issue comment list <key>`             | 최근 코멘트를 오래된 순으로 보여 줍니다.                                                                                                                                                                                           |
| `issue worklog add <key> <time>`       | `30m`, `2h`, `1d 4h`(주, 일, 시간, 분) 같은 시간을 기록합니다. `--started` 는 UTC 오프셋이 있는 ISO 8601 시각을 받아 준 그대로 기록하므로 작업 시간대가 유지되며, `worklog list` 는 오프셋을 함께 보여 줍니다.                     |
| `issue worklog list <key>`             | 기록된 항목과 그 합계 시간.                                                                                                                                                                                                        |
| `field list`                           | 사이트의 필드를 id, 타입과 함께 보여 줍니다. `--search`, `--custom` 으로 좁힙니다.                                                                                                                                                 |

`issue create` 에는 프로젝트가 필요하고, `issue list` 는 `--jql` 도 `--assignee` 도 없으면 프로젝트가 필요합니다. 기본 프로젝트가 설정되어 있으면 필터 검색은 그 프로젝트로 제한되며, 여러 프로젝트를 검색하려면 `--jql` 을 쓰세요.

### 설명과 코멘트

설명, 코멘트, 작업 시간 메모, 리치 텍스트 커스텀 필드는 Markdown 으로 쓰고, Jira REST API 가 요구하는 Atlassian Document Format 으로 변환됩니다. 지원하는 것은 제목, 문단과 강제 줄바꿈, 중첩된 글머리 기호·번호 목록, 작업 목록(`- [ ]`, `- [x]`), 코드 블록, 인용문, 구분선, 표, 그리고 굵게·기울임·취소선·인라인 코드·링크입니다. `issue view` 는 ADF 를 같은 Markdown 부분집합으로 되돌려 보여 주며, 멘션, 이모지, 상태 라벨, 날짜, 패널, 첨부 파일은 읽을 수 있는 텍스트로 표시합니다.

### 커스텀 필드

필드 id 는 사이트마다 다르므로 `--field name=value` 는 아는 것을 무엇이든 받습니다.

1. 설정의 `jira.fields` 에 있는 별칭,
2. 필드 id(`customfield_10016`, `duedate`),
3. 사이트가 보여 주는 필드 이름(대소문자 무시). 사이트의 필드 목록으로 조회합니다.

`--field` 는 필드 타입에 맞게 값을 만듭니다. 숫자, 문자열, 날짜, 날짜·시각, 문자열 목록(`a, b`), 리치 텍스트를 지원합니다. 구조가 있는 값은 API 가 기대하는 JSON 을 `--field-json 'Reviewer={"accountId":"..."}'` 로 넘기세요. 두 필드에 걸리는 이름은 실패하고 둘 다 나열하며, 모르는 이름은 아무것도 쓰기 전에 실패하고 `sdlc-jira field list` 를 안내합니다.

별칭은 필드 id 이거나, id 와 값 타입(`string`, `number`, `date`, `datetime`, `richtext`, `list`)을 가진 객체입니다. 타입을 선언한 별칭은 사이트의 필드 목록을 조회하지 않고 값을 만들며, 값은 로컬에서 검사합니다.

- `date` 는 `YYYY-MM-DD` 를 받고 `2026-02-30` 같은 없는 날짜는 거부합니다.
- `datetime` 은 UTC 오프셋이 있는 ISO 8601(`2026-03-02T09:00:00+09:00`, 또는 `Z`)을 받아 Jira 가 저장하는 형태(`2026-03-02T09:00:00.000+0900`)로 보냅니다. 오프셋이 없는 시각은 결과가 실행 머신의 시간대에 좌우되므로 거부합니다.

```sh
sdlc-jira issue edit ABC-123 --field "started=2026-03-02T09:00:00+09:00" --field "begins=2026-03-02"
```

같은 별칭으로 필드를 읽습니다. `issue view` 는 값이 있는 설정 필드를 출력하고, `issue view --json` 은 모든 설정 필드를 `aliases` 아래에 돌려줍니다(비어 있으면 `null`). `issue list --fields points` 도 id 대신 별칭을 받습니다.

### 상태까지 이동

`issue transition <key> <target>` 은 전환 하나를 수행합니다. `issue transition <key> --to <status>` 는 필요한 만큼 이어서 수행합니다.

```sh
sdlc-jira issue transition ABC-123 --to Done --comment "Shipped" --field-json 'resolution={"name":"Done"}'
```

Jira 는 현재 상태에서 열려 있는 전환만 알려 주므로, 경로는 워크플로우의 상태를 순서대로 적은 `jira.workflow` 에서 나옵니다. 현재 상태에서 목표를 지나치지 않는 가장 가까운 앞쪽 상태로 가는 전환을 수행하고, 상태를 다시 읽고, 이슈가 목표에 닿을 때까지 반복합니다. 워크플로우가 전환을 제공하지 않는 상태는 건너뜁니다. `--comment` 와 `--field` 는 마지막 전환과 함께 가며, 필드 값은 첫 전환 전에 검사합니다.

- 이미 목표 상태: 아무것도 바꾸지 않습니다.
- 순서 설정이 없음: 목표로 바로 가는 전환만 수행합니다.
- 앞으로 갈 길이 없거나 목표가 현재 상태보다 뒤: 지금까지 거친 상태와 지금 열려 있는 전환을 알리고 멈춥니다. 이미 수행한 전환은 그대로 남습니다.

### 이슈 링크

```sh
sdlc-jira issue link types
sdlc-jira issue link add ABC-123 Blocks ABC-456
sdlc-jira issue link add ABC-123 Blocks ABC-456 --direction inward
sdlc-jira issue link add ABC-123 "is blocked by" ABC-456 --comment "Waiting on the API"
```

링크 유형마다 이름과 양 끝의 문구가 하나씩 있습니다. 유형 이름을 쓰면 첫 이슈가 바깥쪽(outward) 문구를 가지며(`ABC-123 blocks ABC-456`), `--direction inward` 는 양 끝을 맞바꿉니다. `is blocked by` 같은 문구를 쓰면 방향이 그 자체로 정해집니다. 유형은 사이트의 링크 유형과 대소문자 무시로 대조하며, 모르는 유형은 아무것도 쓰기 전에 실패하고 목록을 보여 줍니다. `issue view` 는 이슈의 링크를 그 이슈 쪽에서 본 문구로 나열합니다.

## 출력과 종료 코드

결과는 stdout 으로, 그 밖의 것은 stderr 로 나갑니다. `--json` 은 JSON 문서 하나를 출력합니다(터미널이면 들여쓰기, 아니면 한 줄). `--json` 에서는 오류도 stderr 에 JSON 입니다.

| 코드 | 의미                                                                       |
| ---- | -------------------------------------------------------------------------- |
| `0`  | 성공                                                                       |
| `2`  | 사용법 또는 설정 오류. 아무것도 바뀌지 않았습니다                          |
| `3`  | 자격 증명이 없거나, 더는 갱신할 수 없는 로그인이거나, 사이트가 거부함(401) |
| `4`  | 권한 없음(403)                                                             |
| `5`  | 찾을 수 없음(404), 또는 그런 전환·상태 경로·필드·사용자·링크 유형이 없음   |
| `6`  | Jira 가 실패(5xx)했거나 요청을 거부(그 밖의 4xx, 429)                      |
| `7`  | 사이트에 닿지 못함                                                         |

`issue transition` 과 `issue assign` 은 쓰기 전에 사이트에서 읽기부터 합니다. 그 조회에서 실패하면(예: 모호한 이름) 이슈는 바뀌지 않습니다.

## 포함하지 않는 것

Jira Server 와 Data Center, 보드와 스프린트, 이슈 링크 삭제는 이 패키지에 포함되지 않습니다.
