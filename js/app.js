// Global Application State & Notification Manager

// Fungsi untuk Menampilkan Custom Pop-up Modal
function showModalNotice(
  title,
  message,
  iconType = "success",
  onConfirm = null,
) {
  const modal = document.getElementById("global-modal-notice");
  const modalTitle = document.getElementById("modal-notice-title");
  const modalMessage = document.getElementById("modal-notice-message");
  const modalIcon = document.getElementById("modal-notice-icon");
  const btnConfirm = document.getElementById("btn-modal-notice-ok");

  if (!modal) {
    console.log(`${title}: ${message}`);
    if (onConfirm) onConfirm();
    return;
  }

  modalTitle.textContent = title;
  modalMessage.textContent = message;

  // Set Icon berdasarkan type
  if (iconType === "success") {
    modalIcon.className =
      "fa-solid fa-circle-check text-emerald-400 text-5xl mb-3";
  } else if (iconType === "warning") {
    modalIcon.className =
      "fa-solid fa-triangle-exclamation text-amber-400 text-5xl mb-3";
  } else if (iconType === "error") {
    modalIcon.className =
      "fa-solid fa-circle-xmark text-rose-500 text-5xl mb-3";
  }

  // Tampilkan Modal
  modal.classList.remove("hidden");

  // Action Klik Tombol OK
  const handleConfirm = () => {
    modal.classList.add("hidden");
    btnConfirm.removeEventListener("click", handleConfirm);
    if (typeof onConfirm === "function") {
      onConfirm();
    }
  };

  btnConfirm.addEventListener("click", handleConfirm);
}

// Logika Perpindahan Halaman Kiosk
function goToStep(stepNumber) {
  console.log(`Navigating to Step ${stepNumber}`);

  const allSteps = document.querySelectorAll(".kiosk-step");
  allSteps.forEach((step) => step.classList.add("hidden"));

  const targetStep = document.getElementById(`step-${stepNumber}`);
  if (targetStep) {
    targetStep.classList.remove("hidden");
  }

  if (stepNumber === 3) {
    if (typeof startCameraStream === "function") {
      startCameraStream();
    }
  }
}
