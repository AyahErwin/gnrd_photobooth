// ============================================================
// LOGIKA DASHBOARD ADMIN & VALIDASI FORM
// ============================================================

async function initializeAdminConfig() {
  const profile = await window.adminAuthReady;
  if (!profile) return;

  const isHeadOffice = ["owner", "hq_admin"].includes(profile.role);
  const targetKiosk = document.getElementById("config-target-kiosk");
  const kioskAdminNote = document.getElementById("kiosk-admin-config-note");

  // Helper Notifikasi Modal Pop-Up
  function displayNotice(
    title,
    message,
    iconType = "success",
    onConfirm = null,
  ) {
    if (typeof showModalNotice === "function") {
      showModalNotice(title, message, iconType, onConfirm);
    } else {
      alert(`${title}: ${message}`);
      if (onConfirm) onConfirm();
    }
  }

  // Reset Indikator Tombol Simpan
  function resetButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML =
      '<i class="fa-solid fa-floppy-disk"></i> Simpan Ke Supabase';
  }

  async function loadKioskSettings(kioskId) {
    if (!kioskId) return;
    const settings = await getKioskSettingsFromDB(kioskId);
    if (!settings) {
      throw new Error("Pengaturan harga dan timer untuk kios ini belum tersedia.");
    }

    const priceInput = document.getElementById("input-price");
    const timeInput = document.getElementById("input-qris-time");
    const pricePreview = document.getElementById("admin-price-preview");
    const timePreview = document.getElementById("admin-time-preview");
    priceInput.value = settings.price;
    timeInput.value = settings.qris_time;
    pricePreview.textContent = `Rp ${Number(settings.price).toLocaleString("id-ID")}`;
    timePreview.textContent = `Timer: ${settings.qris_time} Detik`;
  }

  // Render Data Awal ke Form & Preview Dashboard
  try {
    const config = await getAppConfigFromDB();
    const qrisPreview = document.getElementById("admin-qris-preview");
    qrisPreview.src = config.qrisImage;

    let kioskId = profile.kiosk_id;
    if (isHeadOffice) {
      const { data: kiosks, error } = await supabaseClient
        .from("kiosks")
        .select("id, kiosk_code, kiosk_name")
        .order("kiosk_code", { ascending: true });
      if (error) throw error;

      targetKiosk.replaceChildren();
      (kiosks || []).forEach((kiosk) => {
        const option = document.createElement("option");
        option.value = kiosk.id;
        option.textContent = `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`;
        targetKiosk.appendChild(option);
      });
      kioskId = targetKiosk.value;

      targetKiosk.addEventListener("change", () => {
        loadKioskSettings(targetKiosk.value).catch((error) => {
          console.error("Gagal memuat konfigurasi kios:", error);
          displayNotice("Konfigurasi Belum Dimuat", getFriendlyErrorMessage(error, "load"), "error");
        });
      });
    } else {
      kioskAdminNote.classList.remove("hidden");
    }

    if (kioskId) await loadKioskSettings(kioskId);
  } catch (err) {
    console.error("Gagal muat config awal:", err);
    displayNotice(
      "Pengaturan Belum Dimuat",
      getFriendlyErrorMessage(err, "load"),
      "error",
    );
  }

  // Event Listener Form Submit Config
  const form = document.getElementById("form-admin-config");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const priceInput = document.getElementById("input-price");
      const timeInput = document.getElementById("input-qris-time");
      const qrisFileInput = document.getElementById("input-qris-file");
      const videoFileInput = document.getElementById("input-video-file");
      const btnSave = document.getElementById("btn-save");

      const priceValue = Number(priceInput.value);
      const timeValue = Number(timeInput.value);

      // ----------------------------------------------------
      // VALIDASI INPUT FORM
      // ----------------------------------------------------
      // Harga dan waktu pada tabel app_config bertipe int4.
      if (
        !Number.isInteger(priceValue) ||
        priceValue < 0 ||
        priceValue > 2147483647
      ) {
        displayNotice(
          "Validasi Gagal",
          "Harga harus bilangan bulat antara Rp 0 dan Rp 2.147.483.647.",
          "warning",
        );
        return;
      }

      if (!Number.isInteger(timeValue) || timeValue > 300) {
        displayNotice(
          "Validasi Gagal",
          "Durasi timer QRIS harus berupa bilangan bulat maksimal 300 detik.",
          "warning",
        );
        return;
      }

      if (timeValue <= 0) {
        displayNotice(
          "Validasi Gagal",
          "Durasi timer QRIS harus lebih besar dari 0 detik!",
          "warning",
        );
        return;
      }

      const maxFileSize = 50 * 1024 * 1024;
      const selectedFiles = [
        videoFileInput?.files?.[0],
        qrisFileInput?.files?.[0],
      ].filter(Boolean);
      const filesToUpload = isHeadOffice ? selectedFiles : [];
      if (filesToUpload.some((file) => file.size > maxFileSize)) {
        displayNotice(
          "Ukuran Berkas Terlalu Besar",
          "Ukuran video dan gambar maksimal 50 MB sesuai batas bucket Supabase.",
          "warning",
        );
        return;
      }

      // Indikator Loading
      btnSave.disabled = true;
      btnSave.innerHTML =
        `<i class="fa-solid fa-spinner fa-spin"></i> ${
          isHeadOffice ? "Uploading & Menyimpan..." : "Menyimpan..."
        }`;

      let newQrisUrl = null;
      let newVideoUrl = null;
      let errorAction = isHeadOffice ? "upload" : "save";
      const kioskId = isHeadOffice ? targetKiosk.value : profile.kiosk_id;

      try {
        if (!kioskId) {
          throw new Error("Pilih kios yang akan diperbarui.");
        }

        // Upload Video Promo jika ada file baru yang dipilih
        if (
          isHeadOffice &&
          videoFileInput &&
          videoFileInput.files &&
          videoFileInput.files[0]
        ) {
          newVideoUrl = await uploadVideoToStorage(videoFileInput.files[0]);
          if (!newVideoUrl) {
            displayNotice(
              "Gagal Upload",
              "Gagal mengunggah berkas video ke bucket kiosk-videos.",
              "error",
            );
            resetButton(btnSave);
            return;
          }
        }

        // Upload Gambar QRIS jika ada file baru yang dipilih
        if (
          isHeadOffice &&
          qrisFileInput &&
          qrisFileInput.files &&
          qrisFileInput.files[0]
        ) {
          newQrisUrl = await uploadQrisImageToStorage(qrisFileInput.files[0]);
          if (!newQrisUrl) {
            displayNotice(
              "Gagal Upload",
              "Gagal mengunggah gambar QRIS ke bucket qris-images.",
              "error",
            );
            resetButton(btnSave);
            return;
          }
        }

        // Simpan Konfigurasi ke Supabase Database
        errorAction = "save";
        if (isHeadOffice) {
          await saveAppConfigToDB(
            priceValue,
            timeValue,
            newQrisUrl,
            newVideoUrl,
          );
        }
        await saveKioskSettingsToDB(kioskId, priceValue, timeValue);

        displayNotice(
          "Berhasil Disimpan",
          isHeadOffice
            ? "Pengaturan kios dan media global berhasil diperbarui!"
            : "Harga dan durasi QRIS kios berhasil diperbarui!",
          "success",
          () => {
            window.location.reload();
          },
        );
      } catch (err) {
        console.error("Gagal menyimpan konfigurasi:", err);
        displayNotice(
          errorAction === "upload"
            ? "File Belum Berhasil Diunggah"
            : "Pengaturan Belum Tersimpan",
          getFriendlyErrorMessage(err, errorAction),
          "error",
        );
        resetButton(btnSave);
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAdminConfig, {
    once: true,
  });
} else {
  initializeAdminConfig();
}
