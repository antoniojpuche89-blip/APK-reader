// Lextory server-side proxy for the public Gutendex catalogue.
const ALLOWED_ORIGINS = new Set(["https://antoniojpuche89-blip.github.io"]);
const ALLOWED_QUERY_KEYS = new Set(["search", "languages", "mime_type", "copyright", "sort", "topic", "page"]);
const RATE_LIMIT = 45;
const WINDOW_MS = 5 * 60 * 1000;
const recentRequests = new Map<string, { count: number; since: number }>();

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://antoniojpuche89-blip.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, accept, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}
function expectedPublishableKey(): string {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try { const parsed = JSON.parse(raw); if (typeof parsed.default === "string") return parsed.default; }
    catch { throw new Error("Supabase publishable key configuration is invalid."); }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}
function withinRateLimit(req: Request): boolean {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now(), current = recentRequests.get(ip);
  if (!current || now - current.since > WINDOW_MS) { recentRequests.set(ip, { count: 1, since: now }); return true; }
  if (current.count >= RATE_LIMIT) return false;
  current.count += 1; return true;
}
function safeQuery(incoming: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of incoming.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 180) continue;
    if (key === "sort" && !["popular", "ascending", "descending"].includes(trimmed)) continue;
    if (key === "copyright" && !["true", "false", "null", "true,false", "false,null"].includes(trimmed)) continue;
    if (key === "languages" && !/^[a-z]{2}(,[a-z]{2}){0,8}$/i.test(trimmed)) continue;
    if (key === "page" && (!/^\d{1,6}$/.test(trimmed) || Number(trimmed) < 1)) continue;
    result.set(key, trimmed);
  }
  return result;
}
Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405, headers: cors });
  const expected = expectedPublishableKey();
  if (!expected || req.headers.get("apikey") !== expected) return Response.json({ error: "Invalid application key." }, { status: 401, headers: cors });
  if (!withinRateLimit(req)) return Response.json({ error: "Too many catalogue requests. Try again shortly." }, { status: 429, headers: { ...cors, "Retry-After": "60" } });

  const params = safeQuery(new URL(req.url).searchParams);
  const upstreamUrl = new URL("https://gutendex.com/books/");
  params.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 11000);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET", redirect: "follow", signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LextoryCatalogue/1.0)",
        "Referer": "https://www.gutenberg.org/",
      },
    });
    if (!upstream.ok) {
      const status = upstream.status;
      const message = status === 403 ? "Gutendex está bloqueando temporalmente esta consulta (HTTP 403)."
        : status === 429 ? "Gutendex ha limitado temporalmente las consultas (HTTP 429)."
        : "Gutendex respondió con HTTP " + status + ".";
      await upstream.body?.cancel();
      return Response.json({ error: message, upstreamStatus: status }, { status: status === 429 ? 429 : 502, headers: { ...cors, "Cache-Control": "no-store" } });
    }
    const payload = await upstream.json();
    if (!payload || !Array.isArray(payload.results)) return Response.json({ error: "Gutendex devolvió una respuesta que no contiene una lista de libros." }, { status: 502, headers: { ...cors, "Cache-Control": "no-store" } });
    return Response.json({
      count: Number(payload.count || 0), next: payload.next || null, previous: payload.previous || null, results: payload.results,
    }, { status: 200, headers: { ...cors, "Cache-Control": "public, max-age=45, s-maxage=90", "X-Lextory-Catalogue-Source": "gutendex-proxy" } });
  } catch (error) {
    const timeout = controller.signal.aborted;
    return Response.json({
      error: timeout ? "Gutendex no ha respondido en 11 segundos." : "No se ha podido conectar con Gutendex: " + (error instanceof Error ? error.message : "error de red"),
      upstreamStatus: timeout ? 504 : 502,
    }, { status: timeout ? 504 : 502, headers: { ...cors, "Cache-Control": "no-store" } });
  } finally { clearTimeout(timer); }
});
