# @sdlc-tools/jira

[English](./README.md) | 한국어

사람과 AI 에이전트가 함께 쓰도록 설계된 Jira Cloud 커맨드라인 클라이언트입니다. 이슈를 검색, 조회, 생성, 수정, 전환, 담당자 지정하고 코멘트와 작업 시간을 기록하며, Atlassian API 토큰은 운영체제 키체인에 보관합니다.

모든 커맨드는 기본적으로 짧게 답하고, `--json` 을 주면 전체 결과를 JSON 문서 하나로 출력합니다. 사이트, 자격 증명, 인자가 빠져 있으면 요청을 보내기 전에 알려 주고, 틀린 플래그에는 해당 커맨드의 사용법을 출력하며, 종료 코드는 스크립트가 다음에 할 일을 알려 줍니다. 공유 동작의 명세는 [`@sdlc-tools/core`](../core/README.ko.md#규약) 에 있습니다.

Node.js 22.13 이상이 필요합니다. Jira Cloud 전용입니다(REST API v3).

```sh
npm install --global @sdlc-tools/jira   # `sdlc-jira` 커맨드가 설치됩니다
```

## 로그인

Atlassian 계정에서 API 토큰을 만듭니다(Security, API tokens). 토큰을 화면에 에코하지 않고 환경 변수에 넣은 뒤 저장합니다.

```sh
read -rs SDLC_JIRA_TOKEN && export SDLC_JIRA_TOKEN
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

`auth login` 은 먼저 사이트에서 토큰을 확인한 뒤, 이메일 주소와 함께 macOS 키체인, Windows 자격 증명 관리자, Linux Secret Service 에 저장합니다. 토큰은 환경 변수에서 읽으므로 커맨드 라인이나 셸 히스토리에 나타나지 않고, 출력되지도 않습니다. 자격 증명은 사이트별로 저장되어, 토큰은 발급받은 사이트에만 제시됩니다. 한 사이트에서 계정을 여럿 쓰려면 `--profile <name>` 을 사용하세요.

| 커맨드        | 용도                                                   |
| ------------- | ------------------------------------------------------ |
| `auth login`  | API 토큰을 확인하고 키체인에 저장                      |
| `auth status` | 현재 자격 증명이 어느 계정의 것이고 어디서 왔는지 표시 |
| `auth logout` | 사이트에 저장된 자격 증명 삭제                         |

키체인이 없는 CI, 컨테이너, SSH 세션에서는 `SDLC_JIRA_EMAIL` 과 `SDLC_JIRA_TOKEN` 을 설정하세요. 이 값이 키체인보다 우선하며 어디에도 기록되지 않습니다.

## 설정

사이트에 대한 정보는 도구에 내장되어 있지 않습니다. 각 설정은 다음 순서로 결정됩니다. 플래그, 환경 변수, 작업 디렉터리와 저장소 루트 사이에서 가장 가까운 `.sdlc-tools.json`, 그리고 `~/.config/sdlc-tools/config.json`(`$XDG_CONFIG_HOME` 을 따르며, Windows 는 `%APPDATA%\sdlc-tools\config.json`)입니다.

| 설정      | 플래그      | 환경 변수           | 파일                       |
| --------- | ----------- | ------------------- | -------------------------- |
| `site`    | `--site`    | `SDLC_JIRA_SITE`    | 사용자 파일만              |
| `project` | `--project` | `SDLC_JIRA_PROJECT` | 프로젝트 파일, 사용자 파일 |
| `profile` | `--profile` | `SDLC_JIRA_PROFILE` | 사용자 파일만              |
| `fields`  |             |                     | 프로젝트 파일, 사용자 파일 |

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "project": "ABC",
    "fields": { "points": "customfield_10016" }
  }
}
```

- 사이트는 자격 증명이 전송되는 곳을 정하므로, 저장소의 `.sdlc-tools.json` 은 사이트를 설정할 수 없습니다.
- 설정 파일에는 토큰이나 비밀번호를 넣을 수 없으며, 들어 있으면 파일을 거부합니다.
- `fields` 는 직접 정한 짧은 이름을 필드 id 에 연결합니다([커스텀 필드](#커스텀-필드) 참고).

## 이슈

```sh
sdlc-jira issue view ABC-123
sdlc-jira issue list --assignee me --status "In Progress"
sdlc-jira issue list --jql "project = ABC AND updated >= -7d ORDER BY updated DESC" --limit 50
sdlc-jira issue create --type Task --summary "Rotate the signing key" --label security --assignee me
sdlc-jira issue edit ABC-123 --summary "Better title" --due 2026-12-31 --add-label urgent
sdlc-jira issue transitions ABC-123
sdlc-jira issue transition ABC-123 "In Progress"
sdlc-jira issue assign ABC-123 ada@example.com
sdlc-jira issue comment add ABC-123 "Fixed in **build 42**"
sdlc-jira issue worklog add ABC-123 "1d 2h" --started 2026-03-02T09:00:00+09:00 --comment "Reviewed the migration"
```

| 커맨드                            | 동작                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue view <key>`                | 요약, 상태, 관련자, 설명, 최근 코멘트. `--json` 은 모든 필드를 돌려줍니다.                                                                                                                                                    |
| `issue list`                      | `--jql` 로 검색하거나 `--project`, `--assignee`, `--status`, `--type`, `--label` 필터로 검색합니다. `--limit` 까지 페이지를 넘겨 가져옵니다.                                                                                  |
| `issue create`                    | `--type`, `--summary`, 프로젝트가 필요합니다. `--description`, `--description-file`, `--priority`, `--due`, `--estimate`, `--label`, `--parent`, `--assignee`, `--field` 도 쓸 수 있습니다.                                   |
| `issue edit <key>`                | 넘긴 것만 바꿉니다. `--label` 은 교체, `--add-label` 과 `--remove-label` 은 조정, `--clear-due` 는 마감일 제거입니다.                                                                                                         |
| `issue transitions <key>`         | 지금 가능한 전환을 id 와 함께 보여 줍니다.                                                                                                                                                                                    |
| `issue transition <key> <target>` | 이슈를 전환합니다. target 은 전환 id, 전환 이름, 또는 전환이 가리키는 상태 이름입니다. 여러 전환에 걸리는 이름은 실패하고 id 를 나열합니다. `--comment` 는 코멘트를 달고, `--field` 는 워크플로우가 요구하는 필드를 채웁니다. |
| `issue assign <key> <who>`        | `who` 는 `me`, 지정 해제용 `none`, 계정 id, 또는 그 이슈에 지정 가능한 사용자 중에서 조회하는 이름이나 이메일입니다. 여러 명이 맞으면 추측하지 않고 후보를 나열하며 실패합니다.                                               |
| `issue comment add <key> [body]`  | 인자 또는 `--body-file` 로 코멘트를 추가합니다.                                                                                                                                                                               |
| `issue comment list <key>`        | 최근 코멘트를 오래된 순으로 보여 줍니다.                                                                                                                                                                                      |
| `issue worklog add <key> <time>`  | `30m`, `2h`, `1d 4h`(주, 일, 시간, 분) 같은 시간을 기록합니다. `--started` 는 오프셋이 있는 ISO 8601 시각을 받습니다.                                                                                                         |
| `issue worklog list <key>`        | 기록된 항목과 그 합계 시간.                                                                                                                                                                                                   |
| `field list`                      | 사이트의 필드를 id, 타입과 함께 보여 줍니다. `--search`, `--custom` 으로 좁힙니다.                                                                                                                                            |

`issue create` 에는 프로젝트가 필요하고, `issue list` 는 `--jql` 도 `--assignee` 도 없으면 프로젝트가 필요합니다. 기본 프로젝트가 설정되어 있으면 필터 검색은 그 프로젝트로 제한되며, 여러 프로젝트를 검색하려면 `--jql` 을 쓰세요.

### 설명과 코멘트

설명, 코멘트, 작업 시간 메모, 리치 텍스트 커스텀 필드는 Markdown 으로 쓰고, Jira REST API 가 요구하는 Atlassian Document Format 으로 변환됩니다. 지원하는 것은 제목, 문단과 강제 줄바꿈, 중첩된 글머리 기호·번호 목록, 작업 목록(`- [ ]`, `- [x]`), 코드 블록, 인용문, 구분선, 표, 그리고 굵게·기울임·취소선·인라인 코드·링크입니다. `issue view` 는 ADF 를 같은 Markdown 부분집합으로 되돌려 보여 주며, 멘션, 이모지, 상태 라벨, 날짜, 패널, 첨부 파일은 읽을 수 있는 텍스트로 표시합니다.

### 커스텀 필드

필드 id 는 사이트마다 다르므로 `--field name=value` 는 아는 것을 무엇이든 받습니다.

1. 설정의 `jira.fields` 에 있는 별칭,
2. 필드 id(`customfield_10016`, `duedate`),
3. 사이트가 보여 주는 필드 이름(대소문자 무시). 사이트의 필드 목록으로 조회합니다.

`--field` 는 필드 타입에 맞게 값을 만듭니다. 숫자, 문자열, 날짜, 문자열 목록(`a, b`), 리치 텍스트를 지원합니다. 구조가 있는 값은 API 가 기대하는 JSON 을 `--field-json 'Reviewer={"accountId":"..."}'` 로 넘기세요. 두 필드에 걸리는 이름은 실패하고 둘 다 나열하며, 모르는 이름은 실패하고 `sdlc-jira field list` 를 안내합니다.

## 출력과 종료 코드

결과는 stdout 으로, 그 밖의 것은 stderr 로 나갑니다. `--json` 은 JSON 문서 하나를 출력합니다(터미널이면 들여쓰기, 아니면 한 줄). `--json` 에서는 오류도 stderr 에 JSON 입니다.

| 코드 | 의미                                                  |
| ---- | ----------------------------------------------------- |
| `0`  | 성공                                                  |
| `2`  | 사용법 또는 설정 오류. 아무것도 바뀌지 않았습니다     |
| `3`  | 자격 증명이 없거나 사이트가 거부함(401)               |
| `4`  | 권한 없음(403)                                        |
| `5`  | 찾을 수 없음(404), 또는 그런 전환·필드·사용자가 없음  |
| `6`  | Jira 가 실패(5xx)했거나 요청을 거부(그 밖의 4xx, 429) |
| `7`  | 사이트에 닿지 못함                                    |

`issue transition` 과 `issue assign` 은 쓰기 전에 사이트에서 읽기부터 합니다. 그 조회에서 실패하면(예: 모호한 이름) 이슈는 바뀌지 않습니다.

## 포함하지 않는 것

OAuth 2.0(3LO) 로그인, Jira Server 와 Data Center, 보드와 스프린트, 이슈 링크는 이 패키지에 포함되지 않습니다.
