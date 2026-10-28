window.adminAuthReady = (async function protectAdminRoute() {
  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();
  if (sessionError) {
    console.error("Gagal memeriksa sesi staf:", sessionError);
    window.location.replace("staff-login.html");
    return null;
  }

  if (!sessionData.session) {
    window.location.replace("staff-login.html");
    return null;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("staff_profiles")
    .select("user_id, role, kiosk_id")
    .eq("user_id", sessionData.session.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Gagal memuat hak akses staf:", profileError);
    window.location.replace("staff-login.html");
    return null;
  }

  if (!profile || !["owner", "hq_admin", "kiosk_admin"].includes(profile.role)) {
    await supabaseClient.auth.signOut();
    window.location.replace("staff-login.html");
    return null;
  }

  const isHeadOffice = ["owner", "hq_admin"].includes(profile.role);
  const currentPage = window.location.pathname;
  if (
    (!isHeadOffice && currentPage.endsWith("kiosks.html")) ||
    (!isHeadOffice && currentPage.endsWith("staff-users.html"))
  ) {
    window.location.replace("admin.html");
    return null;
  }

  window.currentStaffProfile = profile;
  document.body.classList.remove("hidden");

  const user = sessionData.session.user;
  const roleLabels = {
    owner: "Owner",
    hq_admin: "Admin Pusat",
    kiosk_admin: "Admin Kios",
  };
  const container = document.getElementById("staff-session-bar");
  if (container) {
    const identity = document.createElement("span");
    identity.className = "text-sm text-gray-600";
    identity.textContent = `${user.email || "Staf"} | ${roleLabels[profile.role]}`;

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className =
      "rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50";
    logoutButton.textContent = "Keluar";
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error("Gagal keluar dari akun staf:", error);
        logoutButton.disabled = false;
        if (typeof showModalNotice === "function") {
          showModalNotice("Belum Bisa Keluar", "Silakan coba lagi.", "error");
        }
        return;
      }
      window.location.replace("staff-login.html");
    });

    container.replaceChildren(identity, logoutButton);
    container.classList.remove("hidden");
  }

  document.querySelectorAll("[data-head-office-only]").forEach((element) => {
    if (!["owner", "hq_admin"].includes(profile.role)) {
      element.classList.add("hidden");
    }
  });

  return profile;
})();
