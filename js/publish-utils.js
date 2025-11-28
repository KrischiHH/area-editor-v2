// Kleines Hilfsmodul: Fetch mit Timeout und klarer Fehlerbehandlung
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export function setPublishStatusEl(el, status, message = "") {
  // status: "idle" | "pending" | "success" | "error"
  el.textContent = message || (
    status === "pending" ? "Publiziere…" :
    status === "success" ? "Veröffentlicht!" :
    status === "error" ? "Fehler beim Publizieren" :
    ""
  );
  el.dataset.status = status;
}
