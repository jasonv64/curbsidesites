-- 004_staff_fk_set_null.sql
--
-- Removing a staff account must never be blocked by (or cascade-delete) the
-- decision history that account produced. Decision rows keep their data and
-- null the staff pointer; the durable "who" lives in audit_log as an email.
-- (staff_sessions keeps ON DELETE CASCADE — sessions die with the account.)

ALTER TABLE pending_actions DROP CONSTRAINT pending_actions_decided_by_fkey;
ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_decided_by_fkey
  FOREIGN KEY (decided_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE alerts DROP CONSTRAINT alerts_resolved_by_fkey;
ALTER TABLE alerts ADD CONSTRAINT alerts_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE brand_proposals DROP CONSTRAINT brand_proposals_decided_by_fkey;
ALTER TABLE brand_proposals ADD CONSTRAINT brand_proposals_decided_by_fkey
  FOREIGN KEY (decided_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE consents DROP CONSTRAINT consents_recorded_by_fkey;
ALTER TABLE consents ADD CONSTRAINT consents_recorded_by_fkey
  FOREIGN KEY (recorded_by) REFERENCES staff_users(id) ON DELETE SET NULL;
