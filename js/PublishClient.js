// PublishClient: Upload der Szene (scene.json + Assets) zum Worker
export class PublishClient {
  /**
   * @param {string} publishUrl   Ziel-Endpoint (Proxy, z.B. https://area-publish-proxy.area-webar.workers.dev/publish)
   * @param {string} viewerBase   Basis zum Viewer (Fallback, falls Server keine viewerUrl liefert)
   * @param {string} workerOrigin Basis-URL des Workers (kommt in den Header X-AREA-Base)
   */
  constructor(publishUrl, viewerBase, workerOrigin) {
    this.publishUrl = publishUrl;
    this.viewerBase = viewerBase;
    this.workerOrigin = this._normalizeOrigin(workerOrigin);
  }

  _normalizeOrigin(input) {
    try {
      const u = new URL(input, window.location.href);
      return u.origin.replace(/\/+$/, '');
    } catch {
      return (input || '').replace(/\/+$/, '');
    }
  }

  async publish(sceneId, sceneConfig, files = []) {
    const form = new FormData();
    form.append('sceneId', sceneId);

    const sceneBlob = new Blob([JSON.stringify(sceneConfig, null, 2)], { type: 'application/json' });
    form.append('file', sceneBlob, 'scene.json');

    for (const f of files) {
      form.append('file', f, f.name);
    }

    const res = await fetch(this.publishUrl, {
      method: 'POST',
      body: form,
      headers: {
        'X-AREA-Base': this.workerOrigin
      }
    });

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      const statusText = res.statusText || '';
      throw new Error(`Publish fehlgeschlagen (${res.status}${statusText ? ' ' + statusText : ''}): ${body || 'Unbekannter Fehler'}`);
    }

    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (!data.viewerUrl && this.viewerBase) {
      try {
        const u = new URL(this.viewerBase, window.location.href);
        if (!u.searchParams.has('scene')) u.searchParams.set('scene', sceneId);
        if (!u.searchParams.has('base')) u.searchParams.set('base', this.workerOrigin);
        data.viewerUrl = u.toString();
      } catch {
        data.viewerUrl = `${this.viewerBase}?scene=${encodeURIComponent(sceneId)}&base=${encodeURIComponent(this.workerOrigin)}`;
      }
    }

    return data;
  }
}

export default PublishClient;
