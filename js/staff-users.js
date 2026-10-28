async function initializeStaffUsers() {
  const profile = await window.adminAuthReady;
  if (!profile) return;
  if (!["owner", "hq_admin"].includes(profile.role)) {
    window.location.replace("admin.html");
    return;
  }

  const form = document.getElementById("form-staff-user");
  const userIdInput = document.getElementById("staff-user-id");
  const emailInput = document.getElementById("staff-user-email");
  const passwordInput = document.getElementById("staff-user-password");
  const roleInput = document.getElementById("staff-user-role");
  const kioskInput = document.getElementById("staff-user-kiosk");
  const tableBody = document.getElementById("staff-users-body");
  const message = document.getElementById("staff-users-message");
  const saveButton = document.getElementById("btn-save-staff-user");
  const cancelButton = document.getElementById("btn-cancel-staff-edit");
  const isOwner = profile.role === "owner";

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.remove("hidden", "bg-red-50", "text-red-700", "bg-green-50", "text-green-700");
    message.classList.add(...(isError ? ["bg-red-50", "text-red-700"] : ["bg-green-50", "text-green-700"]));
  }

  function resetForm() {
    form.reset();
    userIdInput.value = "";
    passwordInput.required = true;
    document.getElementById("staff-form-title").textContent = "Tambah akun";
    saveButton.textContent = "Simpan Akun";
    cancelButton.classList.add("hidden");
    updateKioskField();
  }

  function updateKioskField() {
    const needsKiosk = roleInput.value === "kiosk_admin";
    kioskInput.required = needsKiosk;
    kioskInput.disabled = !needsKiosk;
    kioskInput.parentElement.classList.toggle("hidden", !needsKiosk);
  }

  async function invokeStaffAdmin(body) {
    const { data, error } = await supabaseClient.functions.invoke("staff-admin", { body });
    if (error) {
      const response = error.context;
      if (response && typeof response.json === "function") {
        const errorBody = await response.clone().json().catch(() => null);
        if (errorBody?.error) throw new Error(errorBody.error);
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function renderUsers(users) {
    tableBody.replaceChildren();
    if (!users.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "p-4 text-center text-gray-500";
      cell.textContent = "Belum ada akun staf tambahan.";
      row.appendChild(cell);
      tableBody.appendChild(row);
      return;
    }

    users.forEach((user) => {
      const row = document.createElement("tr");
      [user.email, user.role === "hq_admin" ? "Admin Kantor Pusat" : "Admin Kios", user.kioskName || "-"].forEach((value) => {
        const cell = document.createElement("td");
        cell.className = "p-3";
        cell.textContent = value;
        row.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      actionCell.className = "p-3";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "rounded-lg bg-blue-50 px-3 py-1.5 font-semibold text-blue-700";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        userIdInput.value = user.userId;
        emailInput.value = user.email;
        passwordInput.value = "";
        passwordInput.required = false;
        roleInput.value = user.role;
        kioskInput.value = user.kioskId || "";
        updateKioskField();
        document.getElementById("staff-form-title").textContent = "Edit akun";
        saveButton.textContent = "Simpan Perubahan";
        cancelButton.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      actionCell.appendChild(editButton);
      row.appendChild(actionCell);
      tableBody.appendChild(row);
    });
  }

  async function loadUsers() {
    tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Memuat akun...</td></tr>';
    const { users } = await invokeStaffAdmin({ action: "list" });
    renderUsers(users || []);
  }

  try {
    const { data: kiosks, error } = await supabaseClient
      .from("kiosks")
      .select("id, kiosk_code, kiosk_name")
      .order("kiosk_code", { ascending: true });
    if (error) throw error;

    kioskInput.replaceChildren();
    (kiosks || []).forEach((kiosk) => {
      const option = document.createElement("option");
      option.value = kiosk.id;
      option.textContent = `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`;
      kioskInput.appendChild(option);
    });

    if (!isOwner) {
      roleInput.querySelector('[data-owner-only]')?.remove();
    }
    roleInput.addEventListener("change", updateKioskField);
    updateKioskField();
    await loadUsers();
  } catch (error) {
    console.error("Gagal memuat akun staf:", error);
    showMessage(error.message || "Daftar akun belum bisa dimuat.", true);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan...";
    try {
      await invokeStaffAdmin({
        action: userIdInput.value ? "update" : "create",
        userId: userIdInput.value || undefined,
        email: emailInput.value.trim(),
        password: passwordInput.value || undefined,
        role: roleInput.value,
        kioskId: roleInput.value === "kiosk_admin" ? kioskInput.value : null,
      });
      resetForm();
      await loadUsers();
      showMessage("Akun staf berhasil disimpan.");
    } catch (error) {
      console.error("Gagal menyimpan akun staf:", error);
      showMessage(error.message || "Akun belum berhasil disimpan.", true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = userIdInput.value ? "Simpan Perubahan" : "Simpan Akun";
    }
  });

  cancelButton.addEventListener("click", resetForm);
}

document.addEventListener("DOMContentLoaded", initializeStaffUsers, { once: true });
