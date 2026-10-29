// ============================================================
// LOGIKA DASHBOARD ADMIN & VALIDASI FORM
// ============================================================

async function initializeAdminConfig() {
  const profile = await window.adminAuthReady;
  if (!profile) return;

  const isHeadOffice = ["owner", "hq_admin"].includes(profile.role);
  const kioskAdminNote = document.getElementById("kiosk-admin-config-note");
  const kioskAdminNoteText = document.getElementById("kiosk-admin-note-text");
  const panelTitle = document.getElementById("admin-panel-title");
  const panelDesc = document.getElementById("admin-panel-desc");

  const priceInput = document.getElementById("input-price");
  const timeInput = document.getElementById("input-qris-time");
  const pricePreview = document.getElementById("admin-price-preview");
  const timePreview = document.getElementById("admin-time-preview");
  const qrisPreview = document.getElementById("admin-qris-preview");
  const dashboardLayout = document.getElementById("admin-dashboard-layout");
  const settingsCard = document.getElementById("admin-settings-card");
  const revenueSummary = document.getElementById("kiosk-revenue-summary");
  const revenueTotal = document.getElementById("kiosk-revenue-today-total");
  const revenueCount = document.getElementById("kiosk-revenue-today-count");
  const revenueStatus = document.getElementById("kiosk-revenue-summary-status");
  const revenueDateInput = document.getElementById("kiosk-revenue-report-date");
  const revenueDateDisplay = document.getElementById("kiosk-revenue-report-date-display");
  const revenueTransactions = document.getElementById("kiosk-revenue-transactions");
  const revenueCountCaption = document.getElementById("kiosk-revenue-count-caption");
  const refreshRevenueButton = document.getElementById(
    "btn-refresh-kiosk-revenue",
  );
  const saveButton = document.getElementById("btn-save");
  const kioskSelectWrap = document.getElementById("kiosk-admin-select-wrap");
  const kioskSelect = document.getElementById("kiosk-admin-select");
  const currencyFormatter = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  const transactionDateFormatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const reportDateFormatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  let selectedKioskId = profile.kiosk_id;
  let revenueRequestId = 0;

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
      console.error(`${title}: ${message}`);
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

  function updatePreview(price, qrisTime, qrisImageUrl) {
    if (pricePreview && Number.isFinite(Number(price))) {
      pricePreview.textContent = `Rp ${Number(price).toLocaleString("id-ID")}`;
    }
    if (timePreview && Number.isFinite(Number(qrisTime))) {
      timePreview.textContent = `Timer: ${qrisTime} Detik`;
    }
    if (qrisPreview && qrisImageUrl) {
      qrisPreview.src = qrisImageUrl;
    }
  }

  function getJakartaDateValue(date = new Date()) {
    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      dateParts.map(({ type, value }) => [type, value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatReportDate(dateValue) {
    const [year, month, day] = dateValue.split("-").map(Number);
    return reportDateFormatter.format(
      new Date(Date.UTC(year, month - 1, day, 12)),
    );
  }

  function updateRevenueDateDisplay() {
    revenueDateDisplay.textContent = revenueDateInput.value
      ? `Tanggal dipilih: ${formatReportDate(revenueDateInput.value)}`
      : "";
  }

  function renderRevenueTransactions(
    transactions,
    emptyMessage = "Tidak ada transaksi pada tanggal ini.",
  ) {
    revenueTransactions.replaceChildren();

    if (!transactions.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "px-3 py-4 text-center text-gray-500";
      cell.textContent = emptyMessage;
      row.appendChild(cell);
      revenueTransactions.appendChild(row);
      return;
    }

    transactions.forEach((transaction, index) => {
      const row = document.createElement("tr");
      const numberCell = document.createElement("td");
      numberCell.className = "px-2 py-3 align-top text-xs sm:px-3";
      numberCell.textContent = String(index + 1);

      const dateCell = document.createElement("td");
      dateCell.className = "px-2 py-3 sm:px-3";
      const dateText = document.createElement("div");
      dateText.className = "text-xs font-medium leading-4 text-gray-700";
      dateText.textContent = transactionDateFormatter.format(
        new Date(transaction.created_at),
      );
      const idText = document.createElement("div");
      idText.className = "mt-1 break-all font-mono text-[10px] leading-4 text-gray-500";
      idText.textContent = `ID: ${transaction.id}`;
      dateCell.append(dateText, idText);

      const amountCell = document.createElement("td");
      amountCell.className = "px-2 py-3 text-right align-top text-xs font-semibold whitespace-nowrap sm:px-3";
      amountCell.textContent = currencyFormatter.format(transaction.amount);
      row.append(numberCell, dateCell, amountCell);
      revenueTransactions.appendChild(row);
    });
  }

  async function loadKioskRevenueSummary() {
    if (!selectedKioskId) {
      revenueTotal.textContent = "-";
      revenueCount.textContent = "-";
      renderRevenueTransactions([], "Akun ini belum ditugaskan ke kios.");
      revenueStatus.textContent =
        "Akun Admin Kios belum memiliki penugasan kios.";
      revenueStatus.classList.add("text-red-700");
      return;
    }

    const reportDate = revenueDateInput.value;
    if (!reportDate) {
      revenueStatus.textContent = "Pilih tanggal transaksi yang valid.";
      revenueStatus.classList.add("text-red-700");
      return;
    }

    const requestId = ++revenueRequestId;
    refreshRevenueButton.disabled = true;
    refreshRevenueButton.innerHTML =
      '<i class="fa-solid fa-rotate fa-spin"></i>';
    revenueStatus.textContent = "Memuat ringkasan pendapatan...";
    revenueStatus.classList.remove("text-red-700");
    const formattedReportDate = formatReportDate(reportDate);
    revenueCountCaption.textContent = `transaksi berhasil pada ${formattedReportDate} (WIB)`;

    try {
      const { data, error } = await supabaseClient.functions.invoke(
        "kiosk-revenue",
        {
          body: {
            action: "report",
            date: reportDate,
            kioskId: selectedKioskId,
          },
        },
      );

      if (requestId !== revenueRequestId) return;
      if (error) {
        const response = error.context;
        if (response && typeof response.json === "function") {
          const errorBody = await response
            .clone()
            .json()
            .catch(() => null);
          if (errorBody?.error) throw new Error(errorBody.error);
        }
        throw error;
      }

      if (
        !data ||
        !Number.isFinite(Number(data.totalRevenue)) ||
        !Number.isFinite(Number(data.transactionCount))
      ) {
        throw new Error("Data ringkasan pendapatan tidak valid.");
      }

      revenueTotal.textContent = currencyFormatter.format(data.totalRevenue);
      revenueCount.textContent = Number(data.transactionCount).toLocaleString(
        "id-ID",
      );
      renderRevenueTransactions(data.transactions || []);
      revenueStatus.textContent = `Diperbarui untuk ${formattedReportDate} (WIB).`;
    } catch (error) {
      if (requestId !== revenueRequestId) return;
      console.error("Gagal memuat ringkasan pendapatan kios:", error);
      revenueTotal.textContent = "-";
      revenueCount.textContent = "-";
      renderRevenueTransactions([], "Detail transaksi tidak dapat dimuat.");
      revenueStatus.textContent =
        error.message || "Ringkasan pendapatan belum bisa dimuat.";
      revenueStatus.classList.add("text-red-700");
    } finally {
      if (requestId === revenueRequestId) {
        refreshRevenueButton.disabled = false;
        refreshRevenueButton.innerHTML = '<i class="fa-solid fa-rotate"></i>';
      }
    }
  }

  if (!isHeadOffice) {
    dashboardLayout.className =
      "w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start";
    document.getElementById("staff-session-bar").className =
      "w-full max-w-6xl mb-4 flex items-center justify-end gap-3";
    settingsCard.classList.remove("max-w-xl");
    revenueSummary.classList.remove("hidden");
    revenueDateInput.value = getJakartaDateValue();
    updateRevenueDateDisplay();
    refreshRevenueButton.addEventListener("click", loadKioskRevenueSummary);
    revenueDateInput.addEventListener("change", () => {
      updateRevenueDateDisplay();
      loadKioskRevenueSummary();
    });
    void loadKioskRevenueSummary();
  }

  // Real-time preview saat admin mengetik harga atau durasi
  priceInput?.addEventListener("input", () => {
    const val = Number(priceInput.value);
    if (pricePreview && !isNaN(val) && val >= 0) {
      pricePreview.textContent = `Rp ${val.toLocaleString("id-ID")}`;
    }
  });

  timeInput?.addEventListener("input", () => {
    const val = Number(timeInput.value);
    if (timePreview && !isNaN(val) && val >= 0) {
      timePreview.textContent = `Timer: ${val} Detik`;
    }
  });

  // Render Data Awal ke Form & Preview Dashboard
  try {
    const globalConfig = await getAppConfigFromDB();

    if (isHeadOffice) {
      if (panelDesc) {
        panelDesc.textContent =
          "Pengaturan Terpusat (Berlaku untuk Seluruh Kios)";
      }
      priceInput.value = globalConfig.price;
      timeInput.value = globalConfig.qrisTime;
      updatePreview(
        globalConfig.price,
        globalConfig.qrisTime,
        globalConfig.qrisImage,
      );
    } else {
      // Role kiosk_admin
      if (panelTitle) panelTitle.textContent = "Pengaturan Kios";
      if (panelDesc) {
        panelDesc.textContent =
          "Pengaturan Harga & Durasi QRIS kios yang ditugaskan";
      }

      const assignedKiosks = profile.assigned_kiosks || [];
      kioskSelect.replaceChildren();
      assignedKiosks.forEach((kiosk) => {
        const option = document.createElement("option");
        option.value = kiosk.id;
        option.textContent = `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`;
        kioskSelect.appendChild(option);
      });
      if (!selectedKioskId && assignedKiosks.length > 0) {
        selectedKioskId = assignedKiosks[0].id;
      }
      kioskSelect.value = selectedKioskId || "";

      if (assignedKiosks.length > 1) {
        kioskSelectWrap.classList.remove("hidden");
      }
      if (kioskAdminNote) kioskAdminNote.classList.remove("hidden");

      async function loadSelectedKioskConfig(kioskId) {
        const kiosk = assignedKiosks.find((item) => item.id === kioskId);
        if (!kiosk) {
          throw new Error("Akun ini belum ditugaskan ke kios yang tersedia.");
        }
        const kioskLabel = kiosk
          ? `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`
          : "Tidak ada kios yang ditugaskan";
        if (kioskAdminNoteText) {
          kioskAdminNoteText.innerHTML = `Anda mengelola harga dan durasi QRIS untuk:<br><strong>${kioskLabel}</strong>.`;
        }

        const settings = kioskId ? await getKioskSettingsFromDB(kioskId) : null;
        const activePrice = settings?.price ?? globalConfig.price;
        const activeQrisTime = settings?.qris_time ?? globalConfig.qrisTime;
        priceInput.value = activePrice;
        timeInput.value = activeQrisTime;
        updatePreview(activePrice, activeQrisTime, globalConfig.qrisImage);
      }

      await loadSelectedKioskConfig(selectedKioskId);
      kioskSelect.addEventListener("change", async () => {
        selectedKioskId = kioskSelect.value || null;
        if (saveButton) saveButton.disabled = true;
        let configLoaded = false;
        try {
          await loadSelectedKioskConfig(selectedKioskId);
          configLoaded = true;
          await loadKioskRevenueSummary();
        } catch (error) {
          console.error("Gagal memuat pengaturan kios terpilih:", error);
          displayNotice(
            "Pengaturan Kios Belum Dimuat",
            getFriendlyErrorMessage(error, "load"),
            "error",
          );
        } finally {
          if (saveButton) saveButton.disabled = !configLoaded;
        }
      });
    }
  } catch (err) {
    console.error("Gagal muat config awal:", err);
    if (!isHeadOffice && saveButton) saveButton.disabled = true;
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

      const priceValue = Number(priceInput.value);
      const timeValue = Number(timeInput.value);
      const qrisFileInput = document.getElementById("input-qris-file");
      const videoFileInput = document.getElementById("input-video-file");
      const btnSave = document.getElementById("btn-save");

      // ----------------------------------------------------
      // VALIDASI INPUT FORM
      // ----------------------------------------------------
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
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${
        isHeadOffice ? "Uploading & Menyimpan..." : "Menyimpan..."
      }`;

      let newQrisUrl = null;
      let newVideoUrl = null;
      let errorAction = isHeadOffice ? "upload" : "save";

      try {
        if (isHeadOffice) {
          // Upload Video Promo jika ada file baru yang dipilih
          if (
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
          if (qrisFileInput && qrisFileInput.files && qrisFileInput.files[0]) {
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

          // 1. Simpan Konfigurasi Terpusat ke tabel app_config
          errorAction = "save";
          await saveAppConfigToDB(
            priceValue,
            timeValue,
            newQrisUrl,
            newVideoUrl,
          );

          // 2. Terapkan pembaruan harga & timer ke seluruh kios
          await syncAllKiosksSettings(priceValue, timeValue);

          displayNotice(
            "Berhasil Disimpan",
            "Pengaturan konfigurasi terpusat berhasil disimpan dan diterapkan ke seluruh kios!",
            "success",
            () => {
              window.location.reload();
            },
          );
        } else {
          // Admin Kios: Hanya mengubah harga dan durasi kiosnya sendiri
          if (!selectedKioskId) {
            throw new Error("Akun staf Anda belum ditugaskan ke kios manapun.");
          }

          errorAction = "save";
          await saveKioskSettingsToDB(selectedKioskId, priceValue, timeValue);

          displayNotice(
            "Berhasil Disimpan",
            "Harga dan durasi QRIS untuk kios yang dipilih berhasil diperbarui!",
            "success",
            () => {
              window.location.reload();
            },
          );
        }
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
