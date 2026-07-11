# Contributing to Opentui

Bug fixes and feature suggestions are always welcome. For bug fixes, open a PR
for reviews. Feature suggestions are subject to discussion via issues.

## Pull Requests

Pull requests are checked by an automated `pr-standards` workflow for title
format, template completeness, and a linked issue.

### PR Titles

PR titles must follow Conventional Commits:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation changes
- `chore:` maintenance / tooling / dependency updates
- `refactor:` code change without behavior change
- `test:` adding or updating tests

You can optionally include a package scope, e.g. `fix(core):` or `feat(solid):`.

### Issue First Policy

`fix:` PRs must reference an existing issue. Open an issue describing the bug,
then add `Closes #<number>` (or `Fixes #<number>`) to the PR description.
`docs`, `refactor`, and `feat` PRs are exempt from the issue requirement.

## Code style

Reference existing [AGENTS.md](https://github.com/anomalyco/opentui/blob/main/AGENTS.md) or project conventions if applicable.

## Code of conduct

- Treat everyone with respect and empathy. We do not tolerate harassment, discrimination, or personal attacks.
- Be kind, constructive, and assume good intent.
- Keep feedback specific and actionable; critique code, not people.
- No unsolicited DMs for support unless invited.
- Follow project guidelines and maintainers’ decisions.
