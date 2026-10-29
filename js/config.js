// ============================================================
// KONFIGURASI SUPABASE & HELPER DATABASE / STORAGE
// ============================================================

const localSupabaseConfig = window.GNRD_SUPABASE_CONFIG;
const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(
  window.location.hostname,
);
if (
  isLocalHost &&
  (!localSupabaseConfig?.url ||
    !localSupabaseConfig?.anonKey ||
    localSupabaseConfig.anonKey === "PASTE_LOCAL_ANON_KEY_HERE")
) {
  throw new Error(
    "Isi js/config.local.js dengan URL dan anon key Supabase lokal terlebih dahulu.",
  );
}

const SUPABASE_URL =
  localSupabaseConfig?.url || "https://rhfyenlttmypowlssxuh.supabase.co";
function resolveSupabaseUrl(configuredUrl) {
  const endpoint = new URL(configuredUrl);
  const appHost = window.location.hostname;
  const isLoopbackEndpoint = ["localhost", "127.0.0.1", "::1"].includes(
    endpoint.hostname,
  );
  const isPrivateIpv4 =
    /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
      appHost,
    );

  if (isLoopbackEndpoint && isPrivateIpv4) {
    endpoint.hostname = appHost;
  }
  return endpoint.toString().replace(/\/$/, "");
}

const resolvedSupabaseUrl = resolveSupabaseUrl(SUPABASE_URL);
const SUPABASE_ANON_KEY =
  localSupabaseConfig?.anonKey || "sb_publishable_bQvgfIsz5msS7PTyUoRRiQ_jzB79BE4";
function getOrCreateTabSessionId(forceNew = false) {
  const key = "gnrd_active_tab_session_id";
  let sessionId = forceNew ? null : sessionStorage.getItem(key);
  if (!sessionId) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

async function isDuplicateAppTab(sessionId) {
  if (typeof BroadcastChannel !== "function") return false;

  const channel = new BroadcastChannel(`gnrd-session-${sessionId}`);
  const instanceId = crypto.getRandomValues(new Uint32Array(2)).join("-");
  let probing = true;
  let duplicate = false;
  channel.onmessage = ({ data }) => {
    if (data?.type === "probe") {
      channel.postMessage({ type: "active", instanceId });
    } else if (
      probing &&
      data?.type === "active" &&
      data.instanceId !== instanceId
    ) {
      duplicate = true;
    }
  };
  channel.postMessage({ type: "probe" });
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  probing = false;
  if (duplicate) {
    channel.close();
    return true;
  }

  window.addEventListener("pagehide", () => channel.close(), { once: true });
  return false;
}

const supabaseClient = supabase.createClient(
  resolvedSupabaseUrl,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: window.sessionStorage,
    },
  },
);

const DEFAULT_APP_CONFIG = Object.freeze({
  price: 50000,
  qrisTime: 180,
  qrisImage: "https://placehold.co/300x300?text=QRIS+Belum+Ada",
  videoUrl: "",
});

// Ambil Konfigurasi dari DB dengan Fallback Nilai Default
async function getAppConfigFromDB() {
  const { data, error } = await supabaseClient
    .from("app_config")
    .select("id, price, qris_time, qris_image_url, video_url")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return {
    price: data?.price ?? DEFAULT_APP_CONFIG.price,
    qrisTime: data?.qris_time ?? DEFAULT_APP_CONFIG.qrisTime,
    qrisImage: data?.qris_image_url || DEFAULT_APP_CONFIG.qrisImage,
    videoUrl: data?.video_url || DEFAULT_APP_CONFIG.videoUrl,
  };
}

async function getKioskSettingsFromDB(kioskId) {
  if (!kioskId) return null;
  const { data, error } = await supabaseClient
    .from("kiosk_settings")
    .select("price, qris_time")
    .eq("kiosk_id", kioskId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function saveKioskSettingsToDB(kioskId, price, qrisTime) {
  if (!kioskId) {
    throw new Error("ID Kios tidak valid.");
  }
  const { data, error } = await supabaseClient
    .from("kiosk_settings")
    .upsert(
      {
        kiosk_id: kioskId,
        price,
        qris_time: qrisTime,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "kiosk_id" },
    )
    .select("kiosk_id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Perubahan pengaturan kios tidak berhasil disimpan.");
}

// Sinkronisasi Harga & Timer ke Seluruh Kios
async function syncAllKiosksSettings(price, qrisTime) {
  try {
    // 1. Update semua pengaturan kios yang sudah ada
    const { error: updateError } = await supabaseClient
      .from("kiosk_settings")
      .update({
        price,
        qris_time: qrisTime,
        updated_at: new Date().toISOString(),
      })
      .not("kiosk_id", "is", null);

    if (updateError) {
      console.warn("Gagal update massal kiosk_settings:", updateError);
    }

    // 2. Pastikan setiap kios di tabel kiosks memiliki entri di kiosk_settings
    const { data: kiosks, error: kiosksError } = await supabaseClient
      .from("kiosks")
      .select("id");

    if (!kiosksError && kiosks && kiosks.length > 0) {
      const rows = kiosks.map((k) => ({
        kiosk_id: k.id,
        price,
        qris_time: qrisTime,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabaseClient
        .from("kiosk_settings")
        .upsert(rows, { onConflict: "kiosk_id" });

      if (upsertError) {
        console.warn("Gagal upsert kiosk_settings:", upsertError);
      }
    }
  } catch (err) {
    console.error("Gagal sinkronisasi pengaturan ke seluruh kios:", err);
  }
}

// Upload Gambar QRIS ke Storage (Bucket: qris-images)
async function uploadQrisImageToStorage(file) {
  const fileName = `qris_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
  const { error } = await supabaseClient.storage
    .from("qris-images")
    .upload(fileName, file, { cacheControl: "3600", upsert: true });

  if (error) throw error;

  const { data: publicUrlData } = supabaseClient.storage
    .from("qris-images")
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

// Upload Video Promo ke Storage (Bucket: kiosk-videos)
async function uploadVideoToStorage(file) {
  const fileName = `video_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
  const { error } = await supabaseClient.storage
    .from("kiosk-videos")
    .upload(fileName, file, { cacheControl: "3600", upsert: true });

  if (error) throw error;

  const { data: publicUrlData } = supabaseClient.storage
    .from("kiosk-videos")
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

// Simpan/Update Konfigurasi ke Database Supabase
async function saveAppConfigToDB(price, qrisTime, newQrisUrl, newVideoUrl) {
  try {
    const { data: existingData, error: selectError } = await supabaseClient
      .from("app_config")
      .select("id, qris_image_url, video_url")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) throw selectError;

    const payload = {
      price: price,
      qris_time: qrisTime,
      qris_image_url:
        newQrisUrl ||
        existingData?.qris_image_url ||
        "https://placehold.co/300x300?text=QRIS+Siap",
      video_url: newVideoUrl || existingData?.video_url || "",
      updated_at: new Date().toISOString(),
    };

    if (existingData?.id) {
      const { data, error } = await supabaseClient
        .from("app_config")
        .update(payload)
        .eq("id", existingData.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Perubahan app_config tidak berhasil disimpan.");
    } else {
      const { error } = await supabaseClient
        .from("app_config")
        .insert([payload])
        .select("id")
        .single();

      if (error) throw error;
    }

    return true;
  } catch (err) {
    console.error("Gagal menyimpan ke DB:", err.message);
    throw err;
  }
}
