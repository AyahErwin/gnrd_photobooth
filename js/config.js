// 1. KUNCI API SUPABASE AKUN KAMU
const SUPABASE_URL = "https://rhfyenlttmypowlssxuh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bQvgfIsz5msS7PTyUoRRiQ_jzB79BE4";

// 2. INISIALISASI CLIENT SUPABASE
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3. AMBIL KONFIGURASI DARI DATABASE SUPABASE
async function getAppConfigFromDB() {
  try {
    const { data, error } = await supabaseClient
      .from("app_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;

    return {
      price: data.price,
      qrisTime: data.qris_time,
      qrisImage: data.qris_image_url,
    };
  } catch (err) {
    console.error("Gagal mengambil konfigurasi Supabase:", err.message);
    return {
      price: 25000,
      qrisTime: 300,
      qrisImage:
        "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=GNRD_PHOTOBOOTH_PAYMENT_DEMO",
    };
  }
}

// 4. UPLOAD GAMBAR QRIS KE SUPABASE STORAGE
async function uploadQrisImageToStorage(file) {
  try {
    const fileExt = file.name.split(".").pop();
    const fileName = `qris_${Date.now()}.${fileExt}`;
    const filePath = `qris_codes/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("qris-images")
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage
      .from("qris-images")
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (err) {
    console.error("Gagal upload gambar QRIS:", err.message);
    if (typeof showModalNotice === "function") {
      showModalNotice(
        "Upload Gagal",
        "Gagal upload gambar: " + err.message,
        "error",
      );
    }
    return null;
  }
}

// 5. SIMPAN DATA KE TABEL APP_CONFIG (DIPERBARUI DENGAN MODAL)
async function saveAppConfigToDB(newPrice, newTime, imageUrl) {
  try {
    const updateData = {
      price: newPrice,
      qris_time: newTime,
      updated_at: new Date(),
    };

    if (imageUrl) {
      updateData.qris_image_url = imageUrl;
    }

    const { error } = await supabaseClient
      .from("app_config")
      .update(updateData)
      .eq("id", 1);

    if (error) throw error;

    // Tampilkan Custom Modal menggantikan alert() bawaan
    return new Promise((resolve) => {
      if (typeof showModalNotice === "function") {
        showModalNotice(
          "Berhasil Disimpan!",
          "Konfigurasi berhasil diperbarui di Database Supabase.",
          "success",
          () => resolve(true),
        );
      } else {
        resolve(true);
      }
    });
  } catch (err) {
    console.error("Gagal menyimpan ke Supabase:", err.message);
    if (typeof showModalNotice === "function") {
      showModalNotice(
        "Gagal Menyimpan",
        "Gagal menyimpan ke database: " + err.message,
        "error",
      );
    }
    return false;
  }
}
