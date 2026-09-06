-- 0013's `revoke ... from anon` didn't actually change anything: Postgres
-- grants EXECUTE on new functions to the PUBLIC pseudo-role by default, and
-- every role (including `anon`) inherits PUBLIC's privileges regardless of
-- role-specific revokes. `authenticated` already holds its own direct
-- EXECUTE grant (from the original migration), which is independent of and
-- unaffected by revoking PUBLIC -- so this closes the anon path without
-- touching what admin RLS checks need.
revoke execute on function is_admin() from public;
