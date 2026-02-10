# Assignment: Event Ticketing System

## The Scenario

You've been hired to replace a failing event ticketing platform. The old
system was a monolith — Postgres, Redis, Express, RabbitMQ — and it went
down during a major on-sale event. The client wants to consolidate.

Here's what you know from the handoff meeting:

> "Events have a venue with sections and rows. Each seat is individually
> tracked — we can't oversell. When someone starts a checkout, the seats
> need to be held for 5 minutes so nobody else can grab them. If they
> don't complete the purchase, the seats release automatically.
>
> The browse experience needs to be snappy. People filter by date, venue,
> category (music, sports, comedy, etc.). The event detail page shows a
> seat map — which sections have availability, price by section, that
> kind of thing.
>
> We had a real-time waitlist feature that people loved. If an event sold
> out, you could join the waitlist and get notified the moment a seat
> opened up — either from a timeout release or a cancellation.
>
> The old system had separate services for inventory, checkout, and
> notifications. We want this all in one runtime. We had 4 Redis
> instances just for seat holds. Ridiculous.
>
> Our busiest on-sale had 2,000 people hitting the site simultaneously.
> Most of that is just browsing — maybe 200 concurrent checkouts. But
> those 200 checkouts all need to be correct. No double-selling."

## No Other Instructions

Figure out the data model, the API design, the real-time architecture,
the caching strategy, the seat hold mechanism, and the waitlist system.

Use Harper for everything. Nothing else.

Your Harper instance is at `http://localhost:9926`. Ops at
`http://localhost:9925`. Auth: `admin` / `password`. MQTT is available
on port 1883 if you need it.

## Pass Criteria

- [ ] Data model handles events, venues, sections, seats, and purchases
- [ ] Seat inventory is individually tracked (no overselling)
- [ ] Seat hold mechanism — seats reserved during checkout with automatic timeout release
- [ ] Hold expiry works (seats become available again after timeout)
- [ ] Browse API with filtering (date, venue, category)
- [ ] Event detail shows availability by section with pricing
- [ ] Waitlist — users can join when event is sold out
- [ ] Waitlist notification when seats open up (via real-time messaging)
- [ ] Concurrent checkout safety — demonstrate two simultaneous purchases for the same seat don't both succeed
- [ ] Cache strategy for browse/listing endpoints
- [ ] No Express/Fastify/external frameworks
- [ ] No Redis/external cache or queue
- [ ] No SQL
- [ ] Uses Harper Resource class for all custom behavior
- [ ] All in one Harper runtime
