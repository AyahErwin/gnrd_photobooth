const kioskLoginTabSessionId = getOrCreateTabSessionId(true);

async function initializeKioskLogin() {
  const loginForm = document.getElementById("form-kiosk-login");
  let failedAttempts = 0;
  let lockoutUntil = 0;

  const sessionNotice = sessionStorage.getItem("gnrd_login_session_notice");
  if (sessionNotice) {
    showModalNotice("Informasi Login", sessionNotice, "warning");
    sessionStorage.removeItem("gnrd_login_session_notice");
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const lockoutSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (lockoutSeconds > 0) {
        showModalNotice(
          "Keamanan Terkunci",
          "Terlalu banyak percobaan gagal. Silakan tunggu sampai waktu habis:",
          "error",
          null,
          lockoutSeconds,
        );
        return;
      }

      if (lockoutUntil) {
        lockoutUntil = 0;
      }

      const btnSubmit = document.getElementById("btn-login-submit");
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memverifikasi...`;

      const rawCode = document.getElementById("login-kiosk-code").value.trim();
      const rawPass = document.getElementById("login-kiosk-pass").value.trim();

      const kioskCode = sanitizeInput(rawCode);
      const kioskPass = sanitizeInput(rawPass);

      try {
        const tabSessionId = kioskLoginTabSessionId;
        const requestLogin = (takeover = false) =>
          supabaseClient.functions.invoke("kiosk-revenue", {
            body: {
              action: "login",
              kioskCode,
              kioskPassword: kioskPass,
              tabSessionId,
              takeover,
            },
          });
        let { data, error } = await requestLogin();

        if (error) {
          console.error("Gagal memeriksa login kiosk:", error);
          const response = error.context;
          if (response && typeof response.json === "function") {
            const errorBody = await response.clone().json().catch(() => null);
            if (errorBody?.error) throw new Error(errorBody.error);
          }
          throw new Error("Kami belum bisa memeriksa data masuk. Periksa koneksi lalu coba lagi.");
        }

        if (data?.activeSession) {
          const shouldTakeOver = await showModalConfirm(
            "Akses ditolak",
            "User yang Anda coba gunakan sedang online di tab/perangkat lain. Apakah Anda ingin berpindah perangkat? Jika Ya, perangkat lama akan keluar.",
            null,
            "Ya, Berpindah",
            "Batal",
          );
          if (!shouldTakeOver) {
            showModalNotice(
              "Akses Ditolak",
              "User yang Anda coba gunakan sedang online di tab/perangkat lain.",
              "warning",
            );
            return;
          }
          ({ data, error } = await requestLogin(true));
          if (error) throw error;
        }

        if (!data?.success || !data.kiosk || !data.sessionToken) {
          failedAttempts++;
          if (failedAttempts >= 5) {
            const lockoutMinutes = [1, 3, 5][
              Math.min(failedAttempts - 5, 2)
            ];
            const lockoutDurationSeconds = lockoutMinutes * 60;
            lockoutUntil = Date.now() + lockoutDurationSeconds * 1000;
            showModalNotice(
              "Keamanan Terkunci",
              "Terlalu banyak percobaan gagal. Silakan tunggu sampai waktu habis:",
              "error",
              null,
              lockoutDurationSeconds,
            );
          } else {
            showModalNotice(
              "Akses Ditolak",
              `Kode Kios atau Password salah! (Percobaan: ${failedAttempts}/5)`,
              "error",
            );
          }
          return;
        }

        failedAttempts = 0;
        lockoutUntil = 0;
        sessionStorage.setItem(
          "gnrd_active_kiosk",
          JSON.stringify({
            ...data.kiosk,
            sessionToken: data.sessionToken,
            tabSessionId,
          }),
        );
        window.location.replace("index.html");
      } catch (err) {
        console.error("Gagal memeriksa login kiosk:", err);
        showModalNotice(
          "Belum Bisa Masuk",
          getFriendlyErrorMessage(err, "login"),
          "error",
        );
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<i class="fa-solid fa-bolt"></i> Masuk & Aktifkan Layar`;
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeKioskLogin, {
    once: true,
  });
} else {
  initializeKioskLogin();
}
