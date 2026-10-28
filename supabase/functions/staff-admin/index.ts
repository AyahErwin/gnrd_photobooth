import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Metode permintaan tidak didukung." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("Konfigurasi Supabase function staff-admin belum lengkap.");
    return respond({ error: "Layanan pengelolaan akun belum siap." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return respond({ error: "Silakan login kembali untuk mengelola akun." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const bearerToken = authorization.replace(/^Bearer\s+/i, "");
  const { data: callerData, error: callerError } = await authClient.auth.getUser(bearerToken);
  if (callerError || !callerData.user) {
    return respond({ error: "Sesi login tidak valid. Silakan login kembali." }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from("staff_profiles")
    .select("role")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  if (callerProfileError) {
    console.error("Gagal memeriksa hak akses pengelola akun:", callerProfileError);
    return respond({ error: "Hak akses belum bisa diperiksa." }, 500);
  }
  if (!callerProfile || !["owner", "hq_admin"].includes(callerProfile.role)) {
    return respond({ error: "Hanya Owner/Admin Pusat yang dapat mengelola akun staf." }, 403);
  }

  let body: {
    action?: string;
    userId?: string;
    email?: string;
    password?: string;
    role?: string;
    kioskId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Data permintaan tidak terbaca." }, 400);
  }

  const isOwner = callerProfile.role === "owner";
  const isAllowedRole = (role: string) =>
    ["kiosk_admin", "operator"].includes(role) || (isOwner && role === "hq_admin");
  const isLocalRole = (role: string) => ["kiosk_admin", "operator"].includes(role);

  if (body.action === "list") {
    const { data: profiles, error: profilesError } = await serviceClient
      .from("staff_profiles")
      .select("user_id, role, kiosk_id")
      .in("role", isOwner ? ["hq_admin", "kiosk_admin", "operator"] : ["kiosk_admin", "operator"]);
    if (profilesError) {
      console.error("Gagal mengambil daftar akun staf:", profilesError);
      return respond({ error: "Daftar akun belum bisa dimuat." }, 500);
    }

    const [{ data: authUsers, error: authUsersError }, { data: kiosks, error: kiosksError }] =
      await Promise.all([
        serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        serviceClient.from("kiosks").select("id, kiosk_code, kiosk_name"),
      ]);
    if (authUsersError || kiosksError) {
      console.error("Gagal melengkapi data akun staf:", authUsersError || kiosksError);
      return respond({ error: "Daftar akun belum bisa dimuat." }, 500);
    }

    const emailById = new Map<string, string>(
      (authUsers.users || []).map((user): [string, string] => [user.id, user.email || ""]),
    );
    const kioskById = new Map<string, { id: string; kiosk_code: string; kiosk_name: string }>(
      (kiosks || []).map((kiosk): [string, typeof kiosk] => [kiosk.id, kiosk]),
    );
    return respond({
      users: (profiles || []).map((profile) => {
        const kiosk = profile.kiosk_id ? kioskById.get(profile.kiosk_id) : undefined;
        return {
          userId: profile.user_id,
          email: emailById.get(profile.user_id) || "",
          role: profile.role,
          kioskId: profile.kiosk_id,
          kioskName: kiosk ? `${kiosk.kiosk_code} — ${kiosk.kiosk_name}` : "",
        };
      }),
    });
  }

  if (!["create", "update"].includes(body.action || "")) {
    return respond({ error: "Aksi pengelolaan akun tidak dikenali." }, 400);
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return respond({ error: "Masukkan email yang benar." }, 400);
  }
  if (!body.role || !isAllowedRole(body.role)) {
    return respond({ error: "Role yang dipilih tidak dapat diberikan oleh akun Anda." }, 403);
  }
  if (isLocalRole(body.role) && !body.kioskId) {
    return respond({ error: "Pilih kios untuk akun Admin Kios atau Operator." }, 400);
  }
  if (body.role === "hq_admin" && body.kioskId) {
    return respond({ error: "Admin Kantor Pusat tidak boleh dibatasi ke satu kios." }, 400);
  }

  if (body.action === "create") {
    if (!body.password || body.password.length < 8) {
      return respond({ error: "Password akun baru minimal 8 karakter." }, 400);
    }
    const { data: kiosk, error: kioskError } = body.kioskId
      ? await serviceClient.from("kiosks").select("id").eq("id", body.kioskId).maybeSingle()
      : { data: null, error: null };
    if (kioskError || (body.kioskId && !kiosk)) {
      return respond({ error: "Kios yang dipilih tidak ditemukan." }, 404);
    }

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      console.error("Gagal membuat akun Auth:", createError);
      return respond({ error: createError?.message || "Akun belum berhasil dibuat." }, 400);
    }

    const { error: profileError } = await serviceClient.from("staff_profiles").insert({
      user_id: created.user.id,
      role: body.role,
      kiosk_id: body.kioskId || null,
    });
    if (profileError) {
      console.error("Gagal menyimpan profil akun baru:", profileError);
      const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(created.user.id);
      if (rollbackError) console.error("Gagal membatalkan akun Auth yang belum terprofil:", rollbackError);
      return respond({ error: "Akun dibuat tetapi profil role gagal disimpan. Hubungi pengelola." }, 500);
    }
    return respond({ success: true });
  }

  if (!body.userId) {
    return respond({ error: "Akun yang akan diubah tidak ditemukan." }, 400);
  }
  const { data: target, error: targetError } = await serviceClient
    .from("staff_profiles")
    .select("user_id, role")
    .eq("user_id", body.userId)
    .maybeSingle();
  if (targetError || !target) {
    return respond({ error: "Akun yang akan diubah tidak ditemukan." }, 404);
  }
  if (target.role === "owner") {
    return respond({ error: "Akun Owner utama tidak dapat diubah dari halaman ini." }, 403);
  }
  if (!isOwner && !isLocalRole(target.role)) {
    return respond({ error: "Admin Pusat hanya dapat mengubah akun Admin Kios atau Operator." }, 403);
  }
  if (body.userId === callerData.user.id && body.role !== callerProfile.role) {
    return respond({ error: "Anda tidak dapat mengubah role akun yang sedang digunakan." }, 400);
  }
  if (body.password && body.password.length < 8) {
    return respond({ error: "Password baru minimal 8 karakter." }, 400);
  }
  if (body.kioskId) {
    const { data: kiosk, error: kioskError } = await serviceClient
      .from("kiosks")
      .select("id")
      .eq("id", body.kioskId)
      .maybeSingle();
    if (kioskError || !kiosk) return respond({ error: "Kios yang dipilih tidak ditemukan." }, 404);
  }

  const authUpdate: { email?: string; password?: string; email_confirm?: boolean } = {
    email: body.email,
    email_confirm: true,
  };
  if (body.password) authUpdate.password = body.password;
  const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(
    body.userId,
    authUpdate,
  );
  if (authUpdateError) {
    console.error("Gagal memperbarui akun Auth:", authUpdateError);
    return respond({ error: authUpdateError.message || "Akun belum berhasil diperbarui." }, 400);
  }

  const { error: profileUpdateError } = await serviceClient
    .from("staff_profiles")
    .update({
      role: body.role,
      kiosk_id: body.kioskId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", body.userId);
  if (profileUpdateError) {
    console.error("Gagal memperbarui role akun:", profileUpdateError);
    return respond({ error: "Akun terubah, tetapi role gagal diperbarui. Hubungi pengelola." }, 500);
  }

  return respond({ success: true });
});
