// ============================================================
// KONFIGURASI SUPABASE & HELPER DATABASE / STORAGE
// ============================================================

const SUPABASE_URL = "https://rhfyenlttmypowlssxuh.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_bQvgfIsz5msS7PTyUoRRiQ_jzB79BE4";
const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
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
  const { data, error } = await supabaseClient
    .from("kiosk_settings")
    .select("price, qris_time")
    .eq("kiosk_id", kioskId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function saveKioskSettingsToDB(kioskId, price, qrisTime) {
  const { data, error } = await supabaseClient
    .from("kiosk_settings")
    .update({
      price,
      qris_time: qrisTime,
      updated_at: new Date().toISOString(),
    })
    .eq("kiosk_id", kioskId)
    .select("kiosk_id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Perubahan pengaturan kios tidak berhasil disimpan.");
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
