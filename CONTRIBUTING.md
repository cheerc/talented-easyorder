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

- PR 由獨立的 reviewer（subagent 或另開的 session，不是作者本身）依 [REVIEW.md](./REVIEW.md) 審查最新 head；reviewer 要先讀 `REVIEW.md` 與變更區域的 `CLAUDE.md`。
- 合併條件：最新 head 的 review 沒有未解的 🔴 Important finding，且 required CI 通過。符合時以 squash merge 合併到 `main`。
- 合併前須取得使用者授權之工作流程對該 PR 最新 head 的合併核可（不是 GitHub Actions 的 workflow／Environment 核准）；未取得不得合併；作者不自行決定合併，除非使用者對該 PR 明確指示。使用 `--admin` 略過分支保護只在使用者授權下進行，範圍依 [正式後端交接](./docs/DEVELOPMENT-HANDOFF.md)。由誰執行合併不在本 repo 規範，交給各環境自己的工作流程決定。
- 不以 skip、停用測試或重開 PR 的方式換取綠燈。
- 外部貢獻者的 PR 需 maintainer 審核同意。
- 一個 PR 只做一件事。

## Commit 與 PR 標題

- Commit message 與 PR 標題、內文使用中文，描述使用者看得到的效果或修正；可加 `docs:`、`fix:` 等前綴，但不強制。
- 對應 issue 時在標題末尾加上編號，例如 `日結頁備份後不再誤報「其他裝置已更新資料」（#596）`；squash merge 以 PR 標題作為 commit 標題。
- 不寫 AI 模型名稱、真實姓名、餘額或其他個資。
- PR 內文依 [PR template](./.github/PULL_REQUEST_TEMPLATE.md) 填寫，必填欄位與 [正式後端交接](./docs/DEVELOPMENT-HANDOFF.md) 的要求一致。

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
