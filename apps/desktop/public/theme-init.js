// DeskSpawn theme bootstrap — applied before the app bundle renders to avoid
// a light/dark flash. Loaded as an external script (script-src 'self')
// because inline scripts are blocked by the production CSP (Low-3, 2026-08-28).
// Reads the same localStorage mirror that saveSettingsDesktop() writes.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("deskspawn_settings"));
    if (s && s.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (!s || s.theme === "system") {
      if (window.matchMedia("(prefers-color-scheme:dark)").matches) {
        document.documentElement.classList.add("dark");
      }
    }
  } catch (e) {
    // malformed settings — fall back to default (light)
  }
})();