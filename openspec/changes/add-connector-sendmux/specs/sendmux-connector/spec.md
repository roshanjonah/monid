# Sendmux connector specification

## Owned mailbox lifecycle

### Requirement: Provision an inbox under dedicated integration authority

The provider SHALL authenticate with one Sendmux integration credential scoped
to a dedicated team. Provision SHALL accept an explicit email address, call
`POST /mailboxes` with an idempotency key, and seed one owned `sendmux/mailbox`
resource from the returned public ID and email address. The connector SHALL NOT
request or return a child mailbox credential.

#### Scenario: Lost provision response

- **WHEN** the same Monid run retries after losing a successful response
- **THEN** Sendmux returns the same mailbox and Monid stores one owned resource

### Requirement: Gate mailbox actions before upstream calls

Every endpoint that reads, changes, or sends from an inbox SHALL bind to the
owned `sendmux/mailbox` resource. It SHALL use the bound public ID to select the
inbox for Sendmux mailbox API requests.

#### Scenario: Foreign mailbox

- **WHEN** a workspace calls a mailbox endpoint with another workspace's ID
- **THEN** Monid returns its uniform not-found result with no Sendmux request

### Requirement: Release remains retryable through final accounting

Release SHALL make the inbox unavailable for new Monid actions and drive Sendmux
deletion idempotently. A failed or incomplete final usage read SHALL remain
retryable; it SHALL NOT report a successful zero-cost settlement. Release SHALL
preserve the last authorised cost reading after the inbox is deleted.

#### Scenario: Delayed accepted delivery

- **WHEN** an admitted delivery has no final acceptance outcome at release
- **THEN** the final meter remains pending and no final zero is recorded

## Email workflows

### Requirement: Saved drafts preserve user intent

The connector SHALL expose `/mailbox/drafts` creation and listing, and
`/mailbox/drafts/{draftId}` read, conditional edit, and deletion. Create SHALL
support plain, reply, reply-all, forward, and existing-draft adoption. The
connector SHALL pass through To, Cc, Bcc, authorised From and Reply-To, subject,
text, HTML, custom headers, and attachment references within the published
Sendmux limits.

#### Scenario: Edit after another writer

- **WHEN** the caller supplies a stale `expected_revision`
- **THEN** the edit fails with conflict and the newer saved revision remains
  unchanged

### Requirement: Send the reviewed revision once

The connector SHALL expose revision-bound send and schedule control. An endpoint
retry SHALL use Sendmux's durable draft state and SHALL NOT make a second
accepted delivery or a second charge. The delivery endpoint itself SHALL have no
separate Monid usage line.

#### Scenario: Lost send response

- **WHEN** Sendmux accepted a send but Monid lost its response
- **THEN** retry reports the durable state of the same draft revision

### Requirement: Read mail through bounded mailbox endpoints

The connector SHALL expose Sendmux's scoped message, thread, search, change,
folder/label, attachment, raw-message, and attachment-text endpoints with their
native pagination and size limits. A read SHALL never enumerate another team's
or another Monid workspace's inbox.

#### Scenario: Message belongs to another inbox

- **WHEN** an owned inbox is selected but a message ID belongs elsewhere
- **THEN** Sendmux returns not-found and the connector does not retry it with
  broader authority

## Meter and events

### Requirement: Reconcile actual mailbox cost

The owned resource SHALL read a cumulative half-open cost window for incoming
email, outgoing email, and storage. It SHALL charge only reported posted cost,
preserve each line's identity, and fail rather than report zero when coverage,
source readings, posting, or finality is incomplete. Repeated reads of a final
window SHALL return the same amounts.

#### Scenario: Pending invoice

- **WHEN** accepted email or storage cost is incurred but not yet posted
- **THEN** the meter reports pending and Monid does not settle that window

### Requirement: Authenticate and route webhook events

The provider SHALL verify the separate Sendmux timestamp and v2 signature
headers against the exact request body, enforce freshness, and route each event
by an owned mailbox identifier. Retries SHALL preserve one event ID.

#### Scenario: Altered body

- **WHEN** the signed body is changed
- **THEN** verification fails before any resource or run is refreshed
