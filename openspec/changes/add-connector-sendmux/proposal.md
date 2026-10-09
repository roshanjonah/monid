# Proposal: add-connector-sendmux

## Why

An agent needs one owned inbox it can read, reply from, and release. Sendmux
offers saved drafts, threaded replies, attachments, scheduled sending, and
customer-selected outgoing accounts. Monid must keep each workspace's inboxes
separate even though the Sendmux integration credential belongs to one team.

The Sendmux API supplies mailbox creation, deletion, and mailbox-scoped email
operations. Its retained cost meter is being completed alongside this connector.
A connector must never turn a pending or failed meter read into zero usage.

## What changes

- Add an owned `sendmux/mailbox` resource. Its external ID is the Sendmux
  mailbox public ID; its display identifier is the email address. Provisioning
  takes an explicit full email address, uses a dedicated integration credential,
  and stores no child mailbox secret.
- Bind every mailbox action to the owned resource before an upstream request.
  The resource ID selects the mailbox; user-supplied mailbox IDs cannot bypass
  Monid's ownership gate.
- Expose saved draft create, list, read, conditional edit, send, schedule,
  cancel, and delete. A draft can prepare a reply, reply-all, forward, or
  adoption from a message in the owned inbox. Sending names the exact saved
  revision.
- Expose bounded mailbox reads: messages, threads, search, changes, labels,
  attachments, raw message, and attachment text. Preserve pagination and
  body/attachment limits from the Sendmux API.
- Meter incoming email, outgoing email, and storage from the authoritative
  retained mailbox cost window. A resource lifecycle read requires a final
  window before settlement. Release waits for the final usage tail.
- Verify Sendmux webhooks using the timestamp and signature headers over the
  exact request body. Route each event to its owned mailbox; replayed delivery
  attempts keep the event ID.

## Capabilities

- `sendmux-connector`.

## Non-goals

- Linking an existing Sendmux inbox into a Monid workspace.
- Creating or editing a customer's sending provider connection.
- A second charge for a draft-send endpoint when the owned mailbox meter already
  accounts for the accepted email.
- Engine or resource ABI changes in this connector PR.

## Dependencies to verify before submission

- Sendmux deploys its integration credential and complete final cost meter.
- Monid confirms how its host waits for an incomplete final window, chooses the
  release cutoff, and applies a final usage reading without double charging an
  earlier reading. The public connector ABI does not prove those host rules.
- Sendmux and Monid agree the resource rate card and credit mapping. The
  connector must not invent a price from a Sendmux team invoice.
