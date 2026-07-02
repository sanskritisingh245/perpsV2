// Runs all four background loops inside ONE Render service (one paid worker
// instead of four). Each loop is spawned as its own child process so it keeps
// isolated Redis connections and its own crash domain — no code changes to the
// matching/settlement logic. If any child exits, we stop the rest and exit
// non-zero so Render restarts the whole service cleanly.
const targets = [
  "apps/matching-engine/index.ts",
  "apps/db-worker/index.ts",
  "apps/mark-price-service/index.ts",
  "apps/snapshot-worker/index.ts",
];

const procs = targets.map((path) =>
  Bun.spawn(["bun", "run", path], { stdout: "inherit", stderr: "inherit" }),
);

// They normally never exit; wait for the first one that does, then tear the
// rest down so the service restarts as a unit.
await Promise.race(procs.map((p) => p.exited));
console.error("a worker process exited — shutting the rest down for a clean restart");
for (const p of procs) p.kill();
process.exit(1);
