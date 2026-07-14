/**
 * Trigger the scheduled jobs against the RUNNING server (the jobs need the
 * app's adapters and cache context, so they run in-process via the route).
 * Usage: npm run jobs        (server must be up on :3000)
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

async function main() {
  const token = process.env.CRON_TOKEN;
  if (!token) throw new Error("CRON_TOKEN is not set (see .env.example)");
  const res = await fetch("http://127.0.0.1:3000/api/jobs/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`jobs run failed (${res.status}): ${JSON.stringify(body)}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  console.error("Is the server running? npm run dev (or npm start) first.");
  process.exit(1);
});
