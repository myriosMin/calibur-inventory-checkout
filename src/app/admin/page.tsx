import DashboardClient from "./DashboardClient";

/**
 * /admin -- the dashboard architecture.md §Observability specifies.
 *
 * The section link grid that used to sit under the numbers is gone: the
 * sidebar is always there now and does that job.
 *
 * The page is a client component: every /admin read goes through the anon
 * browser client and RLS's is_admin(), so a server component has nothing
 * to fetch here (it has no admin session of its own).
 */
export default function AdminHomePage() {
  return <DashboardClient />;
}
