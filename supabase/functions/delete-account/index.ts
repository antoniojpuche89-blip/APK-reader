import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!url || !anon || !service || !authorization) {
    return new Response(JSON.stringify({ error: "Server configuration is incomplete." }), { status: 500, headers: cors });
  }

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data, error: authError } = await userClient.auth.getUser();
  if (authError || !data.user) return new Response(JSON.stringify({ error: "Authentication required." }), { status: 401, headers: cors });

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const id = data.user.id;
  const progress = await admin.from("reading_progress").delete().eq("user_id", id);
  if (progress.error) return new Response(JSON.stringify({ error: "Could not delete reading progress." }), { status: 500, headers: cors });
  const learning = await admin.from("user_learning_state").delete().eq("user_id", id);
  if (learning.error) return new Response(JSON.stringify({ error: "Could not delete learning data." }), { status: 500, headers: cors });
  const deletion = await admin.auth.admin.deleteUser(id);
  if (deletion.error) return new Response(JSON.stringify({ error: "Could not delete the account." }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
});
