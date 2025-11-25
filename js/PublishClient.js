// /js/PublishClient.js

/**
 * Verwaltet den Upload der Szene (scene.json + Assets) an den Cloudflare Worker.
 */
export class PublishClient {
  constructor(publishUrl, viewerBase, publishKey, workerOrigin) {
    this.publishUrl = publishUrl;
    this.viewerBase = viewerBase;
    this.publishKey = publishKey;
    this.workerOrigin = workerOrigin;
  }

  /**
   * Führt den Upload durch.
   * @param {string} sceneId Die ID der Szene.
   * @param {object} sceneConfig Die gesamte Szene-Konfiguration (wird zu scene.json).
   * @param {Array<File>} assets Eine Liste von File-Objekten (GLB, JPG, etc.).
   * @returns {Promise<{sceneId: string, viewerUrl: string, shareUrl: string}>}
   */
  async publish(sceneId, sceneConfig, assets) {
    if (!this.publishKey) {
      throw new Error("Der X-AREA-Key fehlt.");
    }
    
    // 1. FormData zusammenstellen
    const fd = new FormData();
    fd.append('sceneId', sceneId);

    // 2. scene.json Blob erstellen und hinzufügen
    const jsonBlob = new Blob(
      [JSON.stringify(sceneConfig, null, 2)],
      { type: 'application/json' }
    );
    fd.append('file', jsonBlob, 'scene.json');

    // 3. Alle Assets hinzufügen
    for (const file of assets) {
      // Wichtig: Dateiname (dritter Parameter) muss korrekt sein, damit der Worker
      // ihn unter dem richtigen Pfad speichert.
      fd.append('file', file, file.name); 
    }

    // 4. Fetch zum Worker
    const res = await fetch(this.publishUrl, {
      method: 'POST',
      headers: { 
        'X-AREA-Key': this.publishKey,
        'X-AREA-Base': this.workerOrigin // Übergibt den Worker-Origin, falls der Proxy ihn braucht
      },
      body: fd
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(res.status + ' ' + res.statusText + (txt ? ' – ' + txt : ''));
    }

    const data = await res.json().catch(() => ({}));
    
    // 5. Viewer URL generieren (als Fallback, der Worker sollte sie aber zurückgeben)
    const returnedId   = data.sceneId || sceneId;
    const viewerUrl = data.viewerUrl || (
      `${this.viewerBase}?scene=${encodeURIComponent(returnedId)}&base=${encodeURIComponent(this.workerOrigin)}`
    );

    return {
        sceneId: returnedId,
        viewerUrl: viewerUrl,
        shareUrl: data.shareUrl || null
    };
  }
}
