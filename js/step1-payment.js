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
    btnStart.onclick = () => {
      if (typeof goToStep === "function") goToStep(1);
      if (window.activeQrisTime) startQrisTimer(window.activeQrisTime);
    };
  }

  // 2. Ambil data Konfigurasi dari Supabase dengan aman
  let currentConfig = {
    price: 25000,
    qrisTime: 300,
    qrisImage:
      "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=GNRD_PHOTOBOOTH_PAYMENT_DEMO",
    videoUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  };

  try {
    if (typeof getAppConfigFromDB === "function") {
      const dbConfig = await getAppConfigFromDB();
      if (dbConfig) currentConfig = { ...currentConfig, ...dbConfig };
    }
  } catch (err) {
    console.warn("Memakai konfigurasi standar:", err);
  }

  window.activeQrisTime = currentConfig.qrisTime;

  // 3. Putar Video
  loadPromoVideo(currentConfig.videoUrl);

  // 4. Set Tampilan Harga & QRIS
  const priceElem = document.getElementById("qris-price-display");
  if (priceElem)
    priceElem.textContent = `Rp ${Number(currentConfig.price).toLocaleString("id-ID")}`;

  const qrisImgElem = document.getElementById("qris-image-display");
  if (qrisImgElem) qrisImgElem.src = currentConfig.qrisImage;

  // 5. Setup Tombol Simulasi Bayar
  const btnSimulate = document.getElementById("btn-simulate-pay");
  if (btnSimulate) {
    btnSimulate.onclick = () => {
      if (window.qrisCountdownInterval)
        clearInterval(window.qrisCountdownInterval);
      playSuccessSound();
      showModalNotice(
        "Pembayaran Berhasil!",
        "Menuju ke pemilihan frame...",
        "success",
        () => {
          if (typeof goToStep === "function") goToStep(2);
        },
      );
    };
  }

  // 6. Realtime Listener
  if (typeof supabaseClient !== "undefined") {
    supabaseClient
      .channel("realtime_config")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_config" },
        (payload) => {
          if (priceElem && payload.new.price)
            priceElem.textContent = `Rp ${Number(payload.new.price).toLocaleString("id-ID")}`;
          if (qrisImgElem && payload.new.qris_image_url)
            qrisImgElem.src = payload.new.qris_image_url;
          if (payload.new.video_url) loadPromoVideo(payload.new.video_url);
          if (payload.new.qris_time)
            window.activeQrisTime = payload.new.qris_time;
        },
      )
      .subscribe();
  }
}

document.addEventListener("DOMContentLoaded", initPaymentStep);
