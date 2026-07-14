-- 003_control_schema_usage.sql
--
-- Session 1 revoked the public schema's default USAGE from PUBLIC and granted
-- it to curbside_app explicitly (least privilege). Every NEW role therefore
-- starts blind: table grants alone produce "relation does not exist", not
-- "permission denied" — a genuinely misleading error, hence its own migration
-- rather than a silent fix. curbside_control needs the same schema-level
-- USAGE its table grants (002) assume.

GRANT USAGE ON SCHEMA public TO curbside_control;
