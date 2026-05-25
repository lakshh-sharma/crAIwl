-- Rollback for 0000_init.sql. Drop in dependency-respecting order
-- (FK children first, then parents). `IF EXISTS` keeps reruns idempotent.

DROP TABLE IF EXISTS "audit_event" CASCADE;
DROP TABLE IF EXISTS "fetch_attempt" CASCADE;
DROP TABLE IF EXISTS "extracted_record" CASCADE;
DROP TABLE IF EXISTS "crawl_run" CASCADE;
DROP TABLE IF EXISTS "strategy_config" CASCADE;
DROP TABLE IF EXISTS "crawl_job" CASCADE;
