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

  const sessionId = getOrCreateTabSessionId();
  if (await isDuplicateAppTab(sessionId)) {
    sessionStorage.setItem(
      "gnrd_login_session_notice",
      "Akses ditolak! User yang Anda coba gunakan sedang online di tab yang berbeda.",
    );
    await supabaseClient.auth.signOut({ scope: "local" });
    window.location.replace("staff-login.html");
    return null;
  }

  const { data: claimResult, error: claimError } =
    await supabaseClient.functions.invoke("staff-admin", {
      body: { action: "session_claim", sessionId },
    });
  if (claimError || !claimResult?.success) {
    if (claimError) console.error("Gagal mengunci sesi staf:", claimError);
    sessionStorage.setItem(
      "gnrd_login_session_notice",
      "Akses ditolak! User yang Anda coba gunakan sedang online di tab/perangkat lain.",
    );
    await supabaseClient.auth.signOut({ scope: "local" });
    window.location.replace("staff-login.html");
    return null;
  }

  let checkingSession = false;
  window.setInterval(async () => {
    if (checkingSession) return;
    checkingSession = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke(
        "staff-admin",
        { body: { action: "session_heartbeat", sessionId } },
      );
      if (error) throw error;
      if (!data?.success) {
        sessionStorage.setItem(
          "gnrd_login_session_notice",
          "Sesi login telah dipindahkan ke perangkat lain. Silakan login kembali.",
        );
        await supabaseClient.auth.signOut({ scope: "local" });
        window.location.replace("staff-login.html");
      }
    } catch (error) {
      console.error("Gagal memeriksa sesi aktif staf:", error);
    } finally {
      checkingSession = false;
    }
  }, 15000);

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

  if (profile.role === "kiosk_admin") {
    const { data: assignments, error: assignmentsError } = await supabaseClient
      .from("staff_kiosks")
      .select("kiosk_id")
      .eq("user_id", profile.user_id);

    if (assignmentsError) {
      console.error("Gagal memuat kios yang ditugaskan ke Admin Kios:", assignmentsError);
      window.location.replace("staff-login.html");
      return null;
    }

    const kioskIds = (assignments || []).map((assignment) => assignment.kiosk_id);
    if (kioskIds.length === 0 && profile.kiosk_id) kioskIds.push(profile.kiosk_id);
    const { data: assignedKiosks, error: kiosksError } = kioskIds.length
      ? await supabaseClient
          .from("kiosks")
          .select("id, kiosk_code, kiosk_name")
          .in("id", kioskIds)
          .order("kiosk_code", { ascending: true })
      : { data: [], error: null };

    if (kiosksError) {
      console.error("Gagal memuat data kios Admin Kios:", kiosksError);
      window.location.replace("staff-login.html");
      return null;
    }
    profile.assigned_kiosks = assignedKiosks || [];
    profile.kiosk_ids = profile.assigned_kiosks.map((kiosk) => kiosk.id);
    if (!profile.kiosk_ids.includes(profile.kiosk_id)) {
      profile.kiosk_id = profile.kiosk_ids[0] || null;
    }
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
      "rounded-xl border border-gray-400 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 hover:border-gray-500 shadow-sm transition-all";
    logoutButton.textContent = "Keluar";
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      const { error: releaseError } = await supabaseClient.functions.invoke(
        "staff-admin",
        { body: { action: "session_release", sessionId } },
      );
      if (releaseError) {
        console.error("Gagal mengakhiri sesi perangkat staf:", releaseError);
      }
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
})().catch((error) => {
  console.error("Gagal menyiapkan sesi halaman Admin:", error);

  const page = document.body;
  page.classList.remove("hidden");
  page.replaceChildren();

  const panel = document.createElement("main");
  panel.className = "admin-ios-card w-full max-w-lg p-6 text-center";

  const heading = document.createElement("h1");
  heading.className = "text-xl font-bold text-gray-900";
  heading.textContent = "Halaman Admin belum dapat dibuka";

  const message = document.createElement("p");
  message.className = "mt-3 text-sm text-gray-700";
  message.textContent =
    error instanceof Error
      ? error.message
      : "Terjadi kesalahan saat memeriksa sesi. Periksa koneksi Supabase lalu coba lagi.";

  const loginLink = document.createElement("a");
  loginLink.href = "staff-login.html";
  loginLink.className =
    "mt-5 inline-flex rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white";
  loginLink.textContent = "Kembali ke Login Admin";

  panel.append(heading, message, loginLink);
  page.appendChild(panel);
  return null;
});
