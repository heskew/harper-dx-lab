# Assignment: Notification Hub

## Overview

Build a real-time notification system using Harper's messaging capabilities.
Users create channels, post notifications, and subscribe to real-time updates.
This assignment tests MQTT pub/sub, WebSocket connections, the Resource class
`subscribe()`, `publish()`, and `connect()` methods, and real-time data flow.

## Requirements

1. **Data model**: Two tables:

   **Channel**
   - Name (required, unique)
   - Description (optional)
   - Created timestamp

   **Notification**
   - Title (required)
   - Body (required)
   - Severity (enum: "info", "warning", "critical")
   - Channel reference (foreign key, indexed)
   - Read (boolean, default false)
   - Created timestamp

2. **Relationships**:
   - A Channel has many Notifications (one-to-many via `@relationship`)
   - A Notification belongs to one Channel (many-to-one)

3. **Standard REST operations**:
   - CRUD for Channels
   - CRUD for Notifications
   - List notifications in a channel (nested query)
   - Filter notifications by severity
   - Filter notifications by read/unread status
   - Mark a notification as read (PATCH)

4. **Real-time features** (the core of this tier):

   a. **Publish on creation**: When a new notification is created via POST,
      it should be automatically published to subscribers of that channel.
      Override the `post()` method to call `publish()` after saving.

   b. **Subscribe to a channel**: Clients should be able to subscribe to
      a channel and receive real-time updates when new notifications arrive.
      Override the `subscribe()` method on the Notification resource to
      filter by channel.

   c. **WebSocket connection**: Implement a `connect()` method on the
      Notification resource that accepts a WebSocket connection and streams
      notifications to connected clients. The connect method should return
      an async iterable of messages.

   d. **MQTT publish**: When a "critical" severity notification is created,
      also publish it to an MQTT topic `alerts/{channelName}` so external
      systems can subscribe to critical alerts.

5. **Testing real-time**:
   You must demonstrate real-time works by:
   - Using an MQTT client (e.g. `mqtt` npm package) to subscribe to a
     topic, then creating a notification via REST, and showing the
     subscriber receives it
   - OR using a WebSocket client to connect, then creating a notification,
     and showing the connection receives it
   - Show that publishing a critical notification triggers the alert topic

6. **Constraints**:
   - Use Harper as both your database AND application server
   - Do NOT use Express, Fastify, or any external HTTP framework
   - Do NOT use external message brokers — use Harper's built-in MQTT
   - Custom logic MUST use Harper's Resource class API (`resources.js`)
   - Schema defined in `schema.graphql`
   - MQTT must be enabled in `config.yaml`

## Configuration

MQTT must be enabled in your `config.yaml`:
```yaml
mqtt:
  network:
    port: 1883
```

WebSocket connections go through the standard HTTP port (9926).

## Resources

- Harper documentation: https://docs.harperdb.io
- Real-time docs: https://docs.harperdb.io/docs/developers/real-time
- Resource class reference: https://docs.harperdb.io/docs/reference/resources
- Your Harper instance is running at: `http://localhost:9926`
- Operations API (for admin): `http://localhost:9925`
- Auth credentials: `admin` / `password`
- MQTT port: `1883` (once enabled in config)

## What to Deliver

1. A working `schema.graphql` with Channel and Notification tables
2. A `resources.js` with custom Resource classes for real-time behavior
3. A `config.yaml` enabling MQTT
4. A test script demonstrating real-time message flow
5. Demonstrate all operations work including real-time delivery

## Pass Criteria

- [ ] Schema deployed with Channel and Notification tables
- [ ] `@relationship` correctly links Channel→Notifications
- [ ] Foreign key `channelId` indexed with `@indexed`
- [ ] Can CRUD channels
- [ ] Can CRUD notifications
- [ ] Can list notifications in a channel (nested query)
- [ ] Can filter notifications by severity
- [ ] Can filter by read/unread status
- [ ] Can mark notification as read (PATCH)
- [ ] Publishing a notification triggers real-time delivery to subscribers
- [ ] `subscribe()` or `connect()` method implemented on resource
- [ ] WebSocket or MQTT subscription receives notifications in real-time
- [ ] Critical notifications publish to `alerts/{channelName}` MQTT topic
- [ ] MQTT enabled in config.yaml
- [ ] Test script demonstrates end-to-end real-time flow
- [ ] Uses Harper Resource class — no Express/Fastify
- [ ] No external message broker — uses Harper's built-in MQTT
- [ ] No SQL — uses REST API and Resource API
