# @sdlc-tools/forgejo

[English](./README.md) | 한국어

`sdlc-forgejo` 는 [Forgejo](https://forgejo.org) 와 [Gitea](https://about.gitea.com) 의 풀 리퀘스트를 다루는 커맨드라인 클라이언트로, 사람과 AI 에이전트가 함께 쓰도록 설계되었습니다. 기본적으로 짧게 답하고, `--json` 을 주면 전체 결과를 JSON 문서 하나로 출력합니다. 인자, 설정, 자격 증명이 빠져 있으면 요청을 보내지 않고, 서버가 401, 403, 404 를 돌려주면 다음에 할 일을 설명합니다.

이 도구는 출력 규약, 종료 코드, 자격 증명 처리를 정의하는 [`@sdlc-tools/core`](../core/README.ko.md#규약) 위에서 만들어졌고, 이 저장소의 모든 도구가 같은 규약을 씁니다.

Node.js 22.13 이상이 필요합니다.

```sh
npm install --global @sdlc-tools/forgejo
```

## 첫 풀 리퀘스트

```sh
export SDLC_FORGEJO_HOST=https://git.example.com

sdlc-forgejo auth login --client-id <id>     # 브라우저를 한 번 엽니다
git push -u origin feat/export
sdlc-forgejo pr create --title "feat: export" --body-file description.md --reviewer alice
sdlc-forgejo pr merge 12
```

체크아웃 안에서는 저장소를 `origin` 리모트에서 읽으므로 `--repo` 가 필요 없습니다. 아래의 모든 것은 체크아웃 밖에서도 `--host` 와 `--repo` 로 지정해 쓸 수 있습니다.

## 로그인

자격 증명은 운영체제 키체인(macOS 키체인, Windows 자격 증명 관리자, Linux Secret Service)에 발급한 서버별로 저장됩니다. 설정 파일에는 아무것도 기록되지 않습니다.

### PKCE 를 쓰는 OAuth (권장)

`auth login` 은 PKCE(`S256`)와 루프백 리디렉션을 쓰는 OAuth 2.0 인가 코드 방식으로 로그인합니다. 브라우저 창이 열리고 요청을 승인하면 토큰이 저장되어 자동으로 갱신됩니다. 액세스 토큰은 만료 직전에 갱신되고, 서버가 401 을 돌려줄 때도 다시 갱신됩니다.

서버에 OAuth 애플리케이션이 먼저 있어야 합니다. Forgejo 웹 화면의 **Settings, Applications, Manage OAuth2 applications** 에서 하나 만드세요.

| 필드                | 값                                               |
| ------------------- | ------------------------------------------------ |
| Confidential client | 끔 (커맨드라인 도구는 비밀을 보관할 수 없습니다) |
| Redirect URI        | `http://127.0.0.1/callback`                      |

클라이언트 id 를 복사해 `--client-id` 로 한 번 넘기거나 설정(`clientId`)에 두세요. 로그인은 어느 애플리케이션이 발급했는지 기억하므로, 이후 커맨드에는 아무것도 필요 없습니다.

- 리디렉션은 포트 없이 등록합니다. Forgejo 는 루프백 주소의 어떤 포트든 받아 줍니다. 정확한 주소를 요구하는 서버라면 리디렉션에 등록한 포트를 넣고 `auth login` 에 `--callback-port <port>` 를 주세요.
- `--scopes` 를 주지 않으면 스코프를 요청하지 않습니다.
- 커맨드는 REST API 가 새 토큰을 받아들인 뒤에야 끝나므로, 쓸 수 없는 로그인은 저장되지 않습니다.

**문제 해결: "Unregistered Redirect URI".** 브라우저에 이 화면이 뜨고 `auth login` 이 5분 뒤 시간 초과로만 끝난다면, 애플리케이션이 기밀 클라이언트(confidential client)로 등록된 것입니다. 기밀 클라이언트는 서버가 포트까지 포함해 리디렉션 주소를 비교하는데, `auth login` 은 비어 있는 임의 포트에서 대기합니다. 해결은 둘 중 하나입니다.

- 애플리케이션을 공개 클라이언트로 등록합니다(Confidential client 끔). 이 항목의 위치는 서버 버전마다 달라, 편집 화면에 보이지 않으면 끈 상태로 애플리케이션을 새로 만드세요.
- 기밀 클라이언트를 유지하려면 `http://127.0.0.1:8765/callback` 처럼 포트를 고정한 리디렉션을 등록하고 `auth login --callback-port 8765` 로 로그인합니다.

`auth login` 은 대기하는 동안 이 안내를 출력하고, 시간 초과 때도 가장 가능성 높은 원인으로 같은 내용을 알려 줍니다.

서버가 싱글 사인온으로 로그인시키더라도 달라지는 것은 없습니다. 브라우저에 서버의 평소 로그인 화면이 뜨고, 거기서 싱글 사인온 버튼을 고르면 됩니다. 커맨드는 그 로그인을 보지 않으며, Forgejo 서버가 직접 발급한 코드와 토큰만 받습니다.

### 개인 액세스 토큰

**Settings, Applications** 에서 토큰을 만들어 파이프로 넘기세요. 토큰이 프로세스 목록이나 셸 히스토리에 나타나지 않도록 표준 입력에서 읽습니다.

```sh
printf %s "$TOKEN" | sdlc-forgejo auth login --with-token
```

키체인이 없는 CI 와 컨테이너에서는 `SDLC_FORGEJO_TOKEN` 을 설정하세요. 이 값이 키체인보다 우선하며 어디에도 저장되지 않습니다.

### 그 밖의 커맨드

| 커맨드                     | 용도                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sdlc-forgejo auth status` | 저장된 자격 증명이 누구의 것인지 서버에 묻습니다. 로그인하지 않았으면 3 으로 끝납니다.                  |
| `sdlc-forgejo auth logout` | 키체인에서 자격 증명을 지웁니다. 서버에서도 무효화하려면 Settings, Applications 에서 토큰을 폐기하세요. |

`--profile <name>` 은 한 서버의 여러 계정을 구분합니다.

## 설정

각 설정은 플래그, 환경 변수, 프로젝트 파일(`.sdlc-tools.json`, 저장소 루트까지 위로 탐색), 사용자 파일(`~/.config/sdlc-tools/config.json`) 순으로 결정됩니다. 파일은 도구별로 섹션 하나를 두며 문자열만 담습니다.

```json
{
  "forgejo": {
    "host": "https://git.example.com",
    "clientId": "<id>",
    "repo": "my-team/my-project",
    "reviewers": "alice,bob"
  }
}
```

| 키                       | 플래그            | 환경 변수                               | 의미                                                                           |
| ------------------------ | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| `host`                   | `--host`          | `SDLC_FORGEJO_HOST`                     | 서버 주소. 필수이며 https 만 허용합니다(`localhost` 는 http 도 가능).          |
| `repo`                   | `--repo`          | `SDLC_FORGEJO_REPO`                     | `owner/name`. `origin` 리모트가 `host` 에 있으면 그것이 기본값입니다.          |
| `profile`                | `--profile`       | `SDLC_FORGEJO_PROFILE`                  | 자격 증명 프로필.                                                              |
| `clientId`               | `--client-id`     | `SDLC_FORGEJO_CLIENT_ID`                | `auth login` 에 쓰는 OAuth 애플리케이션.                                       |
| `callbackPort`           | `--callback-port` | `SDLC_FORGEJO_CALLBACK_PORT`            | 로그인 콜백의 고정 포트.                                                       |
| `scopes`                 | `--scopes`        | `SDLC_FORGEJO_SCOPES`                   | OAuth 스코프. 쉼표나 공백으로 구분합니다.                                      |
| `base`                   | `--base`          | `SDLC_FORGEJO_BASE`                     | 기본 대상 브랜치. 없으면 저장소의 기본 브랜치입니다.                           |
| `reviewers`              |                   | `SDLC_FORGEJO_REVIEWERS`                | `pr create` 의 기본 리뷰어(쉼표로 구분). `--reviewer` 는 여기에 더해집니다.    |
| `labels`                 |                   | `SDLC_FORGEJO_LABELS`                   | `pr create` 의 기본 라벨(쉼표로 구분).                                         |
| `prTitlePattern`         |                   | `SDLC_FORGEJO_PR_TITLE_PATTERN`         | 모든 풀 리퀘스트 제목이 맞아야 하는 정규식.                                    |
| `prRequiredSections`     |                   | `SDLC_FORGEJO_PR_REQUIRED_SECTIONS`     | 본문에 있어야 하는 항목 이름. 각 항목 아래에 내용이 있어야 합니다.             |
| `mergeRequiredStatuses`  |                   | `SDLC_FORGEJO_MERGE_REQUIRED_STATUSES`  | `pr merge` 전에 head 커밋에서 `success` 여야 하는 상태 컨텍스트.               |
| `mergeRequiredApprovals` |                   | `SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS` | head 커밋에 필요한 승인 수. `mergeApprovers` 가 있으면 1 입니다.               |
| `mergeApprovers`         |                   | `SDLC_FORGEJO_MERGE_APPROVERS`          | 승인으로 인정하는 사용자: 이름 또는 `*` 패턴. 없으면 누구나 인정합니다.        |
| `mergeMethods`           |                   | `SDLC_FORGEJO_MERGE_METHODS`            | `pr merge` 가 쓸 수 있는 머지 방식. 첫 번째가 기본이며, 없으면 `merge` 입니다. |

서버, 계정, OAuth 애플리케이션은 자격 증명이 어디로 가는지를 정하므로 프로젝트 파일에서 읽지 않습니다. 직접 쓰지 않은 저장소가 이를 고를 수 없게 하려는 것입니다. 같은 이유로, 리모트에서 읽은 저장소는 그 리모트가 설정된 서버에 있을 때만 받아들입니다.

## 머지 정책

머지에 관한 팀의 규칙은 설정에 두고, `pr merge` 가 이를 실행하는 사람에게 맡기지 않고 직접 강제합니다. 정책 설정에는 플래그가 없으므로 커맨드 라인으로 끌 수 없습니다.

```json
{
  "forgejo": {
    "reviewers": "alice,bob,carol",
    "prTitlePattern": "^(feat|fix|docs|chore): .+ \\[[A-Z]+-\\d+\\]$",
    "prRequiredSections": "Summary, Testing, Breaking change",
    "mergeRequiredStatuses": "review-bot/review, ci/build",
    "mergeRequiredApprovals": "2",
    "mergeApprovers": "alice, bob, carol",
    "mergeMethods": "merge"
  }
}
```

모든 판정은 풀 리퀘스트의 **현재 head 커밋**을 기준으로 합니다. 옛 커밋에 기록된 것은 인정하지 않습니다.

- **상태.** `mergeRequiredStatuses` 의 각 컨텍스트는 head 에서 가장 최근 결과가 `success` 여야 합니다. 보고되지 않았거나 `pending`, `failure`, `error`, `warning` 이면 머지를 거부하고, 같은 컨텍스트를 다시 실행하면 이전 결과를 대체합니다. 괄호 안의 쉼표는 이름의 일부이므로 `build (node 22, linux)` 는 컨텍스트 하나입니다. 계정이 상태를 읽을 권한이 없으면 추측하지 않고 권한 오류로 멈춥니다.
- **승인.** 승인은 그 리뷰어의 가장 최근 결정적 리뷰이고, 취소(dismiss)되지 않았으며, stale 로 표시되지 않았고, head 커밋에서 작성되었을 때 인정합니다. 서버가 어느 커밋에서 작성했는지 알려 주지 않는 승인은 인정하지 않습니다. 나중의 변경 요청은 이전 승인을 대체하고, 코멘트는 아무것도 바꾸지 않습니다. `mergeApprovers` 의 항목은 사용자 이름이거나 `*` 가 임의 길이의 문자열을 뜻하는 패턴(예: `alice, team-*`)이며, 로그인 전체에 대해 대소문자를 무시하고 비교합니다. `mergeApprovers` 만 설정하면 승인 1건이 필요합니다. 다른 사람의 변경 요청이 아직 열려 있으면 경고로 알립니다.
- **머지 방식.** `mergeMethods` 에 더 적지 않으면 `merge` 가 기본이자 유일한 방식입니다. 선택지는 `merge`, `rebase`, `rebase-merge`, `squash`, `fast-forward-only` 입니다. [머지](#머지)를 보세요.

충족되지 않은 것이 있으면 아무것도 보내지 않습니다. 커맨드는 6 과 `merge_blocked` 로 끝나며 빠진 항목을 모두 나열하고, 프로그램이 읽을 수 있도록 `error.details.unmet` 에 항목별로 담습니다.

```json
{ "kind": "status", "context": "review-bot/review", "state": "pending", "url": null }
{
  "kind": "approval",
  "required": 2,
  "approvedBy": ["alice"],
  "waitingFor": ["bob", "carol"],
  "notCounted": [{ "reviewer": "bob", "reason": "approved 03aae758, not the current head" }]
}
```

head 에 아무것도 보고되지 않았으면 `state` 는 `missing` 입니다. 승인 3건을 이름 2명에게 요구하는 것처럼 절대 충족할 수 없는 설정은 첫 요청 전에 2 로 실패합니다.

## 커맨드

옵션은 커맨드 이름 뒤에 둡니다. `sdlc-forgejo <command> --help` 가 모든 옵션을 보여 줍니다.

| 커맨드                    | 용도                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `pr list`                 | 풀 리퀘스트 목록 (`--state open\|closed\|all`, `--head`, `--base`, `--limit`).       |
| `pr view <number>`        | 상태, 머지 가능 여부, 리뷰, 각 CI 체크의 최신 결과를 표시합니다.                     |
| `pr check`                | 열지 않고, 브랜치로 풀 리퀘스트를 열 수 있는지만 알려 줍니다.                        |
| `pr create`               | 풀 리퀘스트를 엽니다. 아래를 보세요.                                                 |
| `pr ready [<number>]`     | 초안을 리뷰 준비 상태로 바꿉니다. `--undo` 는 다시 초안으로 돌립니다. 아래를 보세요. |
| `pr reviewers <number>`   | 리뷰 요청을 보내거나(`--add`) 철회합니다(`--remove`).                                |
| `pr labels <number>`      | 이름으로 라벨을 붙이거나(`--add`) 뗍니다(`--remove`).                                |
| `pr merge <number>`       | 설정한 정책이 충족되면 머지합니다. 아래를 보세요.                                    |
| `branch cleanup <branch>` | 머지된 브랜치를 로컬과 서버에서 지웁니다. 아래를 보세요.                             |

### 풀 리퀘스트 열기

`pr create --title <text> (--body <text> | --body-file <path|->) [--head] [--base] [--reviewer ...] [--label ...] [--draft]`

무엇이든 보내기 전에 다음을 확인합니다.

- 제목과 본문은 비어 있지 않아야 하고, 제목은 255자 이하의 한 줄이어야 합니다. `prTitlePattern` 과 `prRequiredSections` 가 프로젝트의 규칙을 더합니다. `<type>: <subject> [KEY]` 같은 제목은 패턴 하나로 강제하고, 필수 항목은 모두 제목줄(heading)이나 굵은 라벨(`**Name**`, `**Name:** value`, `**Name**: value`)로 나타나야 하며 그 아래에 내용이 있어야 합니다. 빈 줄과 HTML 주석은 내용으로 치지 않고, 코드 펜스 안에서 `#` 로 시작하는 줄은 제목줄이 아닙니다.
- head 브랜치는 `--head` 가 없으면 체크아웃된 브랜치이고, base 의 기본값은 저장소의 기본 브랜치입니다.

그다음 서버와 git 에 물어서, 다음 경우에 풀 리퀘스트를 거부합니다.

- head 브랜치가 서버에 없거나, 서버에 로컬 브랜치와 다른 커밋이 있을 때(먼저 push 하세요).
- base 와 상관없이 그 브랜치의 풀 리퀘스트가 이미 열려 있을 때. 닫히거나 머지된 것은 논의를 먼저 읽어 볼 만하므로 경고만 냅니다.
- base 브랜치가 없을 때.

설정한 `reviewers` 와 모든 `--reviewer` 는 한꺼번에, 사용자당 한 번씩 요청합니다. Forgejo 는 작성자에게 보내는 리뷰 요청을 요청 전체째로 거부해 나머지 리뷰어까지 요청되지 않으므로, 설정 목록에서는 작성자를 뺍니다. `--reviewer` 로 지정한 리뷰어는 그대로 보냅니다.

라벨은 풀 리퀘스트를 만들기 전에 이름으로 확인하므로, 철자가 틀린 라벨 때문에 반쯤 만들어진 풀 리퀘스트가 남지 않습니다. 이후에 리뷰어 요청이나 라벨 부착이 실패하면 풀 리퀘스트는 유지한 채 6 으로 끝나며, 그 풀 리퀘스트와 마무리할 커맨드를 알려 줍니다. `--draft` 는 제목에 `WIP:` 를 붙이는데, Forgejo 가 초안을 표시하는 방식입니다.

### 풀 리퀘스트 준비 완료 처리

`pr ready [<number>] [--undo]`

Forgejo 는 제목에서 초안을 판단합니다. 제목이 서버가 정한 작업 중 접두사(기본은 `WIP:` 와 `[WIP]`, 대소문자를 구분하지 않습니다)로 시작하는 동안 초안입니다. `pr ready` 는 접두사를 떼고 제목의 나머지는 그대로 둡니다. `--undo` 는 `WIP:` 를 다시 붙입니다. 번호를 생략하면 체크아웃한 브랜치의 열린 풀 리퀘스트를 대상으로 합니다. 이미 요청한 상태이면 아무것도 보내지 않고 그렇게 알려 줍니다(`--json` 에서는 `changed: false`). 머지됐거나 닫힌 풀 리퀘스트는 거부하고(6, `pull_request_not_open`), 서버가 다른 초안 접두사를 써서 제목을 바꿔도 요청한 상태가 되지 않을 때도 거부합니다. 판단은 서버의 응답을 따르고, 제목이 그대로이면 아무것도 보내지 않고, 보낸 제목이 효과가 없었다고 응답이 보여 주면 원래 제목으로 되돌립니다(6, `draft_unchanged`). 준비가 끝난 풀 리퀘스트는 `pr merge` 가 받아들입니다.

### 머지

`pr merge <number> [--method <method>] [--match-head-commit <sha>] [--expect-base <branch>] [--keep-branch]`

설정이 다른 방식을 허용하지 않으면 머지는 merge commit 을 만듭니다. squash 와 rebase 는 같은 변경을 다른 해시로 남겨 이후의 rebase 를 충돌 해결로 만들기 때문에 선택 사항입니다. `mergeMethods` 에 팀이 허용하는 방식을 적으면 `--method` 가 없을 때 첫 번째가 쓰이고, 그 밖의 방식을 요청하면 아무것도 보내기 전에 거부합니다(종료 코드 2, `merge_method_not_allowed`). `merge` 가 아닌 방식에서는 서버가 커밋 메시지를 씁니다.

다음 경우에는 머지 요청을 보내기 전에 거부합니다. 풀 리퀘스트가 닫혔거나, 이미 머지되었거나, 초안이거나, 서버가 머지할 수 없다고 하거나, `--expect-base` 와 다른 브랜치를 대상으로 하거나, head 가 `--match-head-commit` 이 아니거나, [머지 정책](#머지-정책)을 충족하지 못할 때입니다. 모든 이유를 한 번에 나열합니다. 정책이 요구하지 않는 실패했거나 실행 중인 CI 체크는 경고로만 알립니다. 그것이 머지를 막을지는 서버의 브랜치 보호가 정합니다.

상태와 승인은 처음에 본 head 커밋을 기준으로 읽고, 머지 요청에도 그 커밋을 함께 보내므로 그 사이 head 가 움직였다면 서버가 머지를 거부합니다. 머지 뒤에는 풀 리퀘스트를 다시 읽어, 서버에서 머지된 것으로 보일 때만 머지했다고 보고합니다. `--keep-branch` 가 없으면 서버의 브랜치를 지웁니다. 서버가 브랜치를 남겨 두면(예: 보호된 브랜치) 경고로 알립니다.

### 브랜치 정리

`branch cleanup <branch> [--base <branch>] [--worktree <path>]`

로컬 브랜치, 서버 브랜치, 그리고 `--worktree` 가 있으면 연결된 워크트리를 지우되, git 이 그 브랜치가 `origin/<base>` 에 포함됨을 증명한 뒤에만 지웁니다. 증명의 어느 부분이든 실패하면 아무것도 지우지 않습니다. 기본 브랜치, base, 서버가 보호하는 브랜치, 체크아웃된 브랜치는 거부하고, 커밋하지 않은 변경이 있는 워크트리는 절대 지우지 않습니다.

## 종료 코드

종료 코드는 [`@sdlc-tools/core`](../core/README.ko.md#종료-코드) 가 정의한 것입니다. `0` 성공, `2` 사용법 또는 설정, `3` 인증, `4` 권한, `5` 찾을 수 없음, `6` 서버가 요청을 거부, `7` 서버에 닿을 수 없음. 이 도구는 스스로 확인하는 사전 조건에 대해 안정적인 `code` 와 함께 `6` 을 씁니다.

| `code`                     | 의미                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `create_blocked`           | 아직 이 브랜치로 풀 리퀘스트를 열 수 없습니다. 이유를 나열합니다.                          |
| `pull_request_not_open`    | 머지됐거나 닫힌 풀 리퀘스트에 `pr ready` 를 요청했습니다.                                  |
| `draft_unchanged`          | 제목으로는 풀 리퀘스트를 요청한 상태로 만들 수 없습니다. 서버가 다른 초안 접두사를 씁니다. |
| `merge_blocked`            | 풀 리퀘스트를 머지할 수 없거나 머지 정책을 충족하지 못했습니다. 이유를 나열합니다.         |
| `merge_rejected`           | 서버가 머지를 거부했습니다(보호 규칙, 움직인 head, 저장소가 켜지 않은 머지 방식).          |
| `merge_method_not_allowed` | `--method` 가 `mergeMethods` 가 허용하지 않는 방식을 가리킵니다(종료 코드 2).              |
| `pull_request_incomplete`  | 풀 리퀘스트는 열렸지만 리뷰어나 라벨을 적용하지 못했습니다.                                |
| `cleanup_blocked`          | 브랜치가 머지되었음이 증명되지 않았거나, 절대 지우면 안 되는 브랜치입니다.                 |

`--json` 에서는 이유가 `error.details.violations` 에, 충족되지 않은 정책 항목이 `error.details.unmet` 에 있습니다.

## 호환성

같은 REST API(`/api/v1`)와 OAuth2 공급자(`/login/oauth/authorize`, `/login/oauth/access_token`)를 제공하는 Forgejo 와 Gitea 서버에서 동작합니다. Forgejo 15 에서 검증했으며, OAuth 로그인, 리뷰어 요청, OAuth 토큰으로 머지하는 것과 함께 머지 정책도 확인했습니다. 여러 페이지에 걸친 커밋 상태 읽기, 작성된 커밋에서만 유효한 승인, merge commit 과 squash 머지입니다.
