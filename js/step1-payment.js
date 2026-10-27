// Function Audio Synth untuk efek suara sukses pembayaran
function playSuccessSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3); // A5

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    console.log("Audio playback not allowed yet without user interaction");
  }
}

// Inisialisasi Logika Halaman Pembayaran QRIS
function initPaymentStep() {
  let timeLeft = 299; // 5 Menit
  const timerElem = document.getElementById("qris-timer");
  const btnSimulate = document.getElementById("btn-simulate-pay");

  if (!timerElem || !btnSimulate) return;

  // Hitung Mundur Timer QRIS
  const countdownInterval = setInterval(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    timerElem.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      alert("Masa berlaku QRIS telah habis. Halaman akan dimuat ulang.");
      window.location.reload();
    }
    timeLeft--;
  }, 1000);

  // Event Listener Tombol Simulasi Pembayaran
  btnSimulate.addEventListener("click", () => {
    clearInterval(countdownInterval);
    playSuccessSound();
    alert("Pembayaran Terkonfirmasi! Menuju ke Pemilihan Frame...");

    // Nanti di sini kita panggil fungsi pindah ke Halaman 2 (Frame Selection)
    if (typeof goToStep === "function") {
      goToStep(2);
    }
  });
}

// Jalankan saat script dimuat
document.addEventListener("DOMContentLoaded", initPaymentStep);
