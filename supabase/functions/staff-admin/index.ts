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
  let body: {
    action?: string;
    userId?: string;
    email?: string;
    password?: string;
    role?: string;
    kioskId?: string | null;
    kioskIds?: unknown;
    sessionId?: string;
    takeover?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Data permintaan tidak terbaca." }, 400);
  }

  if (!callerProfile) {
    return respond({ error: "Profil akun staf tidak ditemukan." }, 403);
  }

  if (
    ["session_claim", "session_heartbeat", "session_release"].includes(
      body.action || "",
    )
  ) {
    if (!["owner", "hq_admin", "kiosk_admin"].includes(callerProfile.role)) {
      return respond({ error: "Akun ini tidak memiliki akses staf." }, 403);
    }
    if (!body.sessionId || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
      return respond({ error: "ID sesi perangkat tidak valid." }, 400);
    }

    const accountKey = `staff:${callerData.user.id}`;
    if (body.action === "session_release") {
      const { error } = await serviceClient.rpc("release_active_device_session", {
        p_account_key: accountKey,
        p_session_id: body.sessionId,
      });
      if (error) {
        console.error("Gagal mengakhiri sesi perangkat staf:", error);
        return respond({ error: "Sesi perangkat belum berhasil diakhiri." }, 500);
      }
      return respond({ success: true });
    }

    const { data: status, error } = await serviceClient.rpc(
      "claim_active_device_session",
      {
        p_account_key: accountKey,
        p_session_id: body.sessionId,
        p_takeover:
          body.action === "session_claim" && body.takeover === true,
        p_stale_after_seconds: 45,
      },
    );
    if (error) {
      console.error("Gagal mengunci sesi perangkat staf:", error);
      return respond({ error: "Status login perangkat belum bisa diperiksa." }, 500);
    }
    if (status === "conflict") {
      return respond({ success: false, activeSession: true });
    }
    return respond({ success: true, takenOver: status === "taken_over" });
  }

  if (!["owner", "hq_admin"].includes(callerProfile.role)) {
    return respond({ error: "Hanya Owner/Admin Pusat yang dapat mengelola akun staf." }, 403);
  }

  const isOwner = callerProfile.role === "owner";
  const isAllowedRole = (role: string) =>
    role === "kiosk_admin" || (isOwner && role === "hq_admin");
  const isLocalRole = (role: string) => role === "kiosk_admin";
  const findEmailConflict = async (email: string, excludedUserId?: string) => {
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data, error } = await serviceClient.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) {
        console.error("Gagal memeriksa email akun staf:", error);
        return { conflict: null, error };
      }

      const matchingUser = data.users.find(
        (user) =>
          user.id !== excludedUserId &&
          user.email?.trim().toLowerCase() === email,
      );
      if (matchingUser) {
        const { data: existingProfile, error: profileError } = await serviceClient
          .from("staff_profiles")
          .select("role")
          .eq("user_id", matchingUser.id)
          .maybeSingle();
        if (profileError) {
          console.error("Gagal memeriksa role email yang sudah digunakan:", profileError);
          return { conflict: null, error: profileError };
        }

        const roleLabels: Record<string, string> = {
          owner: "Owner",
          hq_admin: "Admin Pusat",
          kiosk_admin: "Admin Kios",
        };
        return {
          conflict: existingProfile
            ? `Email ini sudah digunakan oleh ${roleLabels[existingProfile.role] || "akun staf lain"}. Satu email hanya boleh digunakan untuk satu role.`
            : "Email ini sudah terdaftar pada akun lain. Satu email hanya boleh digunakan untuk satu role.",
          error: null,
        };
      }

      if (data.users.length < perPage) return { conflict: null, error: null };
    }
  };

  if (body.action === "list") {
    const { data: profiles, error: profilesError } = await serviceClient
      .from("staff_profiles")
      .select("user_id, role, kiosk_id")
      .in("role", isOwner ? ["hq_admin", "kiosk_admin"] : ["kiosk_admin"]);
    if (profilesError) {
      console.error("Gagal mengambil daftar akun staf:", profilesError);
      return respond({ error: "Daftar akun belum bisa dimuat." }, 500);
    }

    const [
      { data: authUsers, error: authUsersError },
      { data: kiosks, error: kiosksError },
      { data: assignments, error: assignmentsError },
    ] =
      await Promise.all([
        serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        serviceClient.from("kiosks").select("id, kiosk_code, kiosk_name"),
        serviceClient.from("staff_kiosks").select("user_id, kiosk_id"),
      ]);
    if (authUsersError || kiosksError || assignmentsError) {
      console.error(
        "Gagal melengkapi data akun staf:",
        authUsersError || kiosksError || assignmentsError,
      );
      return respond({ error: "Daftar akun belum bisa dimuat." }, 500);
    }

    const emailById = new Map<string, string>(
      (authUsers.users || []).map((user): [string, string] => [user.id, user.email || ""]),
    );
    const kioskById = new Map<string, { id: string; kiosk_code: string; kiosk_name: string }>(
      (kiosks || []).map((kiosk): [string, typeof kiosk] => [kiosk.id, kiosk]),
    );
    const kioskIdsByUserId = new Map<string, string[]>();
    for (const assignment of assignments || []) {
      const currentAssignments = kioskIdsByUserId.get(assignment.user_id) || [];
      currentAssignments.push(assignment.kiosk_id);
      kioskIdsByUserId.set(assignment.user_id, currentAssignments);
    }
    return respond({
      users: (profiles || []).map((profile) => {
        const kioskIds = kioskIdsByUserId.get(profile.user_id) || [];
        const assignedKiosks = kioskIds.flatMap((kioskId) => {
          const kiosk = kioskById.get(kioskId);
          return kiosk ? [kiosk] : [];
        });
        return {
          userId: profile.user_id,
          email: emailById.get(profile.user_id) || "",
          role: profile.role,
          kioskId: profile.kiosk_id,
          kioskIds,
          kioskNames: assignedKiosks.map(
            (kiosk) => `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`,
          ),
        };
      }),
    });
  }

  if (!["create", "update", "delete"].includes(body.action || "")) {
    return respond({ error: "Aksi pengelolaan akun tidak dikenali." }, 400);
  }

  if (body.action === "delete") {
    if (!body.userId) {
      return respond({ error: "Akun yang akan dihapus tidak ditemukan." }, 400);
    }

    const { data: target, error: targetError } = await serviceClient
      .from("staff_profiles")
      .select("user_id, role")
      .eq("user_id", body.userId)
      .maybeSingle();
    if (targetError || !target) {
      return respond({ error: "Akun staf tidak ditemukan." }, 404);
    }
    if (target.role === "owner") {
      return respond({ error: "Akun Owner utama tidak dapat dihapus dari halaman ini." }, 403);
    }
    if (!isOwner && !isLocalRole(target.role)) {
      return respond({ error: "Admin Pusat hanya dapat menghapus akun Admin Kios." }, 403);
    }
    if (body.userId === callerData.user.id) {
      return respond({ error: "Anda tidak dapat menghapus akun yang sedang digunakan." }, 400);
    }

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(body.userId);
    if (deleteError) {
      console.error("Gagal menghapus akun staf:", deleteError);
      return respond({ error: "Akun staf belum berhasil dihapus. Coba lagi." }, 500);
    }
    return respond({ success: true });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond({ error: "Masukkan email yang benar." }, 400);
  }
  if (!body.role || !isAllowedRole(body.role)) {
    return respond({ error: "Role yang dipilih tidak dapat diberikan oleh akun Anda." }, 403);
  }
  const rawKioskIds =
    body.kioskIds === undefined
      ? body.kioskId
        ? [body.kioskId]
        : []
      : body.kioskIds;
  if (
    !Array.isArray(rawKioskIds) ||
    !rawKioskIds.every((kioskId): kioskId is string => typeof kioskId === "string")
  ) {
    return respond({ error: "Daftar kios yang dipilih tidak valid." }, 400);
  }
  const kioskIds = rawKioskIds as string[];
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!kioskIds.every((kioskId) => uuidPattern.test(kioskId))) {
    return respond({ error: "ID kios yang dipilih tidak valid." }, 400);
  }
  if (new Set(kioskIds).size !== kioskIds.length) {
    return respond({ error: "Pilihan kios tidak boleh berulang." }, 400);
  }
  if (isLocalRole(body.role) && kioskIds.length === 0) {
    return respond({ error: "Pilih setidaknya satu kios untuk akun Admin Kios." }, 400);
  }
  if (body.role === "hq_admin" && kioskIds.length > 0) {
    return respond({ error: "Admin Kantor Pusat tidak boleh diberi penugasan kios." }, 400);
  }

  if (kioskIds.length > 0) {
    const { data: kiosks, error: kiosksError } = await serviceClient
      .from("kiosks")
      .select("id")
      .in("id", kioskIds);
    if (kiosksError) {
      console.error("Gagal memeriksa kios yang dipilih:", kiosksError);
      return respond({ error: "Daftar kios belum bisa diperiksa. Coba lagi." }, 500);
    }
    if ((kiosks || []).length !== kioskIds.length) {
      return respond({ error: "Satu atau lebih kios yang dipilih tidak terdaftar." }, 404);
    }
  }

  if (body.action === "create") {
    if (!body.password || body.password.length < 8) {
      return respond({ error: "Password akun baru minimal 8 karakter." }, 400);
    }
    const { conflict, error: emailCheckError } = await findEmailConflict(email);
    if (emailCheckError) {
      return respond({ error: "Email belum bisa diperiksa. Coba lagi." }, 500);
    }
    if (conflict) return respond({ error: conflict }, 409);

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      if (/already registered|already exists|duplicate key/i.test(createError?.message || "")) {
        return respond(
          {
            error: "Email ini sudah digunakan oleh akun lain. Satu email hanya boleh digunakan untuk satu role.",
          },
          409,
        );
      }
      console.error("Gagal membuat akun Auth:", createError);
      return respond({ error: createError?.message || "Akun belum berhasil dibuat." }, 400);
    }

    const { error: profileError } = await serviceClient.from("staff_profiles").insert({
      user_id: created.user.id,
      role: body.role,
      kiosk_id: kioskIds[0] || null,
    });
    if (profileError) {
      console.error("Gagal menyimpan profil akun baru:", profileError);
      const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(created.user.id);
      if (rollbackError) console.error("Gagal membatalkan akun Auth yang belum terprofil:", rollbackError);
      if (profileError.code === "23505") {
        return respond(
          {
            error: "Email ini sudah digunakan oleh akun staf lain. Satu email hanya boleh digunakan untuk satu role.",
          },
          409,
        );
      }
      return respond({ error: "Akun dibuat tetapi profil role gagal disimpan. Hubungi pengelola." }, 500);
    }

    const { error: assignmentsError } = await serviceClient.rpc("set_staff_kiosks", {
      target_user_id: created.user.id,
      target_role: body.role,
      target_kiosk_ids: kioskIds,
    });
    if (assignmentsError) {
      console.error("Gagal menyimpan penugasan kios akun baru:", assignmentsError);
      const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(created.user.id);
      if (rollbackError) {
        console.error("Gagal membatalkan akun dengan penugasan kios gagal:", rollbackError);
      }
      return respond({ error: "Penugasan kios gagal disimpan. Akun baru dibatalkan." }, 500);
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
    return respond({ error: "Admin Pusat hanya dapat mengubah akun Admin Kios." }, 403);
  }
  if (body.userId === callerData.user.id && body.role !== callerProfile.role) {
    return respond({ error: "Anda tidak dapat mengubah role akun yang sedang digunakan." }, 400);
  }
  if (body.password && body.password.length < 8) {
    return respond({ error: "Password baru minimal 8 karakter." }, 400);
  }
  const { conflict, error: emailCheckError } = await findEmailConflict(
    email,
    body.userId,
  );
  if (emailCheckError) {
    return respond({ error: "Email belum bisa diperiksa. Coba lagi." }, 500);
  }
  if (conflict) return respond({ error: conflict }, 409);

  const authUpdate: { email?: string; password?: string; email_confirm?: boolean } = {
    email,
    email_confirm: true,
  };
  if (body.password) authUpdate.password = body.password;
  const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(
    body.userId,
    authUpdate,
  );
  if (authUpdateError) {
    if (/already registered|already exists|duplicate key/i.test(authUpdateError.message)) {
      return respond(
        {
          error: "Email ini sudah digunakan oleh akun lain. Satu email hanya boleh digunakan untuk satu role.",
        },
        409,
      );
    }
    console.error("Gagal memperbarui akun Auth:", authUpdateError);
    return respond({ error: authUpdateError.message || "Akun belum berhasil diperbarui." }, 400);
  }

  const { error: assignmentsError } = await serviceClient.rpc("set_staff_kiosks", {
    target_user_id: body.userId,
    target_role: body.role,
    target_kiosk_ids: kioskIds,
  });
  if (assignmentsError) {
    console.error("Gagal memperbarui role dan penugasan kios:", assignmentsError);
    return respond({
      error: "Data akun berubah, tetapi role dan penugasan kios belum berhasil diperbarui. Hubungi pengelola.",
    }, 500);
  }

  return respond({ success: true });
});
