const staffLoginForm = document.getElementById("form-staff-login");
const staffLoginButton = document.getElementById("btn-staff-login");
const staffLoginTabSessionId = getOrCreateTabSessionId(true);

function showStaffLoginMessage(message, isError = true) {
  showModalNotice(
    isError ? "Login Admin Gagal" : "Informasi Login Admin",
    message,
    isError ? "error" : "warning",
  );
}

async function getFunctionErrorMessage(error) {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    const responseCopy = response.clone();
    try {
      const errorBody = await responseCopy.json();
      if (typeof errorBody?.error === "string") return errorBody.error;
      if (typeof errorBody?.message === "string") return errorBody.message;
    } catch {
      try {
        const responseText = await response.clone().text();
        if (responseText) return responseText;
      } catch (readError) {
        console.error("Gagal membaca detail error Edge Function:", readError);
      }
    }

    return `Edge Function gagal (HTTP ${response.status}). Pastikan fungsi staff-admin sedang berjalan.`;
  }
  return error?.message || "Email atau password salah. Silakan coba lagi.";
}

const pendingSessionNotice = sessionStorage.getItem("gnrd_login_session_notice");
if (pendingSessionNotice) {
  showStaffLoginMessage(pendingSessionNotice);
  sessionStorage.removeItem("gnrd_login_session_notice");
}

staffLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  staffLoginButton.disabled = true;
  staffLoginButton.textContent = "Memeriksa akun...";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: document.getElementById("staff-email").value.trim(),
      password: document.getElementById("staff-password").value,
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await supabaseClient
      .from("staff_profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || !["owner", "hq_admin", "kiosk_admin"].includes(profile.role)) {
      await supabaseClient.auth.signOut();
      throw new Error("Akun ini tidak memiliki akses admin.");
    }

    const sessionId = staffLoginTabSessionId;
    const claimStaffSession = (takeover = false) =>
      supabaseClient.functions.invoke("staff-admin", {
        body: { action: "session_claim", sessionId, takeover },
      });
    let { data: sessionResult, error: sessionError } = await claimStaffSession();
    if (sessionError) throw sessionError;

    if (sessionResult?.activeSession) {
      const shouldTakeOver = await showModalConfirm(
        "Akses ditolak",
        "User yang Anda coba gunakan sedang online di tab/perangkat lain. Apakah Anda ingin berpindah perangkat? Jika Ya, perangkat lama akan keluar.",
        null,
        "Ya, Berpindah",
        "Batal",
      );
      if (!shouldTakeOver) {
        const { error: signOutError } = await supabaseClient.auth.signOut({
          scope: "local",
        });
        if (signOutError) console.error("Gagal membatalkan login staf:", signOutError);
        showStaffLoginMessage(
          "Akses ditolak! User yang Anda coba gunakan sedang online di tab/perangkat lain.",
          false,
        );
        return;
      }

      ({ data: sessionResult, error: sessionError } = await claimStaffSession(true));
      if (sessionError) throw sessionError;
    }

    if (!sessionResult?.success) {
      throw new Error("Sesi akun belum berhasil dipindahkan. Silakan coba lagi.");
    }

    window.location.replace("admin.html");
  } catch (error) {
    console.error("Login staf gagal:", error);
    showStaffLoginMessage(await getFunctionErrorMessage(error));
  } finally {
    staffLoginButton.disabled = false;
    staffLoginButton.textContent = "Masuk";
  }
});
