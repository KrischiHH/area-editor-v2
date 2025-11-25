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

    const jsonBlob = new Blob(
      [JSON.stringify(sceneConfig, null, 2)],
      { type: 'application/json' }
    );
    fd.append('file', jsonBlob, 'scene.json');

    for (const file of assets) {
      fd.append('file', file, file.name); 
    }

    // WICHTIG: Wir senden KEINEN Key. Der Proxy fügt ihn hinzu.
    const res = await fetch(this.publishUrl, {
      method: 'POST',
      headers: { 
        'X-AREA-Base': this.workerOrigin 
      },
      body: fd
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(res.status + ' ' + res.statusText + (txt ? ' – ' + txt : ''));
    }

    const data = await res.json().catch(() => ({}));
    
    const returnedId = data.sceneId || sceneId;
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
