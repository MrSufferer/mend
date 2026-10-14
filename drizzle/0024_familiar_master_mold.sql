-- History/action constraints were established by 0022; this index bounds per-invocation authority checks.
CREATE UNIQUE INDEX "operator_request_invocation" ON "operator_requests" USING btree ("invocation_id");
