// PublishClient: Upload der Szene (scene.json + Assets) zum Worker
export class PublishClient {
  /**
   * @param {string} publishUrl - Ziel-Endpoint (z.B. https://area-publish.area-webar.workers.dev/publish)
   * @param {string} viewerBase - Basis zum Viewer (wird für Fallback-URL genutzt, falls Server keine viewerUrl liefert)
   * @param {string} workerOrigin - Basis-URL des Workers (kommt in den Header X-AREA-Base)
   * @param {string} [publishKey] - Optionaler geheimer Key (aus localStorage), wird als X-AREA-Key gesendet
   */
  constructor(publishUrl, viewerBase, workerOrigin, publishKey = '') {
    this.publishUrl = publishUrl;
    this.viewerBase = viewerBase;
    this.workerOrigin = workerOrigin;
    this.publishKey = publishKey || '';
  }

  /**
   * @param {string} sceneId
   * @param {object} sceneConfig
   * @param {File[]} files
   * @returns {Promise<{viewerUrl?: string, shareUrl?: string, sceneId?: string}>}
   */
  async publish(sceneId, sceneConfig, files = []) {
    const form = new FormData();
    form.append('sceneId', sceneId);

    // scene.json anhängen
    const sceneBlob = new Blob([JSON.stringify(sceneConfig, null, 2)], { type: 'application/json' });
    form.append('file', sceneBlob, 'scene.json');

    // weitere Dateien (GLB, Texturen, Audio, Video, …)
    for (const f of files) {
      form.append('file', f, f.name);
    }

    const headers = {
      'X-AREA-Base': this.workerOrigin
    };
    if (this.publishKey) {
      headers['X-AREA-Key'] = this.publishKey;
    }

    const res = await fetch(this.publishUrl, {
      method: 'POST',
      body: form,
      headers
    });

    if (!res.ok) {
      let msg = '';
      try { msg = await res.text(); } catch (_) {}
      throw new Error(`Publish fehlgeschlagen (${res.status}): ${msg || 'Unbekannter Fehler'}`);
    }

    // Antwort verarbeiten – falls viewerUrl fehlt, lokal konstruieren
    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (!data.viewerUrl && this.viewerBase) {
      try {
        const u = new URL(this.viewerBase, window.location.href);
        if (!u.searchParams.has('scene')) u.searchParams.set('scene', sceneId);
        if (!u.searchParams.has('base')) u.searchParams.set('base', this.workerOrigin);
        data.viewerUrl = u.toString();
      } catch (_) {
        // viewerBase ist evtl. eine vollständige URL mit Parametern – dann nicht ändern
        data.viewerUrl = `${this.viewerBase}?scene=${encodeURIComponent(sceneId)}&base=${encodeURIComponent(this.workerOrigin)}`;
      }
    }

    return data;
  }
}

export default PublishClient;
