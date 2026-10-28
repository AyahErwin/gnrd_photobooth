function initializeKioskRevenueReport() {
  const form = document.getElementById("form-kiosk-revenue");
  if (!form) return;

  const dateInput = document.getElementById("revenue-date");
  const submitButton = document.getElementById("btn-load-revenue");
  const message = document.getElementById("revenue-report-message");
  const reportContent = document.getElementById("revenue-report-content");
  const currency = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  function normalizeReportDate(rawValue) {
    if (!rawValue) return null;

    const value = String(rawValue).trim();
    const isoMatch = /^\d{4}-\d{2}-\d{2}$/.exec(value);
    if (isoMatch) return value;

    const slashMatch =
      /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.exec(value) ||
      /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.exec(value);

    if (!slashMatch) return null;

    const parts = value.split(/[/-]/).map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    const [first, second, third] = parts;
    let year;
    let month;
    let day;

    if (String(third).length === 4) {
      year = third;
      month = first;
      day = second;
    } else if (String(first).length === 4) {
      year = first;
      month = second;
      day = third;
    } else {
      return null;
    }

    const safeYear = String(year).padStart(4, "0");
    const safeMonth = String(month).padStart(2, "0");
    const safeDay = String(day).padStart(2, "0");
    return `${safeYear}-${safeMonth}-${safeDay}`;
  }

  function localDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.remove("hidden", "bg-red-50", "text-red-700", "bg-green-50", "text-green-700");
    message.classList.add(
      ...(isError
        ? ["bg-red-50", "text-red-700"]
        : ["bg-green-50", "text-green-700"]),
    );
  }

  function makeCell(row, value, className = "px-4 py-3") {
    const cell = document.createElement("td");
    cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }

  function renderRanking(targetId, kiosks) {
    const tbody = document.getElementById(targetId);
    tbody.replaceChildren();

    if (!kiosks.length) {
      const row = document.createElement("tr");
      const cell = makeCell(row, "Belum ada data kios.", "px-4 py-3 text-gray-500");
      cell.colSpan = 2;
      tbody.appendChild(row);
      return;
    }

    kiosks.forEach((kiosk) => {
      const row = document.createElement("tr");
      makeCell(row, `${kiosk.kiosk_name} (${kiosk.kiosk_code})`);
      makeCell(row, currency.format(kiosk.revenue), "px-4 py-3 text-right font-semibold");
      tbody.appendChild(row);
    });
  }

  function renderRevenueByKiosk(kiosks) {
    const tbody = document.getElementById("revenue-by-kiosk");
    tbody.replaceChildren();

    if (!kiosks.length) {
      const row = document.createElement("tr");
      const cell = makeCell(row, "Belum ada kios yang terdaftar.", "px-4 py-4 text-center text-gray-500");
      cell.colSpan = 5;
      tbody.appendChild(row);
      return;
    }

    kiosks.forEach((kiosk) => {
      const row = document.createElement("tr");
      makeCell(row, kiosk.kiosk_code);
      makeCell(row, kiosk.kiosk_name);
      makeCell(row, kiosk.location || "-");
      makeCell(row, String(kiosk.transactionCount), "px-4 py-3 text-center");
      makeCell(row, currency.format(kiosk.revenue), "px-4 py-3 text-right font-semibold");
      tbody.appendChild(row);
    });
  }

  dateInput.value = localDateValue(new Date());

  async function loadReport() {
    submitButton.disabled = true;
    submitButton.textContent = "Memuat laporan...";
    reportContent.classList.add("hidden");
    message.classList.add("hidden");

    try {
      const normalizedDate = normalizeReportDate(dateInput.value) || localDateValue(new Date());
      dateInput.value = normalizedDate;

      const { data, error } = await supabaseClient.functions.invoke(
        "kiosk-revenue",
        {
          body: {
            action: "report",
            date: normalizedDate,
          },
        },
      );

      if (error) {
        console.error("Gagal memuat laporan penghasilan:", error);
        const response = error.context;

        if (response && typeof response.json === "function") {
          const errorBody = await response.clone().json().catch(() => null);
          if (errorBody?.error) throw new Error(errorBody.error);
        }
        throw new Error("Laporan belum bisa dimuat. Periksa koneksi, lalu coba lagi.");
      }

      document.getElementById("revenue-total").textContent =
        currency.format(data.totalRevenue);
      document.getElementById("revenue-transaction-count").textContent =
        String(data.transactionCount);
      renderRanking("revenue-highest", data.highest || []);
      renderRanking("revenue-lowest", data.lowest || []);
      renderRevenueByKiosk(data.revenueByKiosk || []);
      reportContent.classList.remove("hidden");
      showMessage(`Laporan tanggal ${normalizedDate} berhasil dimuat.`);
    } catch (error) {
      console.error("Gagal menampilkan laporan penghasilan:", error);
      showMessage(
        error.message ||
          "Laporan belum bisa dimuat. Silakan coba lagi atau hubungi pengelola.",
        true,
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Tampilkan Laporan";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadReport();
  });

  loadReport();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeKioskRevenueReport, {
    once: true,
  });
} else {
  initializeKioskRevenueReport();
}
