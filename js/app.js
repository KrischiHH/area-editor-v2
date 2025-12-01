import { PublishClient } from './PublishClient.js';

// App-UI: Asset-Upload (Button + Drag&Drop), Audio-Panel und Publizieren
// Voraussetzung: window.sceneManager ist bereits von js/main.js gesetzt.

(() => {
  // State
  const assetFiles = new Map();     // name -> File
  const assetBlobUrls = new Map();  // name -> objectURL

  const AUDIO_EXT = ['mp3','ogg','m4a'];
  const VIDEO_EXT = ['mp4','webm'];
  const IMAGE_EXT = ['jpg','jpeg','png','webp'];
  const MODEL_EXT = ['glb','gltf','usdz','bin'];

  function getFileExtension(filename) {
    return (filename || '').split('.').pop().toLowerCase();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B','KB','MB','GB'];
    let i = 0; let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 ? 2 : 1) + ' ' + units[i];
  }

  function rebuildAssetList() {
    const ul = document.getElementById('asset-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (assetFiles.size === 0) {
      ul.innerHTML = '<li class="empty">Noch keine Assets</li>';
      return;
    }
    for (const [name, file] of assetFiles.entries()) {
      const li = document.createElement('li');
      const title = document.createElement('div');
      title.textContent = name;

      const badge = document.createElement('span');
      badge.className = 'asset-type';
      const ext = getFileExtension(name);
      if (MODEL_EXT.includes(ext)) badge.textContent = 'model';
      else if (IMAGE_EXT.includes(ext)) badge.textContent = 'image';
      else if (AUDIO_EXT.includes(ext)) badge.textContent = 'audio';
      else if (VIDEO_EXT.includes(ext)) badge.textContent = 'video';
      else badge.textContent = 'other';

      const sizeEl = document.createElement('span');
      sizeEl.style.fontSize = '10px';
      sizeEl.style.color = 'var(--text-muted)';
      sizeEl.textContent = formatBytes(file.size);

      const actions = document.createElement('div');
      actions.className = 'asset-actions';

      const btnRemove = document.createElement('button');
      btnRemove.textContent = '✕';
      btnRemove.title = 'Asset entfernen';
      btnRemove.onclick = () => {
        if (assetBlobUrls.has(name)) {
          URL.revokeObjectURL(assetBlobUrls.get(name));
          assetBlobUrls.delete(name);
        }
        const sel = document.getElementById('sel-audio-file');
        const ext2 = getFileExtension(name);
        if (sel && AUDIO_EXT.includes(ext2)) {
          [...sel.options].forEach(o => { if (o.value === name) o.remove(); });
          if (sel.value === name) {
            sel.value = '';
            sel.dispatchEvent(new Event('input'));
          }
        }
        assetFiles.delete(name);
        rebuildAssetList();
        syncAudioToScene();
      };

      actions.appendChild(btnRemove);
      li.appendChild(title);
      li.appendChild(badge);
      li.appendChild(sizeEl);
      li.appendChild(actions);
      ul.appendChild(li);
    }
  }

  function ensureSceneManager() {
    const mgr = window.sceneManager;
    if (!mgr) {
      console.error('sceneManager fehlt. Stelle sicher, dass js/main.js vor js/app.js geladen wird.');
      return null;
    }
    return mgr;
  }

  function handleFiles(fileList) {
    const mgr = ensureSceneManager();
    if (!mgr) return;

    const files = Array.from(fileList || []);
    for (const file of files) {
      const ext = getFileExtension(file.name);
      if (![...MODEL_EXT, ...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT].includes(ext)) {
        console.warn('Nicht unterstützte Datei:', file.name);
        continue;
      }

      if (assetFiles.has(file.name)) {
        const overwrite = confirm(`Datei "${file.name}" existiert schon. Überschreiben?`);
        if (!overwrite) continue;
        if (assetBlobUrls.has(file.name)) {
          URL.revokeObjectURL(assetBlobUrls.get(file.name));
          assetBlobUrls.delete(file.name);
        }
      }

      assetFiles.set(file.name, file);

      if (ext === 'glb' || ext === 'gltf') {
        const blobUrl = URL.createObjectURL(file);
        assetBlobUrls.set(file.name, blobUrl);
        try {
          mgr.loadModel(blobUrl, file.name);
        } catch (e) {
          console.error('Fehler beim Laden des Modells:', e);
        }
      }

      if (AUDIO_EXT.includes(ext)) {
        const sel = document.getElementById('sel-audio-file');
        if (sel && ![...sel.options].some(o => o.value === file.name)) {
          const opt = document.createElement('option');
          opt.value = file.name;
          opt.textContent = file.name;
          sel.appendChild(opt);
        }
      }
    }

    rebuildAssetList();
    syncAudioToScene();
  }

  function syncAudioToScene() {
    const mgr = ensureSceneManager();
    if (!mgr) return;
    const selAudioFile = document.getElementById('sel-audio-file');
    const chkAudioLoop = document.getElementById('chk-audio-loop');
    const inpDelay = document.getElementById('inp-audio-delay');
    const inpVol = document.getElementById('inp-audio-vol');

    const state = {
      url: selAudioFile?.value || '',
      loop: !!chkAudioLoop?.checked,
      delaySeconds: parseFloat(inpDelay?.value) || 0,
      volume: (() => {
        const v = parseFloat(inpVol?.value);
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
      })()
    };
    mgr.setAudioConfig(state);
  }

  function wireAudioPanel() {
    ['sel-audio-file','chk-audio-loop','inp-audio-delay','inp-audio-vol']
      .map(id => document.getElementById(id))
      .forEach(el => el && el.addEventListener('input', syncAudioToScene));
    syncAudioToScene();
  }

  function wireAssetButtons() {
    const btnAddAssets = document.getElementById('btnAddAssets');
    const assetInput = document.getElementById('asset-upload-input');
    const assetDropzone = document.getElementById('asset-dropzone');
    const dropOverlay = document.getElementById('drop-overlay');

    btnAddAssets?.addEventListener('click', () => assetInput?.click());
    assetInput?.addEventListener('change', e => {
      handleFiles(e.target.files);
      e.target.value = '';
    });

    document.addEventListener('dragover', e => {
      e.preventDefault();
      dropOverlay?.classList.add('drag-active');
    });
    document.addEventListener('dragleave', e => {
      if (e.clientX === 0 || e.clientY === 0 || e.clientX === window.innerWidth || e.clientY === window.innerHeight) {
        dropOverlay?.classList.remove('drag-active');
      }
    });
    dropOverlay?.addEventListener('drop', e => {
      e.preventDefault();
      dropOverlay.classList.remove('drag-active');
      if (e.dataTransfer.items) {
        const fs = [];
        for (const item of e.dataTransfer.items) {
          if (item.kind === 'file') fs.push(item.getAsFile());
        }
        handleFiles(fs);
      } else {
        handleFiles(e.dataTransfer.files);
      }
    });

    assetDropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      assetDropzone.classList.add('drag-active');
    });
    assetDropzone?.addEventListener('dragleave', e => {
      if (e.relatedTarget === null) assetDropzone.classList.remove('drag-active');
    });
    assetDropzone?.addEventListener('drop', e => {
      e.preventDefault();
      assetDropzone.classList.remove('drag-active');
      if (e.dataTransfer.items) {
        const fs = [];
        for (const item of e.dataTransfer.items) {
          if (item.kind === 'file') fs.push(item.getAsFile());
        }
        handleFiles(fs);
      } else {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  // Endpunkte: feste Defaults, optional per URL überschreibbar
  function getEndpoints() {
    const params = new URLSearchParams(location.search);
    const publishUrl   = params.get('publish')
      || 'https://area-publish-proxy.area-webar.workers.dev/publish';
    const viewerBase   = params.get('viewer')
      || 'https://krischihh.github.io/area-viewer-v2/viewer.html';
    const workerOrigin = params.get('base')
      || 'https://area-publish-proxy.area-webar.workers.dev';
    return { publishUrl, viewerBase, workerOrigin };
  }

  function wirePublish() {
    const btn = document.getElementById('btnPublish');
    const status = document.getElementById('publish-status');
    if (!btn || !status) return;

    const show = (html) => { status.innerHTML = html; };
    const showText = (txt) => { status.textContent = txt; };

    const { publishUrl, viewerBase, workerOrigin } = getEndpoints();
    if (!publishUrl || !viewerBase || !workerOrigin) {
      show('Hinweis: Endpunkte fehlen. Übergib sie per URL-Parametern ?publish=…&viewer=…&base=…');
    }

    btn.addEventListener('click', async () => {
      const mgr = ensureSceneManager();
      if (!mgr) return;

      const { publishUrl, viewerBase, workerOrigin } = getEndpoints();
      if (!publishUrl || !viewerBase || !workerOrigin) {
        show(
          'Fehlende Parameter. Beispiel-URL:<br><code>?publish=https://area-publish-proxy.area-webar.workers.dev/publish&viewer=https://krischihh.github.io/area-viewer-v2/viewer.html&base=https://area-publish-proxy.area-webar.workers.dev</code>'
        );
        return;
      }

      const hasModel = [...assetFiles.keys()].some(n => {
        const ext = getFileExtension(n);
        return ext === 'glb' || ext === 'gltf';
      });
      if (!hasModel) {
        show('Bitte zuerst ein GLB/GLTF-Modell hinzufügen.');
        return;
      }

      btn.disabled = true;
      showText('Bereite Upload vor…');

      try {
        const sceneConfig = mgr.getSceneConfig();
        if (!sceneConfig?.model?.url) {
          console.warn('getSceneConfig(): model.url fehlt – bitte prüfen.');
        }

        const title = (sceneConfig.meta?.title || 'scene')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g,'-')
          .replace(/^-+|-+$/g,'') || 'scene';
        const sceneId = `${title}-${Date.now()}`;
        const assets = Array.from(assetFiles.values());

        const client = new PublishClient(publishUrl, viewerBase, workerOrigin);
        showText('Lade Szene hoch…');
        const res = await client.publish(sceneId, sceneConfig, assets);

        const link = document.createElement('a');
        link.href = res.viewerUrl;
        link.textContent = 'Viewer öffnen';
        link.target = '_blank';
        link.rel = 'noopener';
        status.innerHTML = 'Erfolg: ';
        status.appendChild(link);
        if (res.shareUrl) {
          const br = document.createElement('br');
          status.appendChild(br);
          const share = document.createElement('a');
          share.href = res.shareUrl;
          share.textContent = 'Share-Link';
          share.target = '_blank';
          share.rel = 'noopener';
          status.appendChild(share);
        }
      } catch (e) {
        status.innerHTML = '';
        const div = document.createElement('div');
        div.style.whiteSpace = 'pre-wrap';
        div.textContent = 'Fehler beim Publizieren: ' + (e?.message || e);
        status.appendChild(div);
        if (/403/.test(String(e?.message))) {
          const hint = document.createElement('div');
          hint.style.marginTop = '6px';
          hint.textContent =
            'Hinweis: 403 kommt jetzt vom Worker/Proxy. Prüfe in Cloudflare, ob UPSTREAM_KEY und PUBLISH_KEY identisch sind und der Editor wirklich den Proxy-Endpunkt nutzt.';
          status.appendChild(hint);
        }
        console.error(e);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function wireObjectList() {
    const mgr = ensureSceneManager();
    if (!mgr) return;

    const objectList  = document.getElementById('object-list');
    const propContent = document.getElementById('prop-content');
    const propEmpty   = document.getElementById('prop-empty');

    const inpName    = document.getElementById('inp-name');
    const inpPos     = {
      x: document.getElementById('inp-px'),
      y: document.getElementById('inp-py'),
      z: document.getElementById('inp-pz')
    };
    const inpRot     = {
      x: document.getElementById('inp-rx'),
      y: document.getElementById('inp-ry'),
      z: document.getElementById('inp-rz')
    };
    const inpScale   = document.getElementById('inp-s');
    const inpLinkUrl = document.getElementById('inp-link-url');

    function refreshObjectList() {
      if (!objectList) return;
      objectList.innerHTML = '';

      if (mgr.editableObjects.length === 0) {
        objectList.innerHTML = `<li class="empty-state">Keine Objekte</li>`;
        return;
      }

      mgr.editableObjects.forEach(obj => {
        const li = document.createElement('li');
        li.textContent = obj.name || 'Unbenannt';
        if (mgr.selectedObjects.includes(obj)) {
          li.classList.add('selected');
        }
        li.addEventListener('click', e => {
          mgr.selectObject(obj, e.shiftKey || e.ctrlKey || e.metaKey);
          refreshObjectList();
          updatePropsUI();
        });
        objectList.appendChild(li);
      });
    }

    function updatePropsUI() {
      const sel = mgr.selectedObjects;
      if (!propContent || !propEmpty) return;

      if (sel.length === 1) {
        propContent.classList.remove('hidden');
        propEmpty.classList.add('hidden');
        const obj = sel[0];

        inpName.value   = obj.name || '';
        inpPos.x.value  = obj.position.x.toFixed(2);
        inpPos.y.value  = obj.position.y.toFixed(2);
        inpPos.z.value  = obj.position.z.toFixed(2);

        const toDeg = a => (a * 180 / Math.PI).toFixed(1);
        inpRot.x.value = toDeg(obj.rotation.x);
        inpRot.y.value = toDeg(obj.rotation.y);
        inpRot.z.value = toDeg(obj.rotation.z);

        inpScale.value   = obj.scale.x.toFixed(2);
        inpLinkUrl.value = obj.userData.linkUrl || '';
      } else {
        propContent.classList.add('hidden');
        propEmpty.classList.remove('hidden');
        inpLinkUrl.value = '';
      }
    }

    function applyTransform() {
      if (mgr.selectedObjects.length !== 1) return;
      const p = {
        x: parseFloat(inpPos.x.value),
        y: parseFloat(inpPos.y.value),
        z: parseFloat(inpPos.z.value)
      };
      const r = {
        x: parseFloat(inpRot.x.value),
        y: parseFloat(inpRot.y.value),
        z: parseFloat(inpRot.z.value)
      };
      const s = parseFloat(inpScale.value);

      mgr.updateSelectedTransform(p, r, s);

      if (mgr.selectedObjects.length === 1) {
        mgr.selectedObjects[0].name = inpName.value;
        refreshObjectList();
      }
    }

    [inpName, inpScale, ...Object.values(inpPos), ...Object.values(inpRot)]
      .forEach(el => el && el.addEventListener('input', applyTransform));

    inpLinkUrl?.addEventListener('input', () => {
      if (mgr.selectedObjects.length === 1) {
        const obj = mgr.selectedObjects[0];
        const val = (inpLinkUrl.value || '').trim();
        try {
          if (val) new URL(val);
          obj.userData.linkUrl = val;
        } catch {
          // ungültige URL ignorieren
        }
      }
    });

    mgr.onSceneUpdate = () => {
      refreshObjectList();
      updatePropsUI();
    };
  }

  function init() {
    wireAssetButtons();
    wireAudioPanel();
    wireObjectList();
    wirePublish();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
