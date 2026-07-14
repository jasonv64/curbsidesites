import { runAllJobs } from "@/lib/control/jobs";
import { getStaffSession } from "@/lib/control/staff-auth";

/**
 * POST /api/jobs/run — the scheduled-jobs trigger (Parts 2.5, 4, 5).
 * Locally: `npm run jobs`. Production: a timer trigger hits this with
 * CRON_TOKEN (Session 4). Also accepts a logged-in staff session so the
 * dashboard's "Run checks now" button works.
 */
export async function POST(req: Request) {
  const token = process.env.CRON_TOKEN;
  const auth = req.headers.get("authorization");
  const byToken = Boolean(token && auth === `Bearer ${token}`);
  const staff = byToken ? null : await getStaffSession();
  if (!byToken && !(staff && staff.mfa_ok)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runAllJobs();
  return Response.json(summary);
}
