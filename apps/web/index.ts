import index from "./src/index.html";

// The Express backend has no CORS, so the browser talks only to this server.
// Everything under /api/* is transparently proxied to the backend, which keeps
// the JWT Authorization header intact (the backend expects the raw token).
// BACKEND_URL may arrive without a scheme (Render's internal host:port), so
// normalize it. PUBLIC_WS_URL is the ws-server's public URL, handed to the
// browser via /config (the ws-server runs on its own host in prod).
const rawBackend = process.env.BACKEND_URL || "http://localhost:3000";
const BACKEND = rawBackend.startsWith("http") ? rawBackend : `http://${rawBackend}`;
const WS_URL = process.env.PUBLIC_WS_URL || "ws://localhost:8080";
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5173);

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/*": async (req) => {
      const url = new URL(req.url);
      const target = BACKEND + url.pathname + url.search;
      try {
        const res = await fetch(target, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        });
        // Re-wrap so we control the headers we hand back to the browser.
        return new Response(res.body, { status: res.status, headers: res.headers });
      } catch {
        return Response.json({ success: false, error: "BACKEND_UNREACHABLE" }, { status: 502 });
      }
    },
    "/config": () => Response.json({ wsUrl: WS_URL }),
    "/": index,
  },
  development: isProd ? false : { hmr: true, console: true },
});

console.log(`web   → http://localhost:${server.port}`);
console.log(`proxy → ${BACKEND} (api)`);
