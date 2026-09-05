# Project continuity

## Start of each task

1. Read [memory.md](memory.md) before planning or changing this project. It records current progress, verified checks, known issues, and the next implementation step.
2. Check the actual files and Git status before relying on recorded state. Runtime availability and historical test results can become stale.
3. For implementation, read the relevant requirements in [prd.md](prd.md), [architecture.md](architecture.md), [rules.md](rules.md), and the active phase in [phases.md](phases.md). These define the product and gates; memory records progress against them.
4. Follow the user's current request. A next-step entry in memory is context, not authorization to begin unrelated work. Current user instructions take precedence over these repository instructions and historical notes.

## Save progress

- Update `memory.md` after a meaningful milestone and before finishing any task that changes implementation, decisions, validation results, phase status, or blockers.
- Record the date, concrete changes, relevant file paths, commands/checks actually run and their outcomes, remaining work, and a precise next step.
- Distinguish complete, partial, blocked, and unverified work. Mark a phase complete only after its required gate passes; never present setup checks or empty suites as passing product tests.
- Keep current status concise and replace stale statements when resolved. Preserve useful decisions and pitfalls; link to detailed documents instead of copying transcripts or logs.
- When a phase status changes, update `phases.md` and `docs/task-board.md` in the same change. Update the README if its summary becomes stale.
- Record commit or branch information only when verified. Do not invent a commit or claim uncommitted work is saved in Git history.
- Never save secrets, tokens, real environment values, credentials, raw proofs/nullifiers, personal data, or unsanitized logs in memory.
- During delegated work, the coordinating agent owns the final memory update. Re-read the file before editing and preserve other contributors' changes.

For a read-only answer that discovers no new project state, a memory edit is unnecessary. If a memory update cannot be written, disclose that limitation in the handoff.
