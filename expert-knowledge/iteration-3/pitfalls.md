# Pitfalls — Iteration 3

## Accessing HTTP headers in Resource classes

To read request headers or set response headers from within a Resource
method, use `this.getContext()`:

```js
async get(target) {
  const context = this.getContext();

  // Example: validate a custom API key header
  const apiKey = context.headers.get('x-api-key');
  if (!apiKey || !(await this.validateKey(apiKey))) {
    return { status: 401, headers: {}, data: { error: 'Invalid API key' } };
  }

  // Example: set custom response headers
  context.responseHeaders.set('x-request-id', crypto.randomUUID());

  return await super.get(target);
}
```

You can also set response headers via `context.responseHeaders.set()`.

**Note on ETags/caching:** Harper handles ETags and 304 responses
automatically using record timestamps. Do NOT implement custom ETag
logic — Harper already does this at the platform level. Use
`getContext()` only when you need access to custom headers that Harper
doesn't handle automatically (auth tokens, API keys, rate limit
tracking, content negotiation, etc.).

## MQTT publishing from Resource classes

To publish messages from within a Resource class, use the table's
`publish()` method — NOT a bare `publish()` call:

```js
// CORRECT — publish via the table class (target first, message second)
await tables.Alert.publish('alerts/critical', alertData);

// WRONG — bare publish() does not exist
await publish('alerts/critical', alertData);
```

The `tables.X.publish()` method sends a message to the MQTT topic.
Subscribers listening on that topic will receive it in real-time.

## Harper does NOT have atomic conditional writes

Harper has ACID transactions (via the `transaction()` global), but they
are non-locking and use last-write-wins semantics. There are no row-level
locks or compare-and-swap operations. A read-check-write pattern like this
is vulnerable to TOCTOU (time-of-check-time-of-use) race conditions:

```js
// UNSAFE — another request can claim the seat between read and write
const seat = await tables.Seat.get(seatId);
if (seat.status === 'available') {
  await tables.Seat.put({ ...seat, status: 'held' });  // RACE!
}
```

If your assignment requires concurrent safety (e.g., two users buying
the same seat), acknowledge this as a platform limitation. Implement
the best-effort pattern above but note in comments that it is not
truly atomic. Do NOT try to implement locking via a separate lock
table — this has the same TOCTOU problem.

## Harper handles ETags and 304s automatically

Harper automatically generates ETags from record timestamps and returns
304 Not Modified for conditional requests. You do NOT need to implement
this yourself. If your assignment mentions caching or ETags, the correct
approach is to rely on Harper's built-in behavior — not to build custom
ETag generation.

## Lazy expiry pattern (preferred over batch scanning)

When implementing time-based expiry (e.g., seat holds that expire after
5 minutes), prefer lazy per-record checking over batch scanning:

```js
// GOOD — check and release on every access, O(1) per record
async function releaseIfExpired(record) {
  if (record.status === 'held' && record.holdExpiry < Date.now()) {
    await tables.Seat.patch(record.id, { status: 'available' });
    return { ...record, status: 'available' };
  }
  return record;
}
```

This is better than scanning all held records on each request. Call it
in your get() and patch() handlers so expired records are released on
touch. No background process or cron needed.

## PATCH merges, PUT replaces

Harper's PATCH operation merges the provided fields into the existing
record — it does NOT replace the entire record. Use PATCH when updating
specific fields, and PUT when replacing the full record. This follows
standard REST semantics.

## Don't skip requirements

The assignment may embed requirements in a client quote or scenario
description. Read the ENTIRE assignment carefully. Verify ALL pass
criteria before running `gt done`. Do not submit until every
criterion is met.