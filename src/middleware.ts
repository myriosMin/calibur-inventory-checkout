import { NextResponse, type NextRequest } from "next/server";

import { getMiddlewareClient } from "@/lib/supabase/middleware-client";

/**
 * Auth gate for /admin/*. Only checks "is there a Supabase Auth session" --
 * NOT "is this session an admin". That distinction is RLS's job
 * (supabase/migrations/0009_rls_policies.sql's is_admin()), enforced at the
 * database on every query the admin browser client makes. A signed-in
 * non-admin would pass this middleware but get empty results/write failures
 * from every query.
 */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const supabase = getMiddlewareClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
