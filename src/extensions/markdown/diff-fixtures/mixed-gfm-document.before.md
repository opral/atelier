# Launch review

Read the [runbook](https://example.com/runbook) and ping <ops@example.com>.

| Area | Owner | Status |
| ---- | ----- | ------ |
| API  | Dee   | Ready  |
| Web  | Mo    | Draft  |

- [x] Confirm launch owner
- [ ] Update docs
  - Keep migration note
  - Verify search index

```ts
export const rollout = "staged";
notify("ops");
```
