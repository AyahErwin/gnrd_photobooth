function sanitizeInput(str) {
  return str;
}

function getActiveKioskSession() {
  const session = sessionStorage.getItem("gnrd_active_kiosk");
  if (!session) return null;
  try {
    return JSON.parse(session);
  } catch (e) {
    sessionStorage.removeItem("gnrd_active_kiosk");
    return null;
  }
}

function getBrowserTabSessionId() {
  const storedSessionId = sessionStorage.getItem("gnrd_active_tab_session_id");
  if (storedSessionId) return storedSessionId;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  sessionStorage.setItem("gnrd_active_tab_session_id", sessionId);
  return sessionId;
}

function showLoginSessionNotice(message) {
  sessionStorage.setItem("gnrd_login_session_notice", message);
}

(function checkAuthGuard() {
  const currentPath = window.location.pathname;
  const isLoginPage = currentPath.endsWith("login.html");
  const activeKiosk = getActiveKioskSession();
  const hasValidSession = Boolean(activeKiosk?.sessionToken);

  if (!hasValidSession && !isLoginPage) {
    window.location.replace("login.html");
    return;
  }

  if (
    hasValidSession &&
    isLoginPage &&
    activeKiosk.tabSessionId === getBrowserTabSessionId()
  ) {
    window.location.replace("index.html");
    return;
  }

  if (hasValidSession && isLoginPage) {
    showLoginSessionNotice(
      "Akses ditolak! User yang Anda coba gunakan sedang online di tab yang berbeda.",
    );
  }

  if (hasValidSession && !isLoginPage) {
    if (activeKiosk.tabSessionId !== getBrowserTabSessionId()) {
      sessionStorage.removeItem("gnrd_active_kiosk");
      showLoginSessionNotice(
        "Akses ditolak! User yang Anda coba gunakan sedang online di tab yang berbeda.",
      );
      window.location.replace("login.html");
      return;
    }

    document.addEventListener(
      "DOMContentLoaded",
      async () => {
        if (await isDuplicateAppTab(activeKiosk.tabSessionId)) {
          sessionStorage.removeItem("gnrd_active_kiosk");
          showLoginSessionNotice(
            "Akses ditolak! User yang Anda coba gunakan sedang online di tab yang berbeda.",
          );
          window.location.replace("login.html");
          return;
        }

        let checkingSession = false;
        const checkSession = async () => {
          if (checkingSession) return;
          checkingSession = true;
          try {
            const { data, error } = await supabaseClient.functions.invoke(
              "kiosk-revenue",
              {
                body: {
                  action: "session_check",
                  sessionToken: activeKiosk.sessionToken,
                  tabSessionId: activeKiosk.tabSessionId,
                },
              },
            );
            if (error) throw error;
            if (!data?.success) {
              sessionStorage.removeItem("gnrd_active_kiosk");
              showLoginSessionNotice(
                "Sesi kios ini telah dipindahkan ke perangkat lain. Silakan login kembali.",
              );
              window.location.replace("login.html");
            }
          } catch (error) {
            console.error("Gagal memeriksa sesi aktif kios:", error);
          } finally {
            checkingSession = false;
          }
        };

        void checkSession();
        window.setInterval(checkSession, 15000);
      },
      { once: true },
    );
  }
})();