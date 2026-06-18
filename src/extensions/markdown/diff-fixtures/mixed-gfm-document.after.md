# Launch review

Read the [runbook](https://example.com/runbook-v2) and ping <ops@example.com>.

| Area    | Owner | Status   |
| ------- | ----- | -------- |
| API     | Dee   | Ready    |
| Web     | Mo    | Approved |
| Billing | Ada   | Watching |

- [x] Confirm launch owner
- [x] Update docs
  - Keep migration note
  - Verify search index
  - Add rollback note

```ts
export const rollout = "global";
notify("ops");
notify("support");
```
