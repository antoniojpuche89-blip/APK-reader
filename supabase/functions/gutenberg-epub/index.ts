const ALLOWED_ORIGINS = new Set([
  "https://antoniojpuche89-blip.github.io",
]);
const ALLOWED_HOSTS = new Set(["www.gutenberg.org", "gutenberg.org", "gutenberg.pglaf.org"]);
const MAX_BYTES = 120 * 1024 * 1024;
const recentRequests = new Map<string, { count: number; since: number }>();

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://antoniojpuche89-blip.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, accept, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function publishableKey(): string {
  const json = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (json) {
    try {
      const keys = JSON.parse(json);
      if (typeof keys.default === "string") return keys.default;
    } catch {
      throw new Error("Supabase publishable key configuration is invalid.");
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

function withinRateLimit(req: Request): boolean {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = recentRequests.get(ip);
  if (!current || now - current.since > 5 * 60 * 1000) {
    recentRequests.set(ip, { count: 1, since: now });
    return true;
  }
  if (current.count >= 8) return false;
  current.count += 1;
  return true;
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
    if (current.protocol !== "https:" || !ALLOWED_HOSTS.has(current.hostname)) {
      throw new Error("Gutenberg redirected to a host outside the approved list.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Accept": "application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.8",
          "Referer": `https://www.gutenberg.org/ebooks/${id}`,
          "User-Agent": "Lextory/1.0 (user-requested single-book EPUB import)",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Gutenberg returned a redirect without a location.");
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects from Project Gutenberg.");
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: cors });
  }

  const expectedKey = publishableKey();
  const suppliedKey = req.headers.get("apikey") || "";
  if (!expectedKey || suppliedKey !== expectedKey) {
    return Response.json({ error: "Invalid application key." }, { status: 401, headers: cors });
  }
  if (!withinRateLimit(req)) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers: cors });
  }

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d{1,7}$/.test(id) || Number(id) < 1) {
    return Response.json({ error: "Invalid Gutenberg book ID." }, { status: 400, headers: cors });
  }

  const failures: string[] = [];
  for (const url of candidates(id)) {
    try {
      const upstream = await fetchAllowed(url, id);
      if (!upstream.ok) {
        failures.push(`${new URL(url).hostname}: HTTP ${upstream.status}`);
        await upstream.body?.cancel();
        continue;
      }

      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      const contentLength = Number(upstream.headers.get("content-length") || 0);
      if (contentLength > MAX_BYTES || contentType.includes("text/html")) {
        failures.push("Upstream response was not an EPUB.");
        await upstream.body?.cancel();
        continue;
      }

      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (!bytes.length || bytes.byteLength > MAX_BYTES ||
          bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        failures.push("Upstream file failed ZIP signature validation.");
        continue;
      }

      return new Response(bytes, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "application/epub+zip",
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `attachment; filename="gutenberg-${id}.epub"`,
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Upstream request failed.");
    }
  }

  console.error("No usable EPUB from Project Gutenberg:", id, failures);
  return Response.json(
    { error: "Project Gutenberg did not provide a valid EPUB for this book." },
    { status: 502, headers: cors },
  );
});
