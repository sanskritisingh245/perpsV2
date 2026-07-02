// Runs all four background loops in ONE Bun process (one runtime, one shared
// Prisma client) so it fits the 512MB instance. Spawning them as four separate
// processes blew past the memory ceiling (two of them load Prisma), and the old
// "kill everything if one child exits" logic turned any hiccup into a crash loop.
//
// Each module has its own Redis connections and an infinite consume loop. We
// fire them concurrently via dynamic import (ESM caches @repo/db, so Prisma is
// shared) and isolate failures so one loop dying doesn't take the others down.
const modules = [
  "./apps/matching-engine/index.ts",
  "./apps/db-worker/index.ts",
  "./apps/mark-price-service/index.ts",
  "./apps/snapshot-worker/index.ts",
];

for (const m of modules) {
  import(m).catch((e) => console.error(`[worker] ${m} crashed:`, e));
}

console.log(`[worker] started ${modules.length} loops in one process`);

// The consume loops never resolve, so the event loop stays alive on its own;
// this is just a backstop so the process doesn't exit even if every loop dies.
setInterval(() => {}, 1 << 30);
