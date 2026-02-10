# Sling Args Template

Standard instructions the Mayor should include when slinging assignments
to polecats. Copy the relevant sections into sling args.

## Required (always include)

```
Assignment: <assignment-filename>.md

Harper REST API: http://localhost:<REST_PORT>
Harper Ops API: http://localhost:<OPS_PORT>
Harper MQTT: localhost:<MQTT_PORT>
Auth: admin / password

Your component files MUST be written to: .workers/worker-<N>/components/<component-name>/
This directory is mounted into the running Harper container. Files written elsewhere will NOT
be deployed to Harper and will be lost on exit.

Verify ALL pass criteria before running 'gt done'. Do not submit until every criterion is met.
When implementation is complete and all criteria verified, immediately run 'gt done' to submit
and exit. Do not wait at the prompt.
```

## Expert Knowledge (include when iteration > 0)

```
Expert hints are available. Read and apply the guidance in:
expert-knowledge/current/pitfalls.md

These hints address known documentation gaps and platform limitations
discovered in previous runs. Follow them closely.
```

## Tier-Specific Notes

### Tier 5+ (Caching)
```
For HTTP caching: use this.getContext() to access request/response headers
in Resource class methods. See expert-knowledge/current/pitfalls.md for
the ETag/304 pattern.
```

### Tier 4+ (MQTT)
```
For MQTT publishing from Resource classes, use tables.TableName.publish()
— NOT a bare publish() call. The table must have @export in the schema
to define the MQTT topic.
```

### Tier 6+ (Concurrency)
```
Harper does not support atomic conditional writes, transactions, or
row-level locks. For concurrent access patterns, implement read-check-write
with appropriate status validation. Acknowledge in code comments that this
is a best-effort pattern vulnerable to TOCTOU races under true concurrent load.
```
