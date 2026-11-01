-- Additive/repeatable uniqueness on the live ORM identities, not legacy tables.
-- Existing duplicates must be reconciled before deployment; never delete users here.
-- Rollback application code first and retain these identity protections.
CREATE UNIQUE INDEX IF NOT EXISTS orm_users_email_key ON orm_rows ((lower(btrim(payload->>'email'))))
WHERE table_name = 'users' AND nullif(btrim(payload->>'email'), '') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orm_accounts_provider_subject_key ON orm_rows ((payload->>'provider'), (payload->>'providerSubject'))
WHERE table_name = 'accounts';
CREATE UNIQUE INDEX IF NOT EXISTS orm_email_binding_token_hash_key ON orm_rows ((payload->>'tokenHash'))
WHERE table_name = 'emailBindingTokens';
