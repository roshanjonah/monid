# Sendmux connector non-production coverage

Goal: qualify Row 06 endpoint ownership and resource lifecycle without a live
credential, delivery, charge, deployment or upstream connector submission.

This candidate changes tests and CI only. The connector, engine, resource ABI,
lockfile, native limits and existing assertions are unchanged.

## Coverage and execution

- `connectors/sendmux/endpoint-contract.test.ts`: 18 tests run sealed endpoints
  through the real engine, covering the remaining native routes, selectors,
  bodies, output, caps and before-IO ownership denial.
- `connectors/sendmux/resources/mailbox/resource.test.ts`: seven added tests
  cover verify/refresh/release outcomes and all cumulative cost lines, including
  repeated/post-release reads, exact windows, finality, amounts and failures.
- `connectors/sendmux/event-contract.test.ts`: three tests cover compiled event
  routing and independently constructed native signatures, exact raw bytes,
  freshness and invalid envelopes.
- `connectors/sendmux/lifecycle-contract.test.ts`: two tests use the real
  disposable KV store, reopen persisted ownership, stop released actions and
  retain the authorised row for teardown and final readings. Each test closes
  the store, removes its exact temporary directory and verifies absence.

`scripts/test-sendmux-regressions.ts` temporarily introduces isolated
regressions and restores source in `finally`. Eight stages must execute failing
tests: ownership (18), persistence (2), verify (1), refresh (1), release (1),
meters (4), event routing (1) and native signature prefix (2). Compiler
failures, empty summaries and ignored required tests cannot satisfy red
evidence. The final focused Sendmux suite must pass with zero ignores on
restored product source.

The draft PR's CI logs and `sendmux-regressions` artifact are the execution
receipts. CI runs on Ubuntu with Deno 2.5.2. Separate jobs run the whole-repo
typecheck/replay suite and format/lint, deterministic frozen double compilation,
identity/version guards and provider/endpoint/resource catalog inspection. The
workflow has no release, publication or deployment step.

## Acceptance boundary

These tests prove compiled connector behaviour against owned synthetic IO and
disposable persistence. They do not prove real delivery, production workspace
isolation, scheduled transport, raw binary streaming, remote teardown or host
once-only settlement. Coordinated release, real transport, commercial terms,
publication and final upstream submission remain with Ops Watch/coordinator.

Current run IDs, exit statuses, counts and failed-attempt receipts are recorded
in the private Row 06 return artifact:
`sendmux/.claude/artifacts/monid-readiness/brief-06-monid-connector-lifecycle/acceptance.md`.

Status: tests-only candidate; merge approval remains with Ops Watch.
