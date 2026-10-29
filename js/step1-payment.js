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
  } catch (error) {
    console.log("Audio playback issue", error);
  }
}

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
    playPromise.catch((error) => {
      console.log("Autoplay tercegah browser, menunggu sentuhan:", error);
      const handleTouch = () => {
        videoPlayer.play();
        document.removeEventListener("click", handleTouch);
      };
      document.addEventListener("click", handleTouch);
    });
  }
}

function startQrisTimer(expiresAt, onExpire) {
  const timerElem = document.getElementById("qris-timer");
  if (!timerElem) return;

  if (window.qrisCountdownInterval) clearInterval(window.qrisCountdownInterval);

  const updateTimer = () => {
    const timeLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerElem.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    if (timeLeft === 0) {
      clearInterval(window.qrisCountdownInterval);
      window.qrisCountdownInterval = null;
      if (onExpire) onExpire();
    }
  };
  updateTimer();
  if (expiresAt > Date.now()) {
    window.qrisCountdownInterval = setInterval(updateTimer, 250);
  }
}

async function readQrSessionResponse(response) {
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const status = `HTTP ${response.status}`;
    throw new Error(
      `Server QR mengembalikan respons tidak valid (${status}). Restart server photobooth dengan "npm run serve", lalu coba lagi.`,
    );
  }

  if (!response.ok) {
    throw new Error(data.error || `QR konfirmasi gagal dibuat (HTTP ${response.status}).`);
  }
  return data;
}

