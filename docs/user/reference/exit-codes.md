# Reference: Exit Codes

Goli-CLI follows Unix exit-code conventions. CI pipelines should treat
non-zero exits as failures.

| Code | Name                      | Meaning                                                                                           |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| 0    | `SUCCESS`                 | The run completed successfully.                                                                   |
| 1    | `RUNTIME_ERROR`           | A runtime error occurred (provider failure, tool error, etc.). See the error message for details. |
| 2    | `USAGE_ERROR`             | Invalid CLI usage (unknown flag, missing required arg, malformed prompt).                         |
| 3    | `CONFIG_ERROR`            | The config file is invalid (TOML parse error, schema validation failure).                         |
| 4    | `SANDBOX_ERROR`           | The sandbox could not be initialized (missing kernel feature, permission denied).                 |
| 5    | `POLICY_VIOLATION`        | A policy file failed integrity check (SHA-256 mismatch).                                          |
| 6    | `SBOM_VIOLATION`          | The SBOM check found a forbidden dependency.                                                      |
| 7    | `AUDIT_LOG_ERROR`         | The audit log could not be written (disk full, permission denied, tamper detected).               |
| 8    | `PROVIDER_AUTH_ERROR`     | The provider returned 401/403 (bad API key).                                                      |
| 9    | `PROVIDER_RATE_LIMIT`     | The provider returned 429 after all retries.                                                      |
| 10   | `CONTEXT_WINDOW_EXCEEDED` | The context window was exceeded and compaction failed.                                            |
| 11   | `LOOP_DETECTED`           | The loop detector fired and the run was aborted.                                                  |
| 12   | `STALL_DETECTED`          | The stall detector fired (no token for 30s) and the run was aborted.                              |
| 13   | `CANCELLED_BY_USER`       | The user pressed Ctrl-C.                                                                          |
| 14   | `CANCELLED_BY_TIMEOUT`    | The `--timeout-ms` was reached.                                                                   |
| 20   | `EVAL_REGRESSION`         | (evals only) A regression was detected vs. the baseline.                                          |
| 30   | `MCP_SERVER_ERROR`        | An MCP server failed to start or crashed.                                                         |
| 130  | `SIGINT`                  | The process received SIGINT (Ctrl-C). Same as `CANCELLED_BY_USER` but at the shell level.         |
| 137  | `SIGKILL`                 | The process was killed (OOM, manual `kill -9`).                                                   |
| 143  | `SIGTERM`                 | The process received SIGTERM (graceful shutdown).                                                 |

## CI recipes

### Treat any non-zero as failure (default)

```bash
goli -p "..." --headless-output json
# exit code propagates to the CI runner
```

### Distinguish "real" errors from "user" errors

```bash
goli -p "..." --headless-output json
exit_code=$?

if [ $exit_code -eq 0 ]; then
  echo "Success"
elif [ $exit_code -eq 13 ] || [ $exit_code -eq 14 ]; then
  echo "Cancelled (not a failure)"
  exit 0
elif [ $exit_code -ge 2 ] && [ $exit_code -le 7 ]; then
  echo "Config / environment error — fix and re-run"
  exit $exit_code
else
  echo "Runtime error — see logs"
  exit $exit_code
fi
```

### Fail fast on auth errors

```bash
goli -p "..." --headless-output json
if [ $? -eq 8 ]; then
  echo "::error::Provider auth failed — check your API key"
  exit 1
fi
```

## Headless JSON output

In headless mode (`--headless-output json`), the exit code is also
available in the JSON output:

```json
{
  "runId": "...",
  "exitCode": 1,
  "error": "Provider returned 429 after 5 retries"
}
```

Always check the JSON `exitCode`, not the shell exit code, when
parsing headless output — they should match, but the JSON is the
authoritative source.

## See also

- [Reference: CLI flags](cli-flags.md)
- [ADR 0043](../../decisions/0043-headless-structured-output.md) —
  headless mode design.
