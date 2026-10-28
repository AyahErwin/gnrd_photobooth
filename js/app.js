// Global Application State & Notification Manager

function getFriendlyErrorMessage(error, action = "save", dataName = "") {
  const errorCode = error?.code;
  const errorText = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  if (
    errorCode === "23505" ||
    errorText.includes("duplicate key") ||
    errorText.includes("unique constraint")
  ) {
    const namedData = String(dataName).trim();
    if (namedData) {
      return `Data ini '${namedData}' sudah terdaftar. Periksa kode kios dan gunakan kode yang berbeda.`;
    }

    return "Data ini sudah terdaftar. Periksa kode kios dan gunakan kode yang berbeda.";
  }

  if (
    errorCode === "42501" ||
    errorText.includes("row-level security") ||
    errorText.includes("permission denied")
  ) {
    return "Aksi ini belum diizinkan. Silakan hubungi pengelola untuk memeriksa akses akun.";
  }

  if (errorCode === "23503" || errorText.includes("foreign key")) {
    return "Data ini masih terkait dengan data lain, jadi belum bisa diubah atau dihapus.";
  }

  if (
    errorText.includes("bucket not found") ||
    errorText.includes("object not found")
  ) {
    return "Tempat penyimpanan file belum tersedia. Silakan hubungi pengelola.";
  }

  if (
    errorText.includes("payload too large") ||
    errorText.includes("file size") ||
    errorText.includes("maximum allowed")
  ) {
    return "Ukuran file terlalu besar. Silakan pilih file yang lebih kecil.";
  }

  if (
    errorText.includes("failed to fetch") ||
    errorText.includes("network") ||
    errorText.includes("fetch error")
  ) {
    return "Koneksi internet sedang bermasalah. Periksa koneksi lalu coba lagi.";
  }

  const messages = {
    load: "Data belum bisa dimuat. Periksa koneksi internet lalu coba lagi.",
    save: "Data belum berhasil disimpan. Coba lagi, atau hubungi pengelola jika masalah berlanjut.",
    delete: "Data belum berhasil dihapus. Coba lagi, atau hubungi pengelola jika masalah berlanjut.",
    upload: "File belum berhasil diunggah. Periksa ukuran file dan coba lagi.",
    login: "Kami belum bisa memeriksa data masuk. Periksa koneksi lalu coba lagi.",
  };

  return messages[action] || messages.save;
}

// Fungsi untuk Menampilkan Custom Pop-up Modal
let modalCountdownInterval;

function clearModalCountdown() {
  if (modalCountdownInterval) {
    clearInterval(modalCountdownInterval);
    modalCountdownInterval = null;
  }

  const countdown = document.getElementById("modal-notice-countdown");
  if (countdown) {
    countdown.classList.add("hidden");
    countdown.textContent = "";
  }
}

