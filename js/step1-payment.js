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

async function initPaymentStep() {
  const currentConfig = await getAppConfigFromDB();

  const priceElem = document.getElementById("qris-price-display");
  if (priceElem) {
    priceElem.textContent = `Rp ${Number(currentConfig.price).toLocaleString("id-ID")}`;
  }

  const qrisImgElem = document.getElementById("qris-image-display");
  if (qrisImgElem) {
    qrisImgElem.src = currentConfig.qrisImage;
  }

  let timeLeft = parseInt(currentConfig.qrisTime) || 300;
  const timerElem = document.getElementById("qris-timer");
  const btnSimulate = document.getElementById("btn-simulate-pay");

  if (!timerElem || !btnSimulate) return;

  const countdownInterval = setInterval(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    timerElem.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      showModalNotice(
        "Waktu Habis",
        "Masa berlaku QRIS telah habis. Halaman akan dimuat ulang.",
        "warning",
        () => {
          window.location.reload();
        },
      );
    }
    timeLeft--;
  }, 1000);

  // Ganti alert bawaan browser dengan Custom Modal Notification
  btnSimulate.addEventListener("click", () => {
    clearInterval(countdownInterval);
    playSuccessSound();

    showModalNotice(
      "Pembayaran Berhasil!",
      "Pembayaran terkonfirmasi. Menuju ke halaman pemilihan frame...",
      "success",
      () => {
        if (typeof goToStep === "function") {
          goToStep(2);
        }
      },
    );
  });

  supabaseClient
    .channel("realtime_config")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "app_config" },
      (payload) => {
        console.log("Perubahan data terdeteksi di Supabase!", payload.new);
        if (priceElem)
          priceElem.textContent = `Rp ${Number(payload.new.price).toLocaleString("id-ID")}`;
        if (qrisImgElem) qrisImgElem.src = payload.new.qris_image_url;
      },
    )
    .subscribe();
}

document.addEventListener("DOMContentLoaded", initPaymentStep);
