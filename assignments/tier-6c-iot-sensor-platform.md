# Assignment: Factory Sensor Platform

## The Scenario

A manufacturing company has a factory floor with sensors on their equipment.
They've been using a cobbled-together stack — InfluxDB for time-series,
Mosquitto for MQTT brokering, a Node.js API server, and Grafana for
dashboards. Four systems, four failure modes. They want one.

Here's the plant manager's requirements, relayed through their IT lead:

> "We have about 50 sensors right now, adding more every month. Each
> sensor publishes readings every 5 seconds — temperature, pressure,
> vibration, whatever it measures. That data comes in via MQTT because
> that's what the sensor firmware speaks.
>
> We need three things: store it, watch it, and query it.
>
> STORE IT: Every reading needs to be persisted. We keep 30 days of
> raw data, then we want hourly rollups for historical. The raw data
> volume is around 864,000 readings per day at current sensor count.
> It'll grow.
>
> WATCH IT: Each sensor has thresholds. If temperature exceeds 85°C or
> vibration goes above 4.5g, we need an alert. Not an email 5 minutes
> later — a real-time alert that shows up on the floor supervisor's
> dashboard within seconds. Alerts should be persisted too so we can
> review the history. Some sensors have multiple thresholds — warning
> level and critical level.
>
> QUERY IT: The dashboard needs current readings for all sensors (live
> view), historical charts for any sensor (last hour, last day, last
> week), and an alert log. The live view should update in real-time —
> when a new reading comes in, the dashboard value refreshes. No
> polling.
>
> We also need to register and manage sensors — add new ones, update
> thresholds, decommission old ones. Each sensor belongs to a zone
> (assembly line 1, paint booth, packaging, etc.) and has a type
> (temperature, pressure, vibration, humidity).
>
> One thing the old system couldn't do: detect trends. If a sensor's
> average temperature has been climbing over the last hour even though
> it hasn't hit the threshold yet, we want to know. Some kind of
> moving average or rate-of-change alert. The floor guys call it
> 'predictive' but really it's just basic math on recent data."

## No Other Instructions

Design the data model for sensors, readings, alerts, and zones. Implement
MQTT ingest, threshold alerting, historical queries, rollups, and the
live dashboard API.

Use Harper for everything — database, MQTT broker, application server,
real-time delivery. Nothing else.

Your Harper instance is at `http://localhost:9926`. Ops at
`http://localhost:9925`. Auth: `admin` / `password`. MQTT is available
on port 1883.

## Pass Criteria

- [ ] Data model handles sensors, zones, readings, thresholds, and alerts
- [ ] Sensors registered with type, zone, and configurable thresholds
- [ ] MQTT ingest — sensor readings received and persisted via MQTT subscribe
- [ ] Threshold checking on ingest — alerts generated in real-time
- [ ] Warning and critical alert levels supported
- [ ] Alerts persisted with sensor reference and reading that triggered them
- [ ] Live sensor view — current readings for all sensors, updates in real-time
- [ ] Historical queries — readings for a sensor over time (hour/day/week)
- [ ] Hourly rollup aggregation (min, max, avg per sensor per hour)
- [ ] Alert history log queryable by sensor, zone, severity, and time range
- [ ] Trend detection — flag sensors with rising averages before threshold breach
- [ ] Sensor CRUD — register, update thresholds, decommission
- [ ] No InfluxDB/external time-series database
- [ ] No Mosquitto/external MQTT broker
- [ ] No Express/Fastify/external frameworks
- [ ] No SQL
- [ ] Uses Harper for MQTT brokering, storage, and application logic