function showModalNotice(
  title,
  message,
  iconType = "success",
  onConfirm = null,
  countdownSeconds = 0,
) {
  const modal = document.getElementById("global-modal-notice");
  const modalTitle = document.getElementById("modal-notice-title");
  const modalMessage = document.getElementById("modal-notice-message");
  const modalIcon = document.getElementById("modal-notice-icon");
  const btnConfirm = document.getElementById("btn-modal-notice-ok");
  const btnCancel = document.getElementById("btn-modal-notice-cancel");
  const countdown = document.getElementById("modal-notice-countdown");

  clearModalCountdown();
  if (!modal) {
    console.log(`${title}: ${message}`);
    if (onConfirm) onConfirm();
    return;
  }

  modalTitle.textContent = title;
  modalMessage.textContent = message;

  // Set Icon berdasarkan type
  if (iconType === "success") {
    modalIcon.className =
      "fa-solid fa-circle-check text-emerald-400 text-5xl mb-3";
  } else if (iconType === "warning") {
    modalIcon.className =
      "fa-solid fa-triangle-exclamation text-amber-400 text-5xl mb-3";
  } else if (iconType === "error") {
    modalIcon.className =
      "fa-solid fa-circle-xmark text-rose-500 text-5xl mb-3";
  }

  // Tampilkan Modal
  modal.classList.remove("hidden");
  if (btnCancel) btnCancel.classList.add("hidden");
  btnConfirm.classList.remove("flex-1");
  btnConfirm.classList.add("w-full");
  btnConfirm.textContent = "Lanjutkan";
  btnConfirm.classList.remove("hidden");

  const handleConfirm = () => {
    clearModalCountdown();
    modal.classList.add("hidden");
    btnConfirm.onclick = null;
    if (btnCancel) btnCancel.onclick = null;
    if (typeof onConfirm === "function") {
      onConfirm();
    }
  };

  btnConfirm.onclick = handleConfirm;
  if (btnCancel) {
    btnCancel.onclick = () => {
      clearModalCountdown();
      modal.classList.add("hidden");
    };
  }

  if (countdown && Number.isFinite(countdownSeconds) && countdownSeconds > 0) {
    const expiresAt = Date.now() + countdownSeconds * 1000;
    btnConfirm.classList.add("hidden");
    const updateCountdown = () => {
      const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      countdown.textContent = `Waktu tunggu: ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      countdown.classList.remove("hidden");

      if (secondsLeft === 0) {
        clearInterval(modalCountdownInterval);
        modalCountdownInterval = null;
        btnConfirm.classList.remove("hidden");
      }
    };

    updateCountdown();
    modalCountdownInterval = setInterval(updateCountdown, 250);
  }
}

function showModalConfirm(
  title,
  message,
  onConfirm,
  confirmLabel = "Ya, Hapus",
  cancelLabel = "Batal",
) {
  const modal = document.getElementById("global-modal-notice");
  const modalTitle = document.getElementById("modal-notice-title");
  const modalMessage = document.getElementById("modal-notice-message");
  const modalIcon = document.getElementById("modal-notice-icon");
  const btnConfirm = document.getElementById("btn-modal-notice-ok");
  const btnCancel = document.getElementById("btn-modal-notice-cancel");

  clearModalCountdown();
  if (!modal || !btnConfirm || !btnCancel) {
    if (window.confirm(`${title}\n\n${message}`) && onConfirm) onConfirm();
    return;
  }

  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalIcon.className =
    "fa-solid fa-triangle-exclamation text-amber-400 text-5xl mb-3";
  modal.classList.remove("hidden");
  btnCancel.classList.remove("hidden");
  btnConfirm.classList.remove("w-full");
  btnConfirm.classList.add("flex-1");
  btnConfirm.textContent = confirmLabel;
  btnCancel.textContent = cancelLabel;

  const closeModal = () => {
    clearModalCountdown();
    modal.classList.add("hidden");
    btnConfirm.onclick = null;
    btnCancel.onclick = null;
  };

  btnConfirm.onclick = () => {
    closeModal();
    if (typeof onConfirm === "function") onConfirm();
  };
  btnCancel.onclick = closeModal;
}

// Logika Perpindahan Halaman Kiosk
function goToStep(stepNumber) {
  console.log(`Navigating to Step ${stepNumber}`);

  const allSteps = document.querySelectorAll(".kiosk-step");
  allSteps.forEach((step) => step.classList.add("hidden"));

  const targetStep = document.getElementById(`step-${stepNumber}`);
  if (targetStep) {
    targetStep.classList.remove("hidden");
  }

  if (stepNumber === 3) {
    if (typeof startCameraStream === "function") {
      startCameraStream();
    }
  }
}

// ==========================================
// Helper Modal Pop-Up Pengganti Alert Browser
// ==========================================
function showAlertModal(title, message, iconType = "info", onConfirm = null) {
  if (typeof showModalNotice === "function") {
    showModalNotice(title, message, iconType, onConfirm);
  } else {
    console.warn(`${title}: ${message}`);
    if (onConfirm) onConfirm();
  }
}

// Fungsi Toggle Fullscreen & Normal Screen
function toggleFullscreen() {
  const icon = document.getElementById("fullscreen-icon");

  if (
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.msFullscreenElement
  ) {
    // Masuk ke Mode Fullscreen
    const docElm = document.documentElement;
    if (docElm.requestFullscreen) {
      docElm.requestFullscreen();
    } else if (docElm.webkitRequestFullscreen) {
      /* Safari / iOS */
      docElm.webkitRequestFullscreen();
    } else if (docElm.msRequestFullscreen) {
      /* IE/Edge */
      docElm.msRequestFullscreen();
    }

    if (icon) {
      icon.className = "fa-solid fa-compress text-lg";
    }
  } else {
    // Keluar dari Mode Fullscreen (Kembali Normal)
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }

    if (icon) {
      icon.className = "fa-solid fa-expand text-lg";
    }
  }
}

// Deteksi perubahan status Fullscreen (misal saat pengguna tekan ESC)
document.addEventListener("fullscreenchange", () => {
  const icon = document.getElementById("fullscreen-icon");
  if (!icon) return;

  if (document.fullscreenElement) {
    icon.className = "fa-solid fa-compress text-lg";
  } else {
    icon.className = "fa-solid fa-expand text-lg";
  }
});

// Otomatis minta Fullscreen pada klik/sentuhan pertama di layar
document.addEventListener(
  "click",
  () => {
    if (!document.fullscreenElement) {
      // Aktifkan jika aplikasi baru pertama dibuka dan diklik
      // toggleFullscreen(); // Bebas diaktifkan jika ingin otomatis full saat tombol apa saja diklik
    }
  },
  { once: true },
);
