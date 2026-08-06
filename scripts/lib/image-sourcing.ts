/**
 * Image sourcing moved to src/lib/control/image-sourcing.ts (Session 1): the
 * intake pipeline now calls it from the app on the control role, and the D17
 * one-implementation rule means the CLI and seed share that exact module.
 * This re-export keeps the scripts' import path stable.
 *
 * Note the role change that came with the move: DB access is
 * DATABASE_URL_CONTROL (curbside_control), no longer the owner role.
 */
export * from "../../src/lib/control/image-sourcing";
