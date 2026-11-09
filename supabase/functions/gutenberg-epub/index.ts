// Supabase Edge Function used by Lextory to import Gutenberg EPUBs.
// It accepts only numeric Gutenberg book IDs; it never accepts arbitrary URLs.
const ALLOWED_ORIGINS = new Set(["https://antoniojpuche89-blip.github.io"]);
const ALLOWED_HOSTS = new Set(["www.gutenberg.org", "gutenberg.org", "gutenberg.pglaf.org"]);
const MAX_BYTES = 120 * 1024 * 1024;
const requests = new Map<string, { count: number; since: number }>();

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://antoniojpuche89-blip.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, accept, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function checkKey(req: Request): boolean {
  let expected = "";
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try { expected = JSON.parse(raw).default || ""; } catch { return false; }
  }
  if (!expected) expected = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return !!expected && req.headers.get("apikey") === expected;
}
function rateAllowed(req: Request): boolean {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now(), entry = requests.get(ip);
  if (!entry || now - entry.since > 300000) { requests.set(ip, { count: 1, since: now }); return true; }
  if (entry.count >= 8) return false;
  entry.count++; return true;
}
function candidates(id: string): string[] {
  return [
    `https://www.gutenberg.org/ebooks/${id}.epub.images`,
    `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
    `https://www.gutenberg.org/ebooks/${id}.epub.noimages`,
    `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}.epub`,
    `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}-images.epub`,
    `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}-images-3.epub`,
  ];
}
async function fetchAllowed(url: string, id: string): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (current.protocol !== "https:" || !ALLOWED_HOSTS.has(current.hostname)) throw new Error("Unapproved Gutenberg redirect.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    let response: Response;
    try {
      response = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal,
        headers: { Accept: "application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.8",
          Referer: `https://www.gutenberg.org/ebooks/${id}`, "User-Agent": "Lextory/1.0" } });
    } finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Incomplete Gutenberg redirect.");
      current = new URL(location, current); continue;
    }
    return response;
  }
  throw new Error("Too many Gutenberg redirects.");
}
Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405, headers });
  if (!checkKey(req)) return Response.json({ error: "Invalid application key." }, { status: 401, headers });
  if (!rateAllowed(req)) return Response.json({ error: "Too many requests." }, { status: 429, headers });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\\d{1,7}$/.test(id) || Number(id) < 1) return Response.json({ error: "Invalid Gutenberg book ID." }, { status: 400, headers });
  const failures: string[] = [];
  for (const url of candidates(id)) {
    try {
      const upstream = await fetchAllowed(url, id);
      if (!upstream.ok) { failures.push("HTTP " + upstream.status); await upstream.body?.cancel(); continue; }
      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      const length = Number(upstream.headers.get("content-length") || 0);
      if (length > MAX_BYTES || contentType.includes("text/html")) { failures.push("Not an EPUB response."); await upstream.body?.cancel(); continue; }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) { failures.push("Invalid EPUB signature."); continue; }
      return new Response(bytes, { status: 200, headers: { ...headers, "Content-Type": "application/epub+zip",
        "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename="gutenberg-${id}.epub"`,
        "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
    } catch (error) { failures.push(error instanceof Error ? error.message : "Upstream failure."); }
  }
  console.error("Gutenberg EPUB unavailable", id, failures);
  return Response.json({ error: "Project Gutenberg did not provide a valid EPUB." }, { status: 502, headers });
});
