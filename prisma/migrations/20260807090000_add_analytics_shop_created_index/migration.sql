-- Composite index matching the shape every analytics read actually uses: one shop, a trailing
-- time window, optionally narrowed to a set of event types.
--
-- Before this, the funnel/revenue/trend/per-racquet queries had no index that covered
-- (shopId, createdAt): Postgres either walked the shop's entire event history via
-- Analytics_shopId_eventType_idx and threw away everything older than the window, or walked every
-- shop's events in the window via Analytics_createdAt_idx. Both costs scale with how long the
-- configurator has been live, which is why the admin degraded over time instead of being slow
-- from the start.
--
-- IF NOT EXISTS so re-running against a database where this was already applied by hand is a
-- no-op rather than a failed deploy.
CREATE INDEX IF NOT EXISTS "Analytics_shopId_createdAt_eventType_idx"
  ON "Analytics"("shopId", "createdAt", "eventType");
