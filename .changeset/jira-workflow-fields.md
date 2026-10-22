---
'@sdlc-tools/jira': minor
---

Run a team's issue workflow from configuration:

- custom field aliases in `jira.fields` can declare a value type; `date` and `datetime` values are validated before any request, and `issue view` and `issue list --fields` read fields back by alias
- `issue transition <key> --to <status>` makes every transition needed to reach a status, in the order given by `jira.workflow`, and stops with the statuses reached and the transitions open when no path exists
- worklogs keep the UTC offset of `--started`, and `worklog list` shows it
- `issue link add` and `issue link types` create links by link type name or phrase with a direction, and `issue view` lists an issue's links
