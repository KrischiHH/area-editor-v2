import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';
import * as THREE from 'three';

const CONFIG = {
  WORKER_ORIGIN: 'https://area-publish-proxy.area-webar.workers.dev',
  VIEWER_BASE: 'https://krischihh.github.io/area-viewer-v2/viewer.html',
  PUBLISH_ENDPOINT: '/publish'
};

let sceneManager;
const assetFiles = new Map();           // filename -> File
const assetBlobUrls = new Map();        // filename -> objectURL (nur für Modelle)
const AUDIO_EXT = ['mp3','ogg','m4a'];
const VIDEO_EXT = ['mp4','webm'];

function getFileExtension(filename){ return filename.split('.').pop().toLowerCase(); }

function classifyAsset(file) {
  const ext = getFileExtension(file.name);
  if (['glb','gltf','usdz'].includes(ext)) return 'model';
  if (['jpg','jpeg','png','webp'].includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'other';
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return v.toFixed(v < 10 ? 2 : 1) + ' ' + units[i];
}

function rebuildAssetList() {
  const ul = document.getElementById('asset-list');
  ul.innerHTML = '';
  if (assetFiles.size === 0) {
    ul.innerHTML = '<li class="empty">Noch keine Assets</li>';
    return;
  }
  for (const [name, file] of assetFiles.entries()) {
    const li = document.createElement('li');
    const type = classifyAsset(file);
    const title = document.createElement('div'); title.textContent = name;
    const badge = document.createElement('span'); badge.className = 'asset-type'; badge.textContent = type;
    const sizeEl = document.createElement('span'); sizeEl.style.fontSize='10px'; sizeEl.style.color='var(--text-muted)'; sizeEl.textContent = formatBytes(file.size);
    const actions = document.createElement('div'); actions.className = 'asset-actions';

    if (type === 'audio') {
      const btnAudio = document.createElement('button');
      btnAudio.textContent = '▶'; btnAudio.title='Audio-Vorschau'; btnAudio.className='audio-preview-btn';
      let audioObj = null;
      btnAudio.onclick = () => {
        if (!audioObj) {
          audioObj = new Audio(URL.createObjectURL(file));
          audioObj.onended = () => { btnAudio.textContent='▶'; btnAudio.classList.remove('playing'); };
        }
        if (audioObj.paused) {
          audioObj.play().catch(e=>console.warn('Audio preview failed',e));
          btnAudio.textContent='⏸'; btnAudio.classList.add('playing');
        } else {
          audioObj.pause(); btnAudio.textContent='▶'; btnAudio.classList.remove('playing');
        }
      };
      actions.appendChild(btnAudio);
    }

    const btnRemove = document.createElement('button');
    btnRemove.textContent='✕'; btnRemove.title='Asset entfernen';
    btnRemove.onclick = () => {
      // Revoke Blob URL falls Modell
      if (assetBlobUrls.has(name)) {
        URL.revokeObjectURL(assetBlobUrls.get(name));
        assetBlobUrls.delete(name);
      }

      assetFiles.delete(name);
      rebuildAssetList();

      // Audio-Dropdown Option entfernen + Audio-State synchronisieren
      if (AUDIO_EXT.includes(getFileExtension(name))) {
        const sel = document.getElementById('sel-audio-file');
        [...sel.options].forEach(o => { if (o.value === name) o.remove(); });
        if (sel.value === name) { sel.value=''; sel.dispatchEvent(new Event('input')); }
        syncAudio(); // WICHTIG: Audio-Konfiguration neu anwenden
      }
    };
    actions.appendChild(btnRemove);

    li.appendChild(title); li.appendChild(badge); li.appendChild(sizeEl); li.appendChild(actions); ul.appendChild(li);
  }
}

function sanitizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.href;
    }
  } catch(_) {
    // ungültig
  }
  return ''; // verwerfen, wenn nicht http/https
}

function handleFiles(files){
  for (const file of files){
    const ext = getFileExtension(file.name);
    if (['glb','gltf','usdz','jpg','jpeg','png','webp','bin',...AUDIO_EXT,...VIDEO_EXT].includes(ext)){
      const assetName = file.name;
      if (assetFiles.has(assetName)) {
        const overwrite = confirm(`Datei "${assetName}" existiert schon. Überschreiben?`);
        if (!overwrite) continue;

        // Alte Blob URL bei Modell entfernen
        if (assetBlobUrls.has(assetName)) {
          URL.revokeObjectURL(assetBlobUrls.get(assetName));
          assetBlobUrls.delete(assetName);
        }
      }
      assetFiles.set(assetName, file);

      if (ext === 'glb' || ext === 'gltf'){
        const blobUrl = URL.createObjectURL(file);
        assetBlobUrls.set(assetName, blobUrl);
        sceneManager.loadModel(blobUrl, assetName);
      }
      if (AUDIO_EXT.includes(ext)){
        const sel = document.getElementById('sel-audio-file');
        if (sel){
          // Option nur hinzufügen wenn nicht bereits vorhanden
            if (![...sel.options].some(o => o.value === assetName)) {
              const opt = document.createElement('option');
              opt.value = assetName; opt.textContent = assetName;
              sel.appendChild(opt);
            }
        }
      }
    }
  }
  rebuildAssetList();
}

