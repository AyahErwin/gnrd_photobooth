window.handleLogoutKiosk = async () => {
  const activeKiosk = getActiveKioskSession();
  showModalConfirm(
    "Konfirmasi Logout",
    "Yakin ingin keluar dan menonaktifkan layar kios ini?",
    async () => {
      if (!activeKiosk?.sessionToken) {
        showModalNotice(
          "Sesi Tidak Ditemukan",
          "Silakan masuk kembali ke kiosk.",
          "error",
        );
        return;
      }

      const { error } = await supabaseClient.functions.invoke("kiosk-revenue", {
        body: {
          action: "logout",
          sessionToken: activeKiosk.sessionToken,
          tabSessionId: activeKiosk.tabSessionId,
        },
      });
      if (error) {
        console.error("Gagal mengakhiri sesi kiosk:", error);
        showModalNotice(
          "Logout Belum Berhasil",
          "Periksa koneksi internet lalu coba lagi.",
          "error",
        );
        return;
      }

      sessionStorage.removeItem("gnrd_active_kiosk");
      sessionStorage.removeItem("gnrd_active_tab_session_id");
      window.location.replace("login.html");
    },
    "Ya, Keluar",
    "Tidak jadi",
  );
};
