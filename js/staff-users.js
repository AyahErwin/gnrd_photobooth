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
  const kioskField = document.getElementById("staff-user-kiosk-field");
  const kiosksContainer = document.getElementById("staff-user-kiosks");
  const tableBody = document.getElementById("staff-users-body");
  const message = document.getElementById("staff-users-message");
  const saveButton = document.getElementById("btn-save-staff-user");
  const cancelButton = document.getElementById("btn-cancel-staff-edit");
  const isOwner = profile.role === "owner";
  let availableKiosks = [];

  function getSelectedKioskIds() {
    return Array.from(
      kiosksContainer.querySelectorAll('input[name="staff-user-kiosk"]:checked'),
      (input) => input.value,
    );
  }

  function setSelectedKioskIds(kioskIds) {
    const selected = new Set(kioskIds || []);
    kiosksContainer
      .querySelectorAll('input[name="staff-user-kiosk"]')
      .forEach((input) => {
        input.checked = selected.has(input.value);
      });
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.remove("hidden", "bg-red-50", "text-red-700", "bg-green-50", "text-green-700");
    message.classList.add(...(isError ? ["bg-red-50", "text-red-700"] : ["bg-green-50", "text-green-700"]));
  }

  try {
    const response = await fetch("components/modal-notice.html");
    if (!response.ok) {
      throw new Error(`Gagal memuat dialog notifikasi (HTTP ${response.status}).`);
    }
    document.getElementById("modal-container").innerHTML = await response.text();
  } catch (error) {
    console.error("Gagal memuat dialog akun staf:", error);
    showMessage("Dialog konfirmasi belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.", true);
    return;
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
    kioskField.classList.toggle("hidden", !needsKiosk);
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
      const roleLabels = {
        hq_admin: "Admin Pusat",
        kiosk_admin: "Admin Kios",
      };
      [
        user.email,
        roleLabels[user.role] || user.role,
        (user.kioskNames || []).join(", ") || "-",
      ].forEach((value) => {
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
        setSelectedKioskIds(user.kioskIds || (user.kioskId ? [user.kioskId] : []));
        updateKioskField();
        document.getElementById("staff-form-title").textContent = "Edit akun";
        saveButton.textContent = "Simpan Perubahan";
        cancelButton.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      actionCell.appendChild(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ml-2 rounded-lg bg-red-50 px-3 py-1.5 font-semibold text-red-700";
      deleteButton.textContent = "Hapus";
      deleteButton.addEventListener("click", () => {
        showModalConfirm(
          "Konfirmasi Hapus",
          `Yakin ingin menghapus akun staf ${user.email}?`,
          async () => {
            deleteButton.disabled = true;
            deleteButton.textContent = "Menghapus...";
            let accountDeleted = false;
            try {
              await invokeStaffAdmin({
                action: "delete",
                userId: user.userId,
              });
              accountDeleted = true;
              if (userIdInput.value === user.userId) resetForm();
              await loadUsers();
              showModalNotice(
                "Berhasil Dihapus",
                `Akun staf ${user.email} berhasil dihapus.`,
                "success",
              );
            } catch (error) {
              console.error("Gagal menghapus akun staf:", error);
              deleteButton.disabled = false;
              deleteButton.textContent = "Hapus";
              showModalNotice(
                accountDeleted ? "Berhasil Dihapus" : "Data Belum Terhapus",
                accountDeleted
                  ? `Akun staf ${user.email} sudah dihapus, tetapi daftar akun belum bisa dimuat ulang. Muat ulang halaman untuk memperbarui daftar.`
                  : error.message || "Akun staf belum berhasil dihapus. Coba lagi.",
                accountDeleted ? "warning" : "error",
              );
            }
          },
          "Ya, Hapus",
          "Batal",
        );
      });
      actionCell.appendChild(deleteButton);
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

    availableKiosks = kiosks || [];
    kiosksContainer.replaceChildren();
    availableKiosks.forEach((kiosk) => {
      const label = document.createElement("label");
      label.className = "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "staff-user-kiosk";
      checkbox.value = kiosk.id;
      checkbox.className = "h-4 w-4 rounded border-gray-300 text-blue-600";
      const kioskName = document.createElement("span");
      kioskName.className = "text-sm text-gray-800";
      kioskName.textContent = `${kiosk.kiosk_code} — ${kiosk.kiosk_name}`;
      label.append(checkbox, kioskName);
      kiosksContainer.appendChild(label);
    });
    if (availableKiosks.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.className = "text-sm text-gray-500";
      emptyState.textContent = "Belum ada kios yang terdaftar.";
      kiosksContainer.appendChild(emptyState);
    }

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
    if (roleInput.value === "kiosk_admin" && getSelectedKioskIds().length === 0) {
      showMessage("Pilih setidaknya satu kios yang sudah terdaftar untuk Admin Kios.", true);
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan...";
    try {
      await invokeStaffAdmin({
        action: userIdInput.value ? "update" : "create",
        userId: userIdInput.value || undefined,
        email: emailInput.value.trim(),
        password: passwordInput.value || undefined,
        role: roleInput.value,
        kioskIds: roleInput.value === "kiosk_admin" ? getSelectedKioskIds() : [],
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
