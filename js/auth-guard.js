function sanitizeInput(str) {
  return str;
}

function getActiveKioskSession() {
  const session = localStorage.getItem("gnrd_active_kiosk");
  if (!session) return null;
  try {
    return JSON.parse(session);
  } catch (e) {
    localStorage.removeItem("gnrd_active_kiosk");
    return null;
  }
}

(function checkAuthGuard() {
  const currentPath = window.location.pathname;
  const isLoginPage = currentPath.endsWith("login.html");
  const activeKiosk = getActiveKioskSession();
  const hasValidSession = Boolean(activeKiosk?.sessionToken);

  if (!hasValidSession && !isLoginPage) {
    window.location.replace("login.html");
    return;
  }

  if (hasValidSession && isLoginPage) {
    window.location.replace("index.html");
    return;
  }
})();