async function initializeKioskManagement() {
  const form = document.getElementById("form-kiosk");
  const formTitle = document.getElementById("form-title");
  const kioskIdInput = document.getElementById("kiosk-id");
  const codeInput = document.getElementById("input-kiosk-code");
  const nameInput = document.getElementById("input-kiosk-name");
  const passwordInput = document.getElementById("input-kiosk-password");
  const packageTypeInput = document.getElementById("input-package-type");
  const locationInput = document.getElementById("input-kiosk-location");
  const btnCancel = document.getElementById("btn-cancel-edit");
  const btnSave = document.getElementById("btn-save-kiosk");
  const tbody = document.getElementById("table-kiosks-body");
  const countBadge = document.getElementById("kiosk-count");

  function displayNotice(
    title,
    message,
    iconType = "success",
    onConfirm = null,
  ) {
    if (typeof showModalNotice === "function") {
      showModalNotice(title, message, iconType, onConfirm);
    } else {
      console.log(`${title}: ${message}`);
      if (onConfirm) onConfirm();
    }
  }

  async function fetchKiosks() {
    try {
      const { data, error } = await supabaseClient
        .from("kiosks")
        .select(
          "id, kiosk_code, kiosk_name, package_type, location, is_active, created_at",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      renderTable(data || []);
    } catch (err) {
      console.error("Gagal memuat daftar kios:", err);
      if (tbody) {
        const message = getFriendlyErrorMessage(err, "load");
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.className = "p-4 text-center text-rose-400";
        cell.textContent = message;
        row.appendChild(cell);
        tbody.replaceChildren(row);
      }
    }
  }

  function renderTable(kiosks) {
    if (!countBadge || !tbody) return;
    countBadge.textContent = `${kiosks.length} Kios`;

    if (kiosks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-500">Belum ada kios terdaftar. Tambahkan melalui form di atas.</td></tr>`;
      return;
    }

    tbody.innerHTML = kiosks
      .map((k) => {
        const pkg = k.package_type || "FREE";
        const badgeColor =
          pkg === "FREE"
            ? "bg-gray-100 text-gray-700 border-gray-200"
            : "bg-amber-50 text-amber-700 border-amber-200";

        const statusLabel = k.is_active ? "SEDANG ONLINE" : "TIDAK AKTIF";
        const statusClass = k.is_active
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-gray-100 text-gray-600 border-gray-200";

        return `
        <tr class="hover:bg-blue-50/50 transition-colors">
          <td class="p-3 sm:p-4 font-mono font-semibold text-blue-700">${k.kiosk_code || "-"}</td>
          <td class="p-3 sm:p-4 font-semibold text-gray-900">${k.kiosk_name || "-"}</td>
          <td class="p-3 sm:p-4"><span class="px-2.5 py-1 rounded-full border text-xs font-medium ${badgeColor}">${pkg}</span></td>
          <td class="p-3 sm:p-4 text-gray-500">${k.location || "-"}</td>
          <td class="p-3 sm:p-4"><span class="px-2.5 py-1 rounded-full text-xs font-medium border ${statusClass}">${statusLabel}</span></td>
          <td class="p-3 sm:p-4 text-center">
            <div class="flex justify-center gap-2">
              <button onclick="editKiosk('${k.id}', '${k.kiosk_code}', '${k.kiosk_name}', '${pkg}', '${k.location || ""}')" class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-semibold transition-colors">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
              <button onclick="deleteKioskItem('${k.id}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-semibold transition-colors">
                <i class="fa-solid fa-trash"></i> Hapus
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

      const id = kioskIdInput.value;
      const kiosk_code = sanitizeInput(codeInput.value.trim());
      const kiosk_name = sanitizeInput(nameInput.value.trim());
      const password = sanitizeInput(passwordInput.value.trim());
      const package_type = packageTypeInput.value;
      const location = sanitizeInput(locationInput.value.trim());

      try {
        if (id) {
          const kioskUpdate = {
            kiosk_code,
            kiosk_name,
            package_type,
            location,
          };
          if (password) kioskUpdate.password = password;

          const { error } = await supabaseClient
            .from("kiosks")
            .update(kioskUpdate)
            .eq("id", id);

          if (error) throw error;
          displayNotice(
            "Berhasil",
            "Data kios berhasil diperbarui!",
            "success",
          );
        } else {
          if (!password) throw new Error("Masukkan password untuk kios baru.");
          const { error } = await supabaseClient.from("kiosks").insert([
            {
              kiosk_code,
              kiosk_name,
              password,
              package_type,
              location,
              is_active: false,
            },
          ]);

          if (error) throw error;
          displayNotice(
            "Berhasil",
            "Kios baru berhasil ditambahkan!",
            "success",
          );
        }

        resetForm();
        await fetchKiosks();
      } catch (err) {
        console.error("Gagal menyimpan data kios:", err);
        displayNotice(
          "Data Belum Tersimpan",
          getFriendlyErrorMessage(err, "save", kiosk_code),
          "error",
        );
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Data Kios`;
      }
    });
  }

  window.editKiosk = (id, code, name, packageType, location) => {
    kioskIdInput.value = id;
    codeInput.value = code;
    nameInput.value = name;
    passwordInput.value = "";
    passwordInput.required = false;
    passwordInput.placeholder = "Kosongkan jika tidak ingin mengganti";
    packageTypeInput.value = packageType;
    locationInput.value = location;

    formTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Data Kios`;
    btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Data`;
    btnCancel.classList.remove("hidden");
  };

  function resetForm() {
    if (!form) return;
    form.reset();
    kioskIdInput.value = "";
    passwordInput.required = true;
    passwordInput.placeholder = "••••••••";
    formTitle.innerHTML = `<i class="fa-solid fa-plus-circle"></i> Tambah Kios Baru`;
    btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Data Kios`;
    btnCancel.classList.add("hidden");
  }

  if (btnCancel) btnCancel.addEventListener("click", resetForm);

  window.deleteKioskItem = (id) => {
    showModalConfirm(
      "Konfirmasi Hapus",
      "Yakin ingin menghapus kios ini dari sistem?",
      async () => {
        try {
          const { error } = await supabaseClient
            .from("kiosks")
            .delete()
            .eq("id", id);

          if (error) throw error;
          fetchKiosks();
        } catch (err) {
          console.error("Gagal menghapus data kios:", err);
          displayNotice(
            "Data Belum Terhapus",
            getFriendlyErrorMessage(err, "delete"),
            "error",
          );
        }
      },
      "Ya, Hapus",
    );
  };

  if (typeof supabaseClient !== "undefined") {
    supabaseClient
      .channel("realtime_kiosks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kiosks" },
        () => fetchKiosks(),
      )
      .subscribe();
  }

  fetchKiosks();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeKioskManagement, {
    once: true,
  });
} else {
  initializeKioskManagement();
}
