---
name: progress
description: Report and record where the Livestock Price Board build stands against docs/development-plan.md. Use when the user asks "where are we", "progress", "status report", "what is done", or at the end of a work session to log what changed.
---

# Progress report for the Livestock Price Board

You are producing the project's progress report and keeping the blueprint honest. The blueprint (`docs/development-plan.md`) is the source of truth for phases, gates and decisions; the published page mirrors it.

## Gather, do not guess

Run these and read the results before writing anything:

1. `git log --oneline -15` and `git status --short` in the repo root. Note commits since the last entry in `docs/PROGRESS.md` (create the file if missing).
2. `git ls-remote --heads origin` and, if reachable, fetch `https://github.com/alritzescorido/ritzitservices/actions?query=workflow%3ACI` to report the latest CI run status. If either is unavailable, say so rather than inventing a status.
3. Quick health of the checks, each with a one-line verdict:
   - `npm run -s db:test` (repo root)
   - `cd api && npx tsc --noEmit -p tsconfig.json && npm run -s test:e2e` (report the test count line)
   - `cd web-admin && npm run -s build`
   Skip a check only if the user asked for a fast report, and say it was skipped.
4. Read `docs/development-plan.md`: the phase table, the "What already exists" section, and the decisions table.

## Write

Produce the report in the project's house format (Ritz first line; Verified Facts, Assumptions, Risks & Edge Cases, Recommendations), then:

- Append a dated entry to `docs/PROGRESS.md` with: date, commits since last entry (short sha and subject), check verdicts, phase and gate status in one line each, open decisions with due dates, next three tasks. Newest entry at the top.
- Update `docs/development-plan.md` where the facts changed: the "What already exists" paragraph, the per-phase "(Done <date>)" notes, and the decisions table statuses. Change only lines whose facts changed; keep everything else word for word.
- If the blueprint page should reflect the change, republish it: the HTML source lives in the session scratchpad as `price-board-blueprint.html`; if that file is not present, say the page was not refreshed and how to do it (the page URL is in the root README).

## Rules

- Numbers come from tool output, never from memory. Test counts, commit shas, dates.
- A phase gate is "passed" only when every bullet under its Exit gate is true. Otherwise list the missing bullets.
- Decisions belong to the owner named in the table. Never mark one decided unless the user said so in this conversation.
- Keep the report under 300 words unless the user asks for detail.
