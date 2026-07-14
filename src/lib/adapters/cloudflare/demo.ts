/**
 * Demo Custom Hostnames (D11: demo is also the failure mode). Simulates the
 * real flow: create → pending → active after a short soak, so the polling
 * job, the notifications, and the go-live flip can all be exercised locally.
 *
 * State is in-memory: created hostnames go active ~90s later. After a process
 * restart an unknown id reports active (the optimistic read keeps re-seeded
 * fleets from wedging in pending). Local-only behavior, noted in ASSUMPTIONS.
 */
import { randomBytes } from "node:crypto";
import type { CustomHostname, CustomHostnameProvider } from "./types";

const SOAK_MS = 90_000;
const created = new Map<string, number>(); // id → createdAt

function targets(hostname: string): CustomHostname["dns_targets"] {
  return [
    { type: "CNAME", name: hostname, value: "sites-origin.curbsidesites.com" },
    { type: "TXT", name: `_cf-custom-hostname.${hostname}`, value: `demo-${randomBytes(8).toString("hex")}` },
  ];
}

export const demoCustomHostnames: CustomHostnameProvider = {
  mode: "demo",
  async create(hostname) {
    const id = `demo-cf-${randomBytes(12).toString("hex")}`;
    created.set(id, Date.now());
    return { id, hostname, status: "pending", dns_targets: targets(hostname) };
  },
  async status(id, hostname) {
    const at = created.get(id);
    const active = at === undefined || Date.now() - at > SOAK_MS;
    return { id, hostname, status: active ? "active" : "pending", dns_targets: targets(hostname) };
  },
  async remove(id) {
    created.delete(id);
  },
};