function init(){
  const canvas = document.getElementById('main-canvas');
  sceneManager = new SceneManager(canvas);

  const objectList = document.getElementById('object-list');
  const propContent = document.getElementById('prop-content');
  const propEmpty = document.getElementById('prop-empty');

  const inpName = document.getElementById('inp-name');
  const inpPos = { x: document.getElementById('inp-px'), y: document.getElementById('inp-py'), z: document.getElementById('inp-pz') };
  const inpRot = { x: document.getElementById('inp-rx'), y: document.getElementById('inp-ry'), z: document.getElementById('inp-rz') };
  const inpScale = document.getElementById('inp-s');
  const inpLinkUrl = document.getElementById('inp-link-url');

  const btnPublish = document.getElementById('btnPublish');
  const publishStatus = document.getElementById('publish-status');

  const selAudioFile = document.getElementById('sel-audio-file');
  const chkAudioLoop = document.getElementById('chk-audio-loop');
  const inpAudioDelay = document.getElementById('inp-audio-delay');
  const inpAudioVol = document.getElementById('inp-audio-vol');

  const audioState = { url:'', loop:false, delaySeconds:0, volume:0.8 };
  function syncAudio(){
    audioState.url = selAudioFile.value || '';
    audioState.loop = !!chkAudioLoop.checked;
    audioState.delaySeconds = parseFloat(inpAudioDelay.value) || 0;
    const v = parseFloat(inpAudioVol.value);
    audioState.volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
    sceneManager.setAudioConfig(audioState);
  }
  [selAudioFile, chkAudioLoop, inpAudioDelay, inpAudioVol].forEach(el => el && el.addEventListener('input', syncAudio));
  syncAudio();

  // Objektliste separat aktualisieren (kein doppeltes Aufrufen in updatePropsUI)
  function refreshObjectList(){
    objectList.innerHTML = '';
    if (sceneManager.editableObjects.length === 0){
      objectList.innerHTML = '<li class="empty-state">Keine Objekte</li>';
      return;
    }
    sceneManager.editableObjects.forEach(obj => {
      const li = document.createElement('li');
      li.textContent = obj.name || 'Unbenanntes Objekt';
      if (sceneManager.selectedObject === obj) li.classList.add('selected');
      li.onclick = () => sceneManager.selectObject(obj);
      objectList.appendChild(li);
    });
  }

  sceneManager.onSceneUpdate = () => {
    refreshObjectList();
  };

  const updatePropsUI = () => {
    const obj = sceneManager.selectedObject;
    if (obj){
      propContent.classList.remove('hidden');
      propEmpty.classList.add('hidden');
      inpName.value = obj.name;
      inpPos.x.value = obj.position.x.toFixed(2);
      inpPos.y.value = obj.position.y.toFixed(2);
      inpPos.z.value = obj.position.z.toFixed(2);
      inpRot.x.value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
      inpRot.y.value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
      inpRot.z.value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);
      inpScale.value = obj.scale.x.toFixed(2);
      inpLinkUrl.value = obj.userData.linkUrl || '';
    } else {
      propContent.classList.add('hidden');
      propEmpty.classList.remove('hidden');
      inpLinkUrl.value = '';
    }
  };

  sceneManager.onSelectionChange = updatePropsUI;
  sceneManager.onTransformChange = updatePropsUI;

  function applyTransform(){
    const p = { x: parseFloat(inpPos.x.value), y: parseFloat(inpPos.y.value), z: parseFloat(inpPos.z.value) };
    const r = { x: parseFloat(inpRot.x.value), y: parseFloat(inpRot.y.value), z: parseFloat(inpRot.z.value) };
    const s = parseFloat(inpScale.value);
    sceneManager.updateSelectedTransform(p,r,s);
    if (sceneManager.selectedObject) sceneManager.selectedObject.name = inpName.value;
    // Nur Objektliste auffrischen (Properties bleiben aktuell)
    refreshObjectList();
  }
  [inpName, inpScale, ...Object.values(inpPos), ...Object.values(inpRot)].forEach(el => el.addEventListener('input', applyTransform));

  inpLinkUrl.addEventListener('input', () => {
    if (sceneManager.selectedObject){
      const sanitized = sanitizeUrl(inpLinkUrl.value);
      sceneManager.selectedObject.userData.linkUrl = sanitized;
      if (sanitized !== inpLinkUrl.value) {
        // Falls Nutzer etwas Unsicheres eingibt → UI korrigieren
        inpLinkUrl.value = sanitized;
      }
    }
  });

  // Drag/drop overlay
  const dropOverlay = document.getElementById('drop-overlay');
  document.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('drag-active'); });
  document.addEventListener('dragleave', e => {
    if (e.clientX === 0 || e.clientY === 0 || e.clientX === window.innerWidth || e.clientY === window.innerHeight){
      dropOverlay.classList.remove('drag-active');
    }
  });
  dropOverlay.addEventListener('drop', e => {
    e.preventDefault(); dropOverlay.classList.remove('drag-active');
    if (e.dataTransfer.items){
      const fs=[]; for (const item of e.dataTransfer.items){ if (item.kind==='file') fs.push(item.getAsFile()); }
      handleFiles(fs);
    } else { handleFiles(e.dataTransfer.files); }
  });

  // Assets dropzone
  const btnAddAssets = document.getElementById('btnAddAssets');
  const assetInput = document.getElementById('asset-upload-input');
  const assetDropzone = document.getElementById('asset-dropzone');
  btnAddAssets.addEventListener('click', () => assetInput.click());
  assetInput.addEventListener('change', e => {
    handleFiles(e.target.files); e.target.value = '';
  });
  assetDropzone.addEventListener('dragover', e => { e.preventDefault(); assetDropzone.classList.add('drag-active'); });
  assetDropzone.addEventListener('dragleave', e => { if (e.relatedTarget === null) assetDropzone.classList.remove('drag-active'); });
  assetDropzone.addEventListener('drop', e => {
    e.preventDefault(); assetDropzone.classList.remove('drag-active');
    if (e.dataTransfer.items){
      const fs=[]; for (const item of e.dataTransfer.items){ if (item.kind === 'file') fs.push(item.getAsFile()); }
      handleFiles(fs);
    } else { handleFiles(e.dataTransfer.files); }
  });

  rebuildAssetList();

  // Publish (Merge)
  btnPublish.addEventListener('click', async () => {
    if (assetFiles.size === 0){
      publishStatus.textContent = 'Fehler: Szene leer.';
      return;
    }
    publishStatus.textContent = '⏳ Mergen & Publizieren…';
    btnPublish.disabled = true;
    const sceneId = `scene-${Date.now().toString(36)}`;
    try {
      const publishClient = new PublishClient(
        CONFIG.WORKER_ORIGIN + CONFIG.PUBLISH_ENDPOINT,
        CONFIG.VIEWER_BASE,
        CONFIG.WORKER_ORIGIN
      );
      const sceneConfig = sceneManager.getSceneConfig();
      const originalAssets = Array.from(assetFiles.values());

      let mergedBlob = null;
      try {
        mergedBlob = await sceneManager.exportMergedGlbBlob();
      } catch (errMerge) {
        console.warn('Merge fehlgeschlagen, Fallback erstes GLB', errMerge);
        const firstGlb = originalAssets.find(f => f.name.toLowerCase().endsWith('.glb'));
        if (!firstGlb) throw new Error('Kein GLB für Fallback.');
        mergedBlob = firstGlb;
      }

      if (!sceneConfig.model) {
        sceneConfig.model = { url: 'scene.glb' };
      } else {
        sceneConfig.model.url = 'scene.glb';
      }

      const uploadAssets = [];
      // GLB Datei
      const mergedFile = new File([mergedBlob], 'scene.glb', { type: 'application/octet-stream' });
      uploadAssets.push(mergedFile);

      // Audio-Datei hinzufügen falls konfiguriert
      if (audioState.url && assetFiles.has(audioState.url)) {
        uploadAssets.push(assetFiles.get(audioState.url));
      }

      const result = await publishClient.publish(sceneId, sceneConfig, uploadAssets);
      publishStatus.innerHTML = `✅ <a href="${result.viewerUrl}" target="_blank" rel="noopener">Viewer öffnen</a>`;
      console.log('Publish Erfolg:', result);
    } catch (err){
      console.error('Publish Error:', err);
      publishStatus.textContent = '❌ Fehler: ' + err.message;
    } finally {
      btnPublish.disabled = false;
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
