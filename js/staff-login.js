const staffLoginForm = document.getElementById("form-staff-login");
const staffLoginMessage = document.getElementById("staff-login-message");
const staffLoginButton = document.getElementById("btn-staff-login");

staffLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  staffLoginButton.disabled = true;
  staffLoginButton.textContent = "Memeriksa akun...";
  staffLoginMessage.classList.add("hidden");

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: document.getElementById("staff-email").value.trim(),
      password: document.getElementById("staff-password").value,
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await supabaseClient
      .from("staff_profiles")
      .select("role, kiosk_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || !["owner", "hq_admin", "kiosk_admin", "operator"].includes(profile.role)) {
      await supabaseClient.auth.signOut();
      throw new Error("Akun ini tidak memiliki akses admin.");
    }

    if (profile.role === "operator") {
      const { data: kioskData, error: kioskError } =
        await supabaseClient.functions.invoke("kiosk-revenue", {
          body: { action: "operator_login" },
        });
      if (kioskError) {
        const response = kioskError.context;
        if (response && typeof response.json === "function") {
          const errorBody = await response.clone().json().catch(() => null);
          if (errorBody?.error) throw new Error(errorBody.error);
        }
        throw kioskError;
      }
      if (!kioskData?.success || !kioskData.kiosk || !kioskData.sessionToken) {
        throw new Error("Sesi operasional kios belum berhasil dibuat.");
      }

      localStorage.setItem(
        "gnrd_active_kiosk",
        JSON.stringify({
          ...kioskData.kiosk,
          sessionToken: kioskData.sessionToken,
          operatorSession: true,
        }),
      );
      window.location.replace("index.html");
      return;
    }

    window.location.replace("admin.html");
  } catch (error) {
    console.error("Login staf gagal:", error);
    staffLoginMessage.textContent =
      error.message || "Email atau password salah. Silakan coba lagi.";
    staffLoginMessage.classList.remove("hidden");
    staffLoginMessage.classList.add("bg-red-50", "text-red-700");
  } finally {
    staffLoginButton.disabled = false;
    staffLoginButton.textContent = "Masuk";
  }
});