function loadSocketIoClient() {
  if (typeof window.io === "function") return Promise.resolve(window.io);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${window.location.origin}/socket.io/socket.io.js`;
    script.onload = () => {
      if (typeof window.io !== "function") {
        reject(new Error("File client Socket.IO tidak menyediakan fungsi koneksi."));
        return;
      }
      resolve(window.io);
    };
    script.onerror = () => {
      reject(
        new Error(
          "Client Socket.IO tidak dapat dimuat. Buka aplikasi melalui server photobooth (npm run serve), bukan Live Server, lalu muat ulang halaman.",
        ),
      );
    };
    document.head.appendChild(script);
  });
}

async function initPaymentStep() {
  const btnStart = document.getElementById("btn-start-kiosk");
  const qrImage = document.getElementById("confirm-qr-display");
  const statusElem = document.getElementById("payment-session-status");
  let currentConfig = { ...DEFAULT_APP_CONFIG };
  let currentSessionId = null;
  let paymentSocket = null;
  let paymentProcessing = false;

  function closePaymentSession() {
    const sessionId = currentSessionId;
    currentSessionId = null;
    if (window.qrisCountdownInterval) {
      clearInterval(window.qrisCountdownInterval);
      window.qrisCountdownInterval = null;
    }
    if (paymentSocket) {
      paymentSocket.disconnect();
      paymentSocket = null;
    }
    if (sessionId) {
      fetch(`/api/qr-session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch((error) => {
        console.warn("Sesi QR tidak dapat ditutup di server:", error);
      });
    }
  }

  async function recordApprovedPayment(sessionId) {
    if (sessionId !== currentSessionId || paymentProcessing) return;
    paymentProcessing = true;
    if (statusElem) {
      statusElem.textContent = "Konfirmasi diterima. Menyiapkan sesi foto...";
      statusElem.className = "mt-5 w-full text-center text-sm font-semibold text-emerald-300";
    }

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
          "Pembayaran belum tercatat. Periksa koneksi lalu minta customer menekan tombol lagi.",
        );
      }
      if (!data?.success) {
        throw new Error(data?.error || "Pembayaran belum berhasil dicatat. Silakan coba lagi.");
      }

      closePaymentSession();
      playSuccessSound();
      if (typeof goToStep === "function") goToStep(2);
    } catch (error) {
      console.error("Pembayaran tidak dapat dicatat:", error);
      if (statusElem) {
        statusElem.textContent = "Belum berhasil dicatat. Minta customer menekan tombol lagi.";
        statusElem.className = "mt-5 w-full text-center text-sm font-semibold text-rose-300";
      }
      showModalNotice(
        "Pembayaran Belum Tercatat",
        error.message || "Pembayaran belum berhasil dicatat. Silakan coba lagi.",
        "error",
      );
    } finally {
      paymentProcessing = false;
    }
  }

  async function startPaymentSession() {
    closePaymentSession();
    paymentProcessing = false;
    if (qrImage) {
      qrImage.removeAttribute("src");
      qrImage.alt = "QR konfirmasi sedang dibuat";
    }
    if (statusElem) {
      statusElem.textContent = "Membuat QR konfirmasi...";
      statusElem.className = "mt-5 w-full text-center text-sm font-semibold text-slate-300";
    }

    try {
      const response = await fetch("/api/qr-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: Number(currentConfig.qrisTime) }),
      });
      const data = await readQrSessionResponse(response);

      const sessionId = data.session_id;
      currentSessionId = sessionId;
      const remainingMilliseconds = Number.isFinite(Number(data.expires_in_ms))
        ? Number(data.expires_in_ms)
        : Number(data.expires_in) * 1000;
      const expiresAt = Date.now() + remainingMilliseconds;
      startQrisTimer(expiresAt, () => {
        closePaymentSession();
        showModalNotice(
          "Waktu Habis",
          "Masa berlaku QR konfirmasi telah habis. Kembali ke layar utama.",
          "warning",
          () => {
            if (typeof goToStep === "function") goToStep(0);
          },
        );
      });

      if (qrImage) {
        qrImage.src = data.qr_data_url;
        qrImage.alt = "QR untuk membuka halaman konfirmasi sesi foto";
      }
      if (statusElem) {
        statusElem.textContent = "Pindai QR dengan HP pada Wi-Fi yang sama, lalu tekan Mulai Foto.";
      }

      const createSocket = await loadSocketIoClient();
      if (sessionId !== currentSessionId) return;
      paymentSocket = createSocket();
      paymentSocket.on("connect", () => {
        paymentSocket.emit("watch_session", sessionId, (result) => {
          if (!result?.success && currentSessionId) {
            console.error("Gagal memantau sesi konfirmasi:", result?.error);
            if (statusElem) statusElem.textContent = result?.error || "Sesi konfirmasi tidak tersedia.";
          }
        });
      });
      paymentSocket.on("session_approved", (event) => {
        if (event?.session_id === sessionId) {
          recordApprovedPayment(event.session_id);
        }
      });
      paymentSocket.on("connect_error", (error) => {
        console.error("Koneksi konfirmasi terputus:", error);
        if (statusElem) statusElem.textContent = "Menghubungkan ke server konfirmasi...";
      });

    } catch (error) {
      console.error("Gagal membuat sesi pembayaran:", error);
      if (statusElem) {
        statusElem.textContent = "QR gagal dibuat. Kembali dan coba mulai lagi.";
      }
      showModalNotice(
        "QR Konfirmasi Gagal",
        error.message || "QR konfirmasi belum bisa dibuat. Periksa koneksi server.",
        "error",
        () => {
          if (typeof goToStep === "function") goToStep(0);
        },
      );
    }
  }

  if (btnStart) {
    btnStart.disabled = true;
    btnStart.onclick = async () => {
      if (typeof goToStep === "function") goToStep(1);
      await startPaymentSession();
    };
  }

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
  } catch (error) {
    console.error("Gagal memuat konfigurasi kios:", error);
    if (btnStart) btnStart.disabled = true;
    showModalNotice(
      "Konfigurasi Belum Dimuat",
      "Pengaturan kiosk belum bisa dimuat. Silakan muat ulang atau hubungi pengelola.",
      "error",
    );
  }

  const priceElem = document.getElementById("qris-price-display");

  function applyConfig(nextConfig, reloadVideo = false) {
    const previousVideoUrl = currentConfig.videoUrl;
    currentConfig = { ...currentConfig, ...nextConfig };
    window.activeQrisTime = currentConfig.qrisTime;

    if (priceElem && Number.isFinite(Number(currentConfig.price))) {
      priceElem.textContent = `Rp ${Number(currentConfig.price).toLocaleString("id-ID")}`;
    }
    if (reloadVideo || currentConfig.videoUrl !== previousVideoUrl) {
      loadPromoVideo(currentConfig.videoUrl);
    }
  }

  applyConfig(currentConfig, true);
}

document.addEventListener("DOMContentLoaded", initPaymentStep);
