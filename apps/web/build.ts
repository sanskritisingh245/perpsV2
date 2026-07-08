// Static build of the SPA for hosting on Vercel (which can't run the Bun.serve
// server in index.ts). The /api proxy and /config that index.ts provided are
// replaced by vercel.json rewrites. Tailwind (globals.css @theme/@utility) is
// compiled via bun-plugin-tailwind.
import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

const outdir = "./dist";
await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir,
  plugins: [tailwind],
  minify: true,
  sourcemap: "none",
  // keep the HTML entry as index.html; hash the JS/CSS chunks for caching
  naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
});

if (!result.success) {
  console.error("BUILD FAILED");
  for (const m of result.logs) console.error(m);
  process.exit(1);
}

// The Bun.serve server exposed /config for the ws-server URL; on Vercel that
// becomes a static file (rewritten by vercel.json). Empty wsUrl → the client
// falls back gracefully (shows "Offline" until a ws-server URL is provided).
await Bun.write(`${outdir}/config.json`, JSON.stringify({ wsUrl: process.env.PUBLIC_WS_URL || "" }));

console.log(`built ${result.outputs.length} files -> ${outdir}`);
for (const o of result.outputs) console.log(" -", o.path.split("/").slice(-1)[0], o.kind);
