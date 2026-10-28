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
        body: { action: "logout", sessionToken: activeKiosk.sessionToken },
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

      localStorage.removeItem("gnrd_active_kiosk");
      if (activeKiosk.operatorSession) {
        const { error: signOutError } = await supabaseClient.auth.signOut();
        if (signOutError) {
          console.error("Gagal keluar dari akun Operator:", signOutError);
          showModalNotice(
            "Login Operator Belum Berakhir",
            "Sesi kios telah berakhir, tetapi akun Operator belum berhasil keluar. Silakan coba lagi.",
            "error",
          );
          return;
        }
      }
      window.location.replace("login.html");
    },
    "Ya, Keluar",
    "Tidak jadi",
  );
};
