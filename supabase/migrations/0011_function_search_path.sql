-- Lock down search_path on functions flagged by the Supabase security
-- advisor (function_search_path_mutable): without a fixed search_path, a
-- role that can create objects earlier in the session's search_path could
-- shadow an unqualified identifier these functions reference. submit_cart
-- already sets this explicitly in its own definition (0010); these three
-- were defined without it.

alter function set_updated_at() set search_path = public;
alter function is_admin() set search_path = public;
alter function create_member_holder() set search_path = public;
