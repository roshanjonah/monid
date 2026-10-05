# Sendmux connector verification

Status: local source prepared; no upstream PR or live integration acceptance.

The connector adds 29 endpoints and the owned `sendmux/mailbox` resource. It
supports saved drafts, conditional revisions, reply/reply-all/forward,
scheduling, bounded message and thread reads, labels, attachments, attachment
text, webhook verification and retained mailbox cost windows. Authentication
uses a dedicated Sendmux integration credential; foreign mailbox IDs are
rejected before upstream requests.

## Offline verification

The stock 21-stage gate exited 0 on the reconciled source: formatting, lint,
frozen type checks, replay, two deterministic compiles, identity checks and
catalog inspection. Cached replay: 1272 passed, 0 failed, 213 credential-gated
cases ignored. Ignored cases are not live acceptance. Both compiled catalogs
matched SHA256
`a2221cef10f1d3adf95fd8daade9482e453231592a58dce1f04b8f9d4537f1a4`.

Before staging this commit, a read-only guard verified all 3052 source paths,
modes, index, history, lockfile and pinned tool against the accepted snapshot.
Mode/byte seal:
`3c38b886c1a2c1eee2bcd00dcbae3f21831190566ed71189e3bc720fe19ec273`. No connector
runtime source changed after that gate. This evidence note does not enter the
compiler's source inputs. The committed merge-base version gate must run after
the normal source commit; the earlier unchanged-HEAD check did not validate the
uncommitted connector.

## Identity reconciliation

The baseline workflows change formatting only; parsed workflow maps and run
commands remain identical. The sorted identity lock now matches the accepted
catalog: 728 endpoint identities and 2 resources. In addition to the Sendmux
entries, it registers 69 existing endpoints and seven replacement identities.
The following seven retirements preserve the existing upstream parity names;
published legacy-caller usage remains unverified.

| Retired identity            | Existing replacement                 |
| --------------------------- | ------------------------------------ |
| bytedance#seedance-2.0      | bytedance#v1/video/seedance-2.0      |
| bytedance#seedance-2.0-fast | bytedance#v1/video/seedance-2.0-fast |
| bytedance#seedance-2.0-mini | bytedance#v1/video/seedance-2.0-mini |
| bytedance#seedance-2.5      | bytedance#v1/video/seedance-2.5      |
| fundable#deal               | fundable#deals/{id}                  |
| fundable#deal/investors     | fundable#deals/{id}/investors        |
| suzanne#v1/models/download  | suzanne#v1/models/{job_id}/download  |

## Submission gates

Matching Sendmux APIs must be deployed and the dedicated-credential lifecycle,
draft/thread/send/schedule/release and final-cost journeys accepted. Monid
credit mapping, resource periods, cutoff/retry behaviour and late final
settlement need the host agreement recorded in the OpenSpec tasks. Offline
replay does not establish these facts or final listing.

Local bulk evidence:
`.claude/artifacts/monid-sendmux/upstream-baseline-applied-current-20261003/`.
That directory is machine-local and is excluded from the source commit.
