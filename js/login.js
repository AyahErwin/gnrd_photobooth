async function initializeKioskLogin() {
  const loginForm = document.getElementById("form-kiosk-login");
  let failedAttempts = 0;
  let lockoutUntil = 0;

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
        const { data, error } = await supabaseClient.functions.invoke(
          "kiosk-revenue",
          {
            body: {
              action: "login",
              kioskCode,
              kioskPassword: kioskPass,
            },
          },
        );

        if (error) {
          console.error("Gagal memeriksa login kiosk:", error);
          const response = error.context;
          if (response && typeof response.json === "function") {
            const errorBody = await response.clone().json().catch(() => null);
            if (errorBody?.error) throw new Error(errorBody.error);
          }
          throw new Error("Kami belum bisa memeriksa data masuk. Periksa koneksi lalu coba lagi.");
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
        localStorage.setItem(
          "gnrd_active_kiosk",
          JSON.stringify({ ...data.kiosk, sessionToken: data.sessionToken }),
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
