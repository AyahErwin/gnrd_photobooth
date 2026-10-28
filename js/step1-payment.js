function playSuccessSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    console.log("Audio playback issue", e);
  }
}

// Memuat dan Memutar Video Promo Standby
function loadPromoVideo(videoUrl) {
  const videoPlayer = document.getElementById("promo-video-player");
  const videoSource = document.getElementById("promo-video-source");
  if (!videoPlayer) return;

  const targetUrl =
    videoUrl ||
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

  videoPlayer.muted = true;
  videoPlayer.defaultMuted = true;

  if (videoSource) videoSource.src = targetUrl;
  videoPlayer.src = targetUrl;
  videoPlayer.load();

  const playPromise = videoPlayer.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.log("Autoplay tercegah browser, menunggu sentuhan:", err);
      const handleTouch = () => {
        videoPlayer.play();
        document.removeEventListener("click", handleTouch);
      };
      document.addEventListener("click", handleTouch);
    });
  }
}

// Timer QRIS
function startQrisTimer(durationSeconds) {
  let timeLeft = parseInt(durationSeconds) || 300;
  const timerElem = document.getElementById("qris-timer");
  if (!timerElem) return;

  if (window.qrisCountdownInterval) clearInterval(window.qrisCountdownInterval);

  window.qrisCountdownInterval = setInterval(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    timerElem.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (timeLeft <= 0) {
      clearInterval(window.qrisCountdownInterval);
      showModalNotice(
        "Waktu Habis",
        "Masa berlaku QRIS telah habis. Kembali ke layar utama.",
        "warning",
        () => {
          if (typeof goToStep === "function") goToStep(0);
        },
      );
    }
    timeLeft--;
  }, 1000);
}

// Inisialisasi Utama Halaman Standby & QRIS
async function initPaymentStep() {
  // 1. Hubungkan Tombol MULAI SESI FOTO secara langsung
  const btnStart = document.getElementById("btn-start-kiosk");
  if (btnStart) {
    btnStart.disabled = true;
    btnStart.onclick = () => {
      if (typeof goToStep === "function") goToStep(1);
      if (window.activeQrisTime) startQrisTimer(window.activeQrisTime);
    };
  }

  // 2. Ambil data Konfigurasi dari Supabase dengan aman
  let currentConfig = { ...DEFAULT_APP_CONFIG };

  try {
    const activeKiosk = getActiveKioskSession();
    if (!activeKiosk?.sessionToken) {
      throw new Error("Sesi login sudah berakhir. Silakan masuk kembali ke kios.");
    }

    const { data, error } = await supabaseClient.functions.invoke(
      "kiosk-revenue",
      {
        body: {
          action: "config",
          sessionToken: activeKiosk.sessionToken,
        },
      },
    );
    if (error) throw error;
    if (!data?.config) throw new Error("Konfigurasi kios belum tersedia.");
    currentConfig = { ...currentConfig, ...data.config };
    if (btnStart) btnStart.disabled = false;
  } catch (err) {
    console.error("Gagal memuat konfigurasi kios:", err);
    if (btnStart) btnStart.disabled = true;
    showModalNotice(
      "Konfigurasi Belum Dimuat",
      "Pengaturan kiosk belum bisa dimuat. Silakan muat ulang atau hubungi pengelola.",
      "error",
    );
  }

  const priceElem = document.getElementById("qris-price-display");
  const qrisImgElem = document.getElementById("qris-image-display");

  function applyConfig(nextConfig, reloadVideo = false) {
    const previousVideoUrl = currentConfig.videoUrl;
    currentConfig = { ...currentConfig, ...nextConfig };
    window.activeQrisTime = currentConfig.qrisTime;

    if (priceElem && Number.isFinite(Number(currentConfig.price))) {
      priceElem.textContent = `Rp ${Number(currentConfig.price).toLocaleString("id-ID")}`;
    }
    if (qrisImgElem && currentConfig.qrisImage) {
      qrisImgElem.src = currentConfig.qrisImage;
    }
    if (reloadVideo || currentConfig.videoUrl !== previousVideoUrl) {
      loadPromoVideo(currentConfig.videoUrl);
    }
  }

  // 3. Tampilkan konfigurasi kios yang dikirim backend.
  applyConfig(currentConfig, true);

  // 5. Setup Tombol Simulasi Bayar
  const btnSimulate = document.getElementById("btn-simulate-pay");
  if (btnSimulate) {
    btnSimulate.onclick = async () => {
      btnSimulate.disabled = true;
      btnSimulate.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Mencatat pembayaran...';

      try {
        const activeKiosk = getActiveKioskSession();
        if (!activeKiosk?.id || !activeKiosk?.sessionToken) {
          throw new Error("Sesi kios tidak ditemukan. Silakan masuk kembali.");
        }

        const { data, error } = await supabaseClient.functions.invoke(
          "kiosk-revenue",
          {
            body: {
              action: "record",
              kioskId: activeKiosk.id,
              sessionToken: activeKiosk.sessionToken,
              expectedAmount: Number(currentConfig.price),
            },
          },
        );

        if (error) {
          console.error("Gagal mencatat pembayaran:", error);
          const response = error.context;
          if (response && typeof response.json === "function") {
            const errorBody = await response.clone().json().catch(() => null);
            if (errorBody?.error) throw new Error(errorBody.error);
          }
          throw new Error(
            "Pembayaran belum tercatat. Periksa koneksi lalu coba lagi.",
          );
        }
        if (!data?.success) {
          throw new Error(
            data?.error || "Pembayaran belum berhasil dicatat. Silakan coba lagi.",
          );
        }

        if (window.qrisCountdownInterval) {
          clearInterval(window.qrisCountdownInterval);
        }
        playSuccessSound();
        if (typeof goToStep === "function") goToStep(2);
      } catch (error) {
        console.error("Pembayaran tidak dapat dicatat:", error);
        showModalNotice(
          "Pembayaran Belum Tercatat",
          error.message ||
            "Pembayaran belum berhasil dicatat. Silakan coba lagi.",
          "error",
        );
      } finally {
        btnSimulate.disabled = false;
        btnSimulate.innerHTML =
          '<i class="fa-solid fa-circle-check"></i> Konfirmasi Pembayaran';
      }
    };
  }

}

document.addEventListener("DOMContentLoaded", initPaymentStep);
