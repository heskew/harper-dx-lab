# Pitfalls — Iteration 2

## Accessing HTTP headers in Resource classes

To read request headers or set response headers from within a Resource
method, use `this.getContext()`:

```js
async get(target) {
  const context = this.getContext();
  const ifNoneMatch = context.headers.get('if-none-match');
  
  // Return 304 for conditional requests
  if (ifNoneMatch === currentETag) {
    return { status: 304, headers: { 'ETag': currentETag } };
  }
  
  // Normal response with ETag
  const data = await super.get(target);
  return { data, headers: { 'ETag': newETag } };
}
```

You can also set response headers via `context.responseHeaders.set()`.

## MQTT publishing from Resource classes

To publish messages from within a Resource class, use the table's
`publish()` method — NOT a bare `publish()` call:

```js
// CORRECT — publish via the table class
await tables.Alert.publish(alertData, 'alerts/critical');

// WRONG — bare publish() does not exist
await publish(alertData, 'alerts/critical');
```

The `tables.X.publish()` method sends a message to the MQTT topic.
Subscribers listening on that topic will receive it in real-time.

## Harper does NOT have atomic conditional writes

Harper Resource classes do not support transactions, row-level locks,
or compare-and-swap operations. A read-check-write pattern like this
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

## Don't skip requirements

The assignment may embed requirements in a client quote or scenario
description. Read the ENTIRE assignment carefully. Verify ALL pass
criteria before running `gt done`. Do not submit until every
criterion is met.
