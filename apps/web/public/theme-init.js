// DeskSpawn theme bootstrap — applied before the app bundle renders to avoid
// a light/dark flash. Loaded as an external script (script-src 'self')
// because the web CSP meta blocks inline scripts (Low-3 / Medium-6, 2026-08-28).
// Reads the same localStorage settings key the app uses.
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