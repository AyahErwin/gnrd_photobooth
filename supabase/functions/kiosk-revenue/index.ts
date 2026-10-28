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
    profile: { role: string; kiosk_id: string | null } | null;
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
    return { profile, error, unauthorized: false };
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

    const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const tokenHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sessionToken),
    );
    const sessionTokenHash = Array.from(new Uint8Array(tokenHash))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const [{ error: activateError }, { error: sessionError }] = await Promise.all([
      serviceClient.from("kiosks").update({ is_active: true }).eq("id", kiosk.id),
      serviceClient.from("kiosk_sessions").insert({
        token_hash: sessionTokenHash,
        kiosk_id: kiosk.id,
        expires_at: expiresAt,
      }),
    ]);

    if (activateError || sessionError) {
      console.error("Gagal membuat sesi login kiosk:", activateError || sessionError);
      return respond({ error: "Sesi login belum berhasil dibuat. Silakan coba lagi." }, 500);
    }

    await serviceClient.from("kiosk_sessions").delete().lt("expires_at", new Date().toISOString());

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
  }

  if (body.action === "record") {
    if (!body.kioskId) {
      return respond({ error: "Data kios tidak ditemukan." }, 400);
    }

    const [{ data: kiosk, error: kioskError }, { data: config, error: configError }] =
      await Promise.all([
        serviceClient.from("kiosks").select("id").eq("id", body.kioskId).maybeSingle(),
        serviceClient
          .from("kiosk_settings")
          .select("price")
          .eq("kiosk_id", body.kioskId)
          .maybeSingle(),
      ]);

    if (kioskError || configError) {
      console.error("Gagal memeriksa data transaksi:", kioskError || configError);
      return respond({ error: "Pembayaran belum tercatat. Silakan coba lagi." }, 500);
    }
    if (!kiosk) return respond({ error: "Data kios tidak ditemukan." }, 404);
    if (!config) return respond({ error: "Pengaturan harga kios belum tersedia." }, 409);

    const amount = Number(config?.price);
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
          .select("qris_image_url, video_url")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle(),
        serviceClient
          .from("kiosk_settings")
          .select("price, qris_time")
          .eq("kiosk_id", session.kiosk_id)
          .maybeSingle(),
      ]);

    if (configError || settingsError || !settings) {
      console.error("Gagal memuat konfigurasi kiosk:", configError || settingsError);
      return respond({ error: "Konfigurasi kios belum bisa dimuat. Silakan hubungi pengelola." }, 500);
    }

    return respond({
      config: {
        price: settings.price,
        qrisTime: settings.qris_time,
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
      ? (kiosks || []).filter((kiosk) => kiosk.id === profile.kiosk_id)
      : kiosks || [];
    const revenueByKiosk = visibleKiosks.map((kiosk) => ({
      id: kiosk.id,
      kiosk_code: kiosk.kiosk_code,
      kiosk_name: kiosk.kiosk_name,
      location: kiosk.location,
      revenue: Number(kiosk.revenue),
      transactionCount: Number(kiosk.transaction_count),
    }));
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
      revenueByKiosk,
      highest: ranked.slice(0, 5),
      lowest: ranked.slice(-5).reverse(),
    });
  }

  return respond({ error: "Permintaan laporan tidak dikenali." }, 400);
});
