# Changenotes

Changenotes are release-note fragments for user-facing FlashType changes.

Add one Markdown file per change to this folder. Use a short descriptive filename, for example:

```text
.changenotes/fix-markdown-preview-crash.md
```

Use this format:

```md
---
type: patch
---

Fixed a crash when opening Markdown files with large tables.

FlashType now handles wide table layouts without freezing the editor.
```

## Fields

- `type` must be exactly one of `major`, `minor`, or `patch`.
- The body should be changelog-ready prose. Start with one clear summary sentence, then optionally add a short explainer paragraph.
- Write for the generated `CHANGELOG.md`: clear, intuitive, user-facing, and free of implementation noise unless it helps users understand the impact.

## When To Add One

Add a changenote for user-facing changes.

- Use `major` for breaking user-facing behavior changes.
- Use `minor` for backward-compatible user-facing capability additions.
- Use `patch` for user-facing fixes, compatibility fixes, and performance improvements.

Do not add a changenote for repo-only, documentation-only, CI-only, test-only, or chore-only changes.
