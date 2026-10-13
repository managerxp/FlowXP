# FlowXP gym devices: the integration contract

For the person connecting a QR reader, RFID/NFC reader, turnstile or access controller to FlowXP. Only the **generic signed-HTTP adapter** exists. There is no adapter for any
particular vendor's hardware, because none has been built against that vendor's documentation and a real device. If your hardware cannot sign an HTTPS request, it needs a small
bridge (a Raspberry Pi, a controller's scripting hook, a vendor SDK service) that speaks this contract. **Nothing in this document has been run against real gate hardware.**

## The model

A device is a *client*. It never holds the member list. It asks FlowXP "may this credential come in?", gets a decision, and acts on it.

```
reader --(signed request: credential)--> FlowXP --(decision + command id)--> reader --(opens the gate)--> reader --(signed ack)--> FlowXP
```

Three things are kept separate, so a failure in one can be reconciled:

1. **The decision** (APPROVED or DENIED, with a reason code). Recorded in `gym_access_events`, together with the visit when approved, in one transaction.
2. **The gate command** ("open"). Recorded in `gym_gate_commands`, one per approved decision, however many times the same event is sent.
3. **The acknowledgement** (did the gate really open). Recorded when the device says so. A command with no acknowledgement after two minutes is marked `TIMED_OUT` and shown to the manager.

**Fail closed.** If the request fails, times out, is refused or answered late, the gate stays shut. Open only on an approved answer received over a successful, timely, signed exchange.
FlowXP never says "yes" for a device that could not reach it. If the database is down FlowXP answers `503 SERVICE_UNAVAILABLE` and records nothing.

## Registering a device

A manager registers it in *Gym settings > Devices* (or `POST /api/gym/devices`) and receives, **once**, a `key_id` (`gd_...`) and a `secret`. FlowXP stores the secret encrypted and cannot show it
again; if it is lost, rotate it. A device belongs to one branch and decides only for that branch. Set `ENCRYPTION_KEY` in production (see DEPLOY.md): without it the secret is encrypted under a key derived from `JWT_SECRET`.

## Signing a request

Every request carries three headers:

| Header | Value |
|---|---|
| `X-Device-Key` | the `key_id` |
| `X-Device-Timestamp` | the current unix time in seconds |
| `X-Device-Signature` | lowercase hex `HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path>.<sha256-hex of the exact body bytes>")` |

`<path>` is the request path without the query string, as sent (for example `/api/device/v1/access`). For a request with no body, hash the empty string. Sign the exact bytes you send.

A request more than **120 seconds** old, or from the future, is refused. A bad signature, an unknown key, a switched-off device, a business that is not active and a plan without the devices feature
all return the same `401 {"success":false,"message":"Not authorised"}`, so nothing leaks about which one it was.

Use HTTPS. The signature stops forgery and replay of a stolen request, not eavesdropping.

## Endpoints (base path `/api/device/v1`)

### `POST /access`: someone presented a credential

```json
{ "event_id": "reader1-20261012-000123", "credential": "FXG1.xxxxxxxx...", "action": "IN", "occurred_at": "2026-10-12T04:30:00Z" }
```

* `event_id`: **required**, 8 to 64 characters of `A-Z a-z 0-9 . _ : -`, unique per device. It is the idempotency key: send the same id again (a retry after a timeout) and you get the first answer, one visit, one command.
* `credential`: the QR text read from a printed card (`FXG1.<token>`) or a member's phone pass (`FXD1.<token>`). Pass it through unchanged. Do not log it.
* `action`: `IN` (default) or `OUT`.
* `occurred_at`: optional. Recorded; **never used for the live decision**, which uses FlowXP's clock.

Answer (`200`):

```json
{ "success": true, "data": { "decision": "APPROVED", "reason": "APPROVED", "message": "Welcome in", "open": true, "event_id": "reader1-...", "command_id": 4812, "replayed": false } }
```

A refusal is also `200`, with `"open": false`, `"command_id": null` and a `reason` (below). The answer never names the member. `503` means FlowXP could not decide: keep the gate shut and retry with the same `event_id`.

Reason codes: `APPROVED`, `INVALID_CREDENTIAL`, `CREDENTIAL_REVOKED`, `CREDENTIAL_EXPIRED`, `MEMBER_NOT_FOUND`, `NO_MEMBERSHIP`, `MEMBERSHIP_NOT_STARTED`, `MEMBERSHIP_EXPIRED`, `MEMBERSHIP_FROZEN`,
`MEMBERSHIP_SUSPENDED`, `PAYMENT_REQUIRES_ATTENTION`, `BRANCH_NOT_ALLOWED`, `ACCESS_OUTSIDE_ALLOWED_HOURS`, `DUPLICATE_SCAN`, `VERIFICATION_REQUIRED`, `NOT_CHECKED_IN`, `ACTION_NOT_ALLOWED`, `DEVICE_NOT_AUTHORIZED`, `SERVICE_UNAVAILABLE`.
Show the person a plain message, not the code.

A phone pass QR is single use and lives about a minute. A printed card can be shown by anyone holding it; FlowXP ignores a second read within a few seconds, and asks for a person to look when the same card appears at two branches within minutes.
A device cannot supply that human confirmation, so such a scan is simply refused (`VERIFICATION_REQUIRED`).

### `POST /ack`: the gate did (or did not) open

```json
{ "command_id": 4812, "result": "OPENED" }
```

`result` is `OPENED`, `NOT_PASSED` (opened, nobody went through) or `FAILED`. The first answer stands; a later `FAILED` does not overwrite an `OPENED`. An acknowledgement that arrives after the two-minute timeout is still accepted.

### `POST /heartbeat`: I am alive

```json
{ "firmware": "1.4.2", "status": "ok", "queued_events": 3 }
```

Send every minute or so. A device not heard from for three minutes shows as offline. Only those three fields are kept.

### `POST /events/batch`: events I handled while offline

Only for a device registered with the offline policy **REPORT_ONLY**; any other device gets `403`. A device with the default policy (`NONE`) must never open without an answer.

```json
{ "events": [ { "event_id": "reader1-...", "credential": "FXG1...", "action": "IN", "occurred_at": "2026-10-12T04:12:00Z" } ] }
```

At most 200 events; every event must be valid or the whole batch is refused. FlowXP applies them oldest first, each at most once (by `event_id`), and judges each **as it would have been then**: the card as it stood at that moment (a card cancelled afterwards was valid when used),
the membership against the gym's local day and hours at that moment, and a membership cancelled after the event as still counting. Times older than 48 hours are treated as 48 hours ago and times in the future as now, so a wrong clock cannot back-date a visit by weeks.
Two readings of one card close together count once, whichever arrives first.

An event that should not have been let in is recorded as refused with `already_admitted`, never counted as a visit, and listed for the manager under *Things to look at*. Each valid visit starts `PROVISIONAL` and becomes `CONFIRMED` when the batch has been processed; a sync cut off midway leaves provisional visits that a later reconcile confirms. Sending the whole batch again duplicates nothing.

Limits you should know: payment state is judged on the invoice as it is now, not as it was then; a member put on hold after the event counts against it (there is no history of that).

## Rotating the secret

*Rotate secret* makes a new one. The old one keeps working for **24 hours** so a fleet can be updated without a gap; choose *End it now* if the old secret may have leaked. Switching a device off ends its access at once.

## Writing a new adapter

An adapter's job is only to turn a vendor's payload into the one normalised request above (`event_id`, `credential`, `action`, `occurred_at`) and to turn the answer into what the vendor's device expects. Add it to `ADAPTERS` in `backend/src/modules/gym/devices.js`, with its vendor's documentation,
a test against that vendor's real payloads, and a device to try it on. RFID/NFC readers need a credential type for card UIDs, which does not exist yet: today every credential is a QR token.
