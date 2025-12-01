// /js/PublishClient.js

export class PublishClient {
  // Kein Key mehr im Constructor nötig!
  constructor(publishUrl, viewerBase, workerOrigin) {
    this.publishUrl = publishUrl;
    this.viewerBase = viewerBase;
    this.workerOrigin = workerOrigin;
  }

  async publish(sceneId, sceneConfig, assets) {
    const fd = new FormData();
    fd.append('sceneId', sceneId);

    // Erstelle eine Blob aus der Szene-Konfiguration
    const jsonBlob = new Blob(
      [JSON.stringify(sceneConfig, null, 2)],
      { type: 'application/json' }
    );
    fd.append('file', jsonBlob, 'scene.json');

    // Füge alle Assets hinzu
    for (const file of assets) {
      fd.append('file', file, file.name);
    }

    let res;
    try {
      // Versuche, die Daten an den Publish-Endpunkt zu senden
      res = await fetch(this.publishUrl, {
        method: 'POST',
        headers: {
          'X-AREA-Base': this.workerOrigin
          // Content-Type bei FormData NICHT setzen (Browser setzt Boundary)
        },
        body: fd
      });
    } catch (networkErr) {
      // Fehler bei der Netzwerkverbindung (z.B. CORS, Server down)
      throw new Error('Netzwerkfehler beim Publish: ' + (networkErr?.message || networkErr));
    }

    if (!res.ok) {
      // HTTP-Fehler (z.B. 404, 500, 401)
      let txt = '';
      try { txt = await res.text(); } catch(_) {}
      throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ' – ' + txt : ''}`);
    }

    let data = {};
    try { data = await res.json(); } catch(_) {}

    // Verwende die zurückgegebene sceneId oder die ursprüngliche ID
    const returnedId = data.sceneId || sceneId;

    // Erstelle die Viewer URL mit den korrekten Parametern
    const viewerUrl = data.viewerUrl || (
      `${this.viewerBase}?scene=${encodeURIComponent(returnedId)}&base=${encodeURIComponent(this.workerOrigin)}`
    );

    return {
      sceneId: returnedId,
      viewerUrl,
      shareUrl: data.shareUrl || null
    };
  }
}
