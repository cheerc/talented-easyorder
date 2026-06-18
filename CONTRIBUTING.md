# Contributing to EasyOrder POS

Thank you for your interest in contributing to EasyOrder POS! This guide will help you get started.

## Fork & Setup

See the [Fork & Setup section in README.md](./README.md#fork--setup) for environment setup instructions.

## Branch Flow

1. **Fork** this repository
2. Create a **feature branch** from `dev`: `git checkout -b feat/your-feature dev`
3. Make your changes with clear, focused commits
4. Open a **Pull Request** targeting the `dev` branch

## CI Requirements

All PRs must pass the CI pipeline before merge:

- `npm run build` — production build succeeds
- `npm run lint` — zero ESLint errors
- `npx vitest run` — all tests pass

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
