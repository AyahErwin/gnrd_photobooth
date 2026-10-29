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
    console.error("Konfigurasi Supabase fungsi kiosk-revenue belum lengkap.");
    return respond({ error: "Layanan laporan belum siap. Hubungi pengelola." }, 500);
  }

  let body: {
    action?: string;
    kioskCode?: string;
    kioskPassword?: string;
    kioskId?: string;
    expectedAmount?: number;
    date?: string;
    sessionToken?: string;
    tabSessionId?: string;
    takeover?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Data permintaan tidak terbaca." }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function getStaffProfile(): Promise<{
    profile: {
      role: string;
      kiosk_id: string | null;
      kiosk_ids: string[];
    } | null;
    error: unknown;
    unauthorized: boolean;
  }> {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return { profile: null, error: null, unauthorized: true };

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const bearerToken = authorization.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await authClient.auth.getUser(bearerToken);
    if (userError || !userData.user) {
      return { profile: null, error: null, unauthorized: true };
    }

    const { data: profile, error } = await serviceClient
      .from("staff_profiles")
      .select("role, kiosk_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !profile) {
      return { profile: null, error, unauthorized: false };
    }

    const { data: assignments, error: assignmentsError } = await serviceClient
      .from("staff_kiosks")
      .select("kiosk_id")
      .eq("user_id", userData.user.id);
    if (assignmentsError) {
      return { profile: null, error: assignmentsError, unauthorized: false };
    }

    const kioskIds = (assignments || []).map((assignment) => assignment.kiosk_id);
    if (kioskIds.length === 0 && profile.kiosk_id) kioskIds.push(profile.kiosk_id);
    return {
      profile: { ...profile, kiosk_ids: kioskIds },
      error: null,
      unauthorized: false,
    };
  }

  async function hashToken(sessionToken: string) {
    const tokenHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sessionToken),
    );
    return Array.from(new Uint8Array(tokenHash))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function findActiveSession(sessionToken?: string) {
    if (!sessionToken) return { data: null, error: null };

    return await serviceClient
      .from("kiosk_sessions")
      .select("kiosk_id")
      .eq("token_hash", await hashToken(sessionToken))
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
  }

  async function createKioskSession(kiosk: {
    id: string;
    kiosk_code: string;
    kiosk_name: string;
    package_type: string | null;
    location: string | null;
  }) {
    const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const [{ error: activateError }, { error: sessionError }] = await Promise.all([
      serviceClient.from("kiosks").update({ is_active: true }).eq("id", kiosk.id),
      serviceClient.from("kiosk_sessions").insert({
        token_hash: tokenHash,
        kiosk_id: kiosk.id,
        expires_at: expiresAt,
      }),
    ]);

    if (activateError || sessionError) {
      console.error("Gagal membuat sesi login kiosk:", activateError || sessionError);
      return respond({ error: "Sesi login belum berhasil dibuat. Silakan coba lagi." }, 500);
    }

    const { error: cleanupError } = await serviceClient
      .from("kiosk_sessions")
      .delete()
      .lt("expires_at", new Date().toISOString());
    if (cleanupError) {
      console.error("Gagal membersihkan sesi kiosk kedaluwarsa:", cleanupError);
    }

    return respond({
      success: true,
      sessionToken,
      kiosk: {
        id: kiosk.id,
        kiosk_code: kiosk.kiosk_code,
        kiosk_name: kiosk.kiosk_name,
        package_type: kiosk.package_type,
        location: kiosk.location,
      },
    });
  }

  if (body.action === "login") {
    if (!body.kioskCode || !body.kioskPassword) {
      return respond({ error: "Masukkan kode dan kata sandi kios." }, 400);
    }

    const { data: kiosk, error: loginError } = await serviceClient
      .from("kiosks")
      .select("id, kiosk_code, kiosk_name, package_type, location, password")
      .eq("kiosk_code", body.kioskCode)
      .maybeSingle();

    if (loginError) {
      console.error("Gagal memeriksa data login kiosk:", loginError);
      return respond({ error: "Kami belum bisa memeriksa data masuk. Silakan coba lagi." }, 500);
    }
    if (!kiosk || kiosk.password !== body.kioskPassword) {
      return respond({ success: false });
    }

    if (!body.tabSessionId || !/^[0-9a-f-]{36}$/i.test(body.tabSessionId)) {
      return respond({ error: "ID sesi tab tidak valid. Muat ulang halaman login." }, 400);
    }

    const { data: claimStatus, error: claimError } = await serviceClient.rpc(
      "claim_active_device_session",
      {
        p_account_key: `kiosk:${kiosk.id}`,
        p_session_id: body.tabSessionId,
        p_takeover: body.takeover === true,
        p_stale_after_seconds: 45,
      },
    );
    if (claimError) {
      console.error("Gagal memeriksa sesi aktif kiosk:", claimError);
      return respond({ error: "Status login kiosk belum bisa diperiksa." }, 500);
    }
    if (claimStatus === "conflict") {
      return respond({ success: false, activeSession: true });
    }

    const { error: revokeError } = await serviceClient
      .from("kiosk_sessions")
      .delete()
      .eq("kiosk_id", kiosk.id);
    if (revokeError) {
      console.error("Gagal menutup sesi kiosk sebelumnya:", revokeError);
      return respond({ error: "Sesi perangkat sebelumnya belum berhasil ditutup." }, 500);
    }

    return createKioskSession(kiosk);
  }

  if (body.action === "session_check") {
    if (
      !body.sessionToken ||
      !body.tabSessionId ||
      !/^[0-9a-f-]{36}$/i.test(body.tabSessionId)
    ) {
      return respond({ success: false, error: "Sesi perangkat tidak valid." }, 401);
    }
    const { data: session, error: sessionError } = await findActiveSession(body.sessionToken);
    if (sessionError) {
      console.error("Gagal memeriksa sesi perangkat kiosk:", sessionError);
      return respond({ error: "Sesi perangkat belum bisa diperiksa." }, 500);
    }
    if (!session) return respond({ success: false });

    const { data: claimStatus, error: claimError } = await serviceClient.rpc(
      "claim_active_device_session",
      {
        p_account_key: `kiosk:${session.kiosk_id}`,
        p_session_id: body.tabSessionId,
        p_takeover: false,
        p_stale_after_seconds: 45,
      },
    );
    if (claimError) {
      console.error("Gagal memperbarui sesi aktif kiosk:", claimError);
      return respond({ error: "Status sesi perangkat belum bisa diperiksa." }, 500);
    }
    return respond({ success: claimStatus !== "conflict" });
  }

  if (body.action === "record") {
    if (!body.sessionToken) {
      return respond({ error: "Sesi login sudah berakhir. Silakan masuk kembali ke kios." }, 401);
    }

    const { data: session, error: sessionError } = await findActiveSession(body.sessionToken);

    if (sessionError) {
      console.error("Gagal memeriksa sesi kiosk:", sessionError);
      return respond({ error: "Sesi kios belum bisa diperiksa. Silakan coba lagi." }, 500);
    }
    if (!session) {
      return respond({ error: "Sesi login sudah berakhir. Silakan masuk kembali ke kios." }, 401);
    }
    if (session.kiosk_id !== body.kioskId) {
      return respond({ error: "Sesi login tidak cocok dengan kios ini." }, 403);
    }

    if (!body.kioskId) {
      return respond({ error: "Data kios tidak ditemukan." }, 400);
    }

    const [
      { data: kiosk, error: kioskError },
      { data: config, error: configError },
      { data: globalConfig, error: globalError },
    ] = await Promise.all([
      serviceClient.from("kiosks").select("id").eq("id", body.kioskId).maybeSingle(),
      serviceClient
        .from("kiosk_settings")
        .select("price")
        .eq("kiosk_id", body.kioskId)
        .maybeSingle(),
      serviceClient
        .from("app_config")
        .select("price")
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (kioskError || configError) {
      console.error("Gagal memeriksa data transaksi:", kioskError || configError);
      return respond({ error: "Pembayaran belum tercatat. Silakan coba lagi." }, 500);
    }
    if (!kiosk) return respond({ error: "Data kios tidak ditemukan." }, 404);

    const rawAmount = config?.price ?? globalConfig?.price ?? 50000;
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return respond({ error: "Harga sesi belum diatur dengan benar." }, 409);
    }
    if (body.expectedAmount !== amount) {
      return respond({
        error: "Harga sesi berubah. Silakan mulai ulang pembayaran dengan harga terbaru.",
      }, 409);
    }

    const { error: insertError } = await serviceClient
      .from("kiosk_transactions")
      .insert({ kiosk_id: kiosk.id, amount });

    if (insertError) {
      console.error("Gagal mencatat transaksi:", insertError);
      return respond({ error: "Pembayaran belum tercatat. Silakan coba lagi." }, 500);
    }

    return respond({ success: true, amount });
  }

  if (body.action === "config") {
    if (!body.sessionToken) {
      return respond({ error: "Sesi login sudah berakhir. Silakan masuk kembali ke kios." }, 401);
    }
    const { data: session, error: sessionError } = await findActiveSession(body.sessionToken);
    if (sessionError) {
      console.error("Gagal memeriksa sesi kiosk:", sessionError);
      return respond({ error: "Sesi kios belum bisa diperiksa. Silakan coba lagi." }, 500);
    }
    if (!session) {
      return respond({ error: "Sesi login sudah berakhir. Silakan masuk kembali ke kios." }, 401);
    }

    const [{ data: globalConfig, error: configError }, { data: settings, error: settingsError }] =
      await Promise.all([
        serviceClient
          .from("app_config")
          .select("price, qris_time, qris_image_url, video_url")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle(),
        serviceClient
          .from("kiosk_settings")
          .select("price, qris_time")
          .eq("kiosk_id", session.kiosk_id)
          .maybeSingle(),
      ]);

    if (configError) {
      console.error("Gagal memuat konfigurasi kiosk:", configError);
      return respond({ error: "Konfigurasi kios belum bisa dimuat. Silakan hubungi pengelola." }, 500);
    }

    const price = settings?.price ?? globalConfig?.price ?? 50000;
    const qrisTime = settings?.qris_time ?? globalConfig?.qris_time ?? 180;

    return respond({
      config: {
        price,
        qrisTime,
        qrisImage: globalConfig?.qris_image_url || "",
        videoUrl: globalConfig?.video_url || "",
      },
    });
  }

  if (body.action === "logout") {
    if (!body.sessionToken) {
      return respond({ error: "Sesi login sudah berakhir." }, 401);
    }
    const { data: session, error: sessionError } = await findActiveSession(body.sessionToken);
    if (sessionError) {
      console.error("Gagal memeriksa sesi kiosk saat logout:", sessionError);
      return respond({ error: "Sesi kios belum bisa diperiksa. Silakan coba lagi." }, 500);
    }
    if (!session) return respond({ success: true });

    if (body.tabSessionId) {
      const { error: releaseError } = await serviceClient.rpc(
        "release_active_device_session",
        {
          p_account_key: `kiosk:${session.kiosk_id}`,
          p_session_id: body.tabSessionId,
        },
      );
      if (releaseError) {
        console.error("Gagal melepaskan sesi aktif kiosk:", releaseError);
        return respond({ error: "Sesi perangkat belum berhasil diakhiri." }, 500);
      }
    }

    const { error: deleteError } = await serviceClient
      .from("kiosk_sessions")
      .delete()
      .eq("token_hash", await hashToken(body.sessionToken));
    if (deleteError) {
      console.error("Gagal mengakhiri sesi kiosk:", deleteError);
      return respond({ error: "Logout belum berhasil. Silakan coba lagi." }, 500);
    }

    const { count, error: countError } = await serviceClient
      .from("kiosk_sessions")
      .select("token_hash", { count: "exact", head: true })
      .eq("kiosk_id", session.kiosk_id)
      .gt("expires_at", new Date().toISOString());
    if (countError) {
      console.error("Gagal memeriksa sesi kiosk lain:", countError);
      return respond({ error: "Status kiosk belum bisa diperiksa." }, 500);
    }
    if (!count) {
      const { error: updateError } = await serviceClient
        .from("kiosks")
        .update({ is_active: false })
        .eq("id", session.kiosk_id);
      if (updateError) {
        console.error("Gagal memperbarui status kiosk saat logout:", updateError);
        return respond({ error: "Status kiosk belum berhasil diperbarui." }, 500);
      }
    }
    return respond({ success: true });
  }

  if (body.action === "report") {
    if (!request.headers.get("Authorization")) {
      return respond({ error: "Silakan masuk dengan akun Admin untuk melihat laporan." }, 401);
    }

    const { profile, error: profileError, unauthorized } = await getStaffProfile();
    if (unauthorized) {
      return respond({ error: "Sesi login Admin tidak valid. Silakan masuk kembali." }, 401);
    }
    if (profileError) {
      console.error("Gagal memeriksa hak akses laporan:", profileError);
      return respond({ error: "Hak akses laporan belum bisa diperiksa. Silakan coba lagi." }, 500);
    }
    if (!profile || !["owner", "hq_admin", "kiosk_admin"].includes(profile.role)) {
      return respond({ error: "Akun ini tidak memiliki akses ke laporan penghasilan." }, 403);
    }
    if (
      profile.role === "kiosk_admin" &&
      body.kioskId &&
      !profile.kiosk_ids.includes(body.kioskId)
    ) {
      return respond({ error: "Akun ini tidak ditugaskan ke kios yang dipilih." }, 403);
    }

    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return respond({ error: "Pilih tanggal laporan yang benar." }, 400);
    }

    const [year, month, day] = body.date.split("-").map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(calendarDate.getTime()) ||
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() + 1 !== month ||
      calendarDate.getUTCDate() !== day
    ) {
      return respond({ error: "Pilih tanggal laporan yang benar." }, 400);
    }
    const start = new Date(`${body.date}T00:00:00+07:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const { data: kiosks, error } = await serviceClient.rpc("get_kiosk_revenue", {
      report_start: start.toISOString(),
      report_end: end.toISOString(),
    });

    if (error) {
      console.error("Gagal mengambil laporan penghasilan:", error);
      return respond({ error: "Laporan belum bisa dimuat. Silakan coba lagi." }, 500);
    }

    const visibleKiosks = profile.role === "kiosk_admin"
      ? (kiosks || []).filter(
          (kiosk) =>
            profile.kiosk_ids.includes(kiosk.id) &&
            (!body.kioskId || kiosk.id === body.kioskId),
        )
      : kiosks || [];
    const revenueByKiosk = visibleKiosks.map((kiosk) => ({
      id: kiosk.id,
      kiosk_code: kiosk.kiosk_code,
      kiosk_name: kiosk.kiosk_name,
      location: kiosk.location,
      revenue: Number(kiosk.revenue),
      transactionCount: Number(kiosk.transaction_count),
    }));
    const visibleKioskIds = visibleKiosks.map((kiosk) => kiosk.id);
    const transactions: Array<{
      id: string;
      amount: number;
      created_at: string;
    }> = [];
    if (visibleKioskIds.length > 0) {
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: transactionPage, error: transactionsError } = await serviceClient
          .from("kiosk_transactions")
          .select("id, amount, created_at")
          .in("kiosk_id", visibleKioskIds)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        if (transactionsError) {
          console.error("Gagal mengambil detail transaksi:", transactionsError);
          return respond({ error: "Detail transaksi belum bisa dimuat. Silakan coba lagi." }, 500);
        }

        transactions.push(
          ...(transactionPage || []).map((transaction) => ({
            id: transaction.id,
            amount: Number(transaction.amount),
            created_at: transaction.created_at,
          })),
        );
        if (!transactionPage || transactionPage.length < pageSize) break;
      }
    }
    const ranked = [...revenueByKiosk].sort(
      (a, b) => b.revenue - a.revenue || a.kiosk_name.localeCompare(b.kiosk_name),
    );

    return respond({
      date: body.date,
      totalRevenue: revenueByKiosk.reduce((sum, kiosk) => sum + kiosk.revenue, 0),
      transactionCount: revenueByKiosk.reduce(
        (sum, kiosk) => sum + kiosk.transactionCount,
        0,
      ),
      transactions,
      revenueByKiosk,
      highest: ranked.slice(0, 5),
      lowest: ranked.slice(-5).reverse(),
    });
  }

  return respond({ error: "Permintaan laporan tidak dikenali." }, 400);
});
