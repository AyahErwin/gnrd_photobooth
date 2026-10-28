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
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || !["owner", "hq_admin", "kiosk_admin"].includes(profile.role)) {
      await supabaseClient.auth.signOut();
      throw new Error("Akun ini tidak memiliki akses admin.");
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
