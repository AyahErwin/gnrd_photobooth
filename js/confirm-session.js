document.addEventListener("DOMContentLoaded", () => {
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("session_id");
  const expiresAtParam = Number(searchParams.get("expires_at_ms"));
  const button = document.getElementById("btn-confirm-session");
  const statusElem = document.getElementById("confirm-status");
  const timerElem = document.getElementById("confirm-session-timer");
  const confirmContent = document.getElementById("confirm-content");
  const successContent = document.getElementById("confirm-success");
  let countdownInterval = null;
  let expiresAt = 0;
  let sessionExpired = false;

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function updateCountdown() {
    const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = secondsLeft % 60;
    timerElem.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (secondsLeft === 0) {
      stopCountdown();
      sessionExpired = true;
      button.disabled = true;
      statusElem.textContent = "Waktu sesi habis. Pindai kembali QR pada layar photobooth.";
      statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
    }
  }

  function startCountdown(durationMilliseconds) {
    stopCountdown();
    expiresAt = Date.now() + durationMilliseconds;
    sessionExpired = false;
    updateCountdown();
    if (expiresAt > Date.now()) {
      countdownInterval = setInterval(updateCountdown, 250);
    }
  }

  if (!sessionId) {
    button.disabled = true;
    statusElem.textContent = "Tautan konfirmasi tidak valid. Pindai QR pada layar photobooth.";
    statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
    return;
  }

  const socket = io();
  button.disabled = true;
  statusElem.textContent = "Menghubungkan ke photobooth...";

  if (Number.isFinite(expiresAtParam) && expiresAtParam > 0) {
    startCountdown(expiresAtParam - Date.now());
  }

  socket.on("connect", () => {
    button.disabled = true;
    statusElem.textContent = "Memeriksa sesi...";
    socket.emit("watch_session", sessionId, (result) => {
      if (!result?.success) {
        stopCountdown();
        sessionExpired = true;
        timerElem.textContent = "00:00";
        statusElem.textContent =
          result?.error || "Sesi konfirmasi tidak tersedia atau sudah kedaluwarsa.";
        statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
        return;
      }

      if (Number.isFinite(result.expires_in_ms) && result.expires_in_ms > 0) {
        startCountdown(result.expires_in_ms);
      } else if (!Number.isFinite(expiresAtParam) || expiresAtParam <= Date.now()) {
        stopCountdown();
        sessionExpired = true;
        timerElem.textContent = "00:00";
        statusElem.textContent = "Waktu sesi habis. Pindai kembali QR pada layar photobooth.";
        statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
        return;
      }

      if (!sessionExpired) {
        button.disabled = false;
        statusElem.textContent = "Terhubung. Tekan Mulai Foto untuk melanjutkan.";
        statusElem.className = "mt-5 min-h-6 text-sm font-medium text-slate-300";
      }
    });
  });

  socket.on("connect_error", (error) => {
    console.error("Gagal terhubung ke server photobooth:", error);
    button.disabled = true;
    statusElem.textContent = "Tidak dapat terhubung. Pastikan HP dan photobooth memakai Wi-Fi yang sama.";
    statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
  });

  socket.on("disconnect", () => {
    button.disabled = true;
    if (!sessionExpired) {
      statusElem.textContent = "Koneksi terputus. Menghubungkan kembali...";
      statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
    }
  });

  button.addEventListener("click", () => {
    if (sessionExpired || Date.now() >= expiresAt) {
      updateCountdown();
      return;
    }

    button.disabled = true;
    statusElem.textContent = "Mengirim konfirmasi...";
    socket.timeout(10000).emit("confirm_session", sessionId, (timeoutError, result) => {
      if (timeoutError || !result?.success) {
        button.disabled = sessionExpired || Date.now() >= expiresAt;
        statusElem.textContent =
          result?.error || "Konfirmasi gagal dikirim. Periksa koneksi lalu coba lagi.";
        statusElem.className = "mt-5 min-h-6 text-sm font-medium text-rose-300";
        return;
      }

      stopCountdown();
      confirmContent.classList.add("hidden");
      successContent.classList.remove("hidden");
    });
  });
});
