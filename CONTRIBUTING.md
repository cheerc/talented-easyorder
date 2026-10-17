# Contributing to EasyOrder POS

Thank you for your interest in contributing to EasyOrder POS! This guide will help you get started.

## Fork & Setup

See the [Fork & Setup section in README.md](./README.md#fork--setup) for environment setup instructions.

## Branch Flow

1. **Fork** this repository
2. Create a **feature branch** from the current default branch (`main`): `git checkout -b feat/your-feature main`
3. Make your changes with clear, focused commits
4. Open a **Pull Request** targeting the current default branch (`main`)

For the formal backend, read the current [development handoff](./docs/DEVELOPMENT-HANDOFF.md) first; its phase and authorization boundaries take precedence over historical instructions.

## CI Requirements

PR validation is determined by the current [CI workflow](./.github/workflows/ci.yml). Its npm commands run with working directory `frontend/`; the workflow also runs project-specific Emulator proofs on non-docs changes. A docs-only PR (changes limited to `docs/**` and Markdown files) is classified separately and skips build, lint, and test steps; required CI success for that path is not evidence that app checks ran. To run a command locally, first use `cd frontend`; select the checks applicable to your change and report skipped or unrun checks accurately.

## Code Review

- External PRs require **maintainer review and approval** before merge
- Address all review comments before requesting re-review
- Keep PRs focused — one feature or fix per PR

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type(scope): description
```

| Type | Use for |
|------|---------|
| `feat` | New features |
| `fix` | Bug fixes |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `chore` | Maintenance, dependencies |
| `refactor` | Code restructuring without behavior change |

Examples:
- `feat(pos): add barcode scanner support`
- `fix(auth): handle expired session gracefully`
- `test(store): add orderActions coverage`

## Code Quality

- **TypeScript strict mode** — all code must be fully typed
- **No `any`** — use proper types or `unknown` with type guards
- **Lint clean** — run `npm run lint` before committing
- **No secrets** — never commit credentials, API keys, or service account files

## Testing

- New features must include tests
- Use [Vitest](https://vitest.dev/) for unit tests
- Follow existing test patterns in `__tests__/` directories
- Mock data should use `Record<string, unknown>` instead of `any`

## Questions?

Open a [GitHub Issue](../../issues) if you have questions about contributing.
