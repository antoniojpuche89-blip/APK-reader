import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://antoniojpuche89-blip.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allowedOrigins.has(origin)) cors["Access-Control-Allow-Origin"] = origin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (!allowedOrigins.has(origin)) return json({ error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  // Supabase keeps these legacy environment variables available during the published key migration.
  const publishableFallback = (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; }
    catch { return ""; }
  })();
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || publishableFallback;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!url || !anon || !service || !authorization?.startsWith("Bearer ")) {
    return json({ error: "Server configuration is incomplete." }, 500);
  }

  try {
    const userClient = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data, error: authError } = await userClient.auth.getUser();
    if (authError || !data.user) return json({ error: "Authentication required." }, 401);

    // Foreign keys cascade deletion of the user's two cloud-sync rows.
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const deletion = await admin.auth.admin.deleteUser(data.user.id);
    if (deletion.error) return json({ error: "Could not delete the account." }, 500);
    return json({ success: true });
  } catch (error) {
    console.error("Lextory account deletion failed:", error);
    return json({ error: "Account deletion could not be completed." }, 500);
  }
});
