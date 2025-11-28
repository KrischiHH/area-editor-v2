import { SceneManager } from './SceneManager.js';
import * as THREE from 'three';

// Falls du einen PublishClient nutzt, bleibt das unverändert.
// import { PublishClient } from './PublishClient.js';

let sceneManager;
const assetFiles = new Map();
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
  let i = 0;
  let v = bytes;
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

    const title = document.createElement('div');
    title.textContent = name;

    const badge = document.createElement('span');
    badge.className = 'asset-type';
    badge.textContent = type;

    const sizeEl = document.createElement('span');
    sizeEl.style.fontSize = '10px';
    sizeEl.style.color = 'var(--text-muted)';
    sizeEl.textContent = formatBytes(file.size);

    const actions = document.createElement('div');
    actions.className = 'asset-actions';

    if (type === 'audio') {
      const btnAudio = document.createElement('button');
      btnAudio.textContent = '▶';
      btnAudio.title = 'Audio-Vorschau';
      btnAudio.className = 'audio-preview-btn';
      let audioObj = null;
      btnAudio.onclick = () => {
        if (!audioObj) {
          audioObj = new Audio(URL.createObjectURL(file));
          audioObj.onended = () => {
            btnAudio.textContent = '▶';
            btnAudio.classList.remove('playing');
          };
        }
        if (audioObj.paused) {
          audioObj.play().catch(e => console.warn('Audio preview failed', e));
          btnAudio.textContent = '⏸';
          btnAudio.classList.add('playing');
        } else {
          audioObj.pause();
          btnAudio.textContent = '▶';
          btnAudio.classList.remove('playing');
        }
      };
      actions.appendChild(btnAudio);
    }

    const btnRemove = document.createElement('button');
    btnRemove.textContent = '✕';
    btnRemove.title = 'Asset entfernen';
    btnRemove.onclick = () => {
      assetFiles.delete(name);
      rebuildAssetList();
      if (AUDIO_EXT.includes(getFileExtension(name))) {
        const sel = document.getElementById('sel-audio-file');
        [...sel.options].forEach(o => { if (o.value === name) o.remove(); });
        if (sel.value === name) {
          sel.value = '';
          sel.dispatchEvent(new Event('input'));
        }
      }
    };
    actions.appendChild(btnRemove);

    li.appendChild(title);
    li.appendChild(badge);
    li.appendChild(sizeEl);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

function handleFiles(files){
  for (const file of files){
    const ext = getFileExtension(file.name);
    if (['glb','gltf','usdz','jpg','jpeg','png','webp','bin',...AUDIO_EXT,...VIDEO_EXT].includes(ext)){
      const assetName = file.name;
      if (assetFiles.has(assetName)) {
        const overwrite = confirm(`Datei "${assetName}" existiert schon. Überschreiben?`);
        if (!overwrite) continue;
      }
      assetFiles.set(assetName, file);
      console.log('Asset hinzugefügt:', assetName);

      if (ext === 'glb' || ext === 'gltf'){
        const blobUrl = URL.createObjectURL(file);
        sceneManager.loadModel(blobUrl, assetName);
      }
      if (AUDIO_EXT.includes(ext)){
        const sel = document.getElementById('sel-audio-file');
        if (sel){
          const opt = document.createElement('option');
          opt.value = assetName;
          opt.textContent = assetName;
          sel.appendChild(opt);
        }
      }
    }
  }
  rebuildAssetList();
}

function init(){
  const canvas = document.getElementById('main-canvas');
  sceneManager = new SceneManager(canvas);

  const objectList   = document.getElementById('object-list');
  const propContent  = document.getElementById('prop-content');
  const propEmpty    = document.getElementById('prop-empty');

  const inpName      = document.getElementById('inp-name');
  const inpPos       = { x: document.getElementById('inp-px'), y: document.getElementById('inp-py'), z: document.getElementById('inp-pz') };
  const inpRot       = { x: document.getElementById('inp-rx'), y: document.getElementById('inp-ry'), z: document.getElementById('inp-rz') };
  const inpScale     = document.getElementById('inp-s');
  const inpLinkUrl   = document.getElementById('inp-link-url');

  const btnPublish   = document.getElementById('btnPublish');
  const publishStatus= document.getElementById('publish-status');

  const selAudioFile = document.getElementById('sel-audio-file');
  const chkAudioLoop = document.getElementById('chk-audio-loop');
  const inpAudioDelay= document.getElementById('inp-audio-delay');
  const inpAudioVol  = document.getElementById('inp-audio-vol');

  const btnSnapFloor    = document.getElementById('btnSnapFloor');
  const btnSnapAllFloor = document.getElementById('btnSnapAllFloor');

  const audioState   = { url:'', loop:false, delaySeconds:0, volume:0.8 };
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

  sceneManager.onSceneUpdate = () => {
    objectList.innerHTML = '';
    if (sceneManager.editableObjects.length === 0){
      objectList.innerHTML = '<li class="empty-state">Keine Objekte</li>';
    } else {
      sceneManager.editableObjects.forEach(obj => {
        const li = document.createElement('li');
        li.textContent = obj.name || 'Unbenanntes Objekt';
        if (sceneManager.selectedObject === obj) li.classList.add('selected');
        li.onclick = () => sceneManager.selectObject(obj);
        objectList.appendChild(li);
      });
    }
    updateSnapButtons();
  };

  const updatePropsUI = () => {
    const obj = sceneManager.selectedObject;
    if (obj){
      propContent.classList.remove('hidden');
      propEmpty.classList.add('hidden');
      inpName.value      = obj.name;
      inpPos.x.value     = obj.position.x.toFixed(2);
      inpPos.y.value     = obj.position.y.toFixed(2);
      inpPos.z.value     = obj.position.z.toFixed(2);
      inpRot.x.value     = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
      inpRot.y.value     = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
      inpRot.z.value     = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);
      inpScale.value     = obj.scale.x.toFixed(2);
      inpLinkUrl.value   = obj.userData.linkUrl || '';
    } else {
      propContent.classList.add('hidden');
      propEmpty.classList.remove('hidden');
      inpLinkUrl.value   = '';
    }
    sceneManager.onSceneUpdate();
  };

  sceneManager.onSelectionChange = () => {
    updatePropsUI();
    updateSnapButtons();
  };
  sceneManager.onTransformChange = updatePropsUI;

  function applyTransform(){
    const p = { x: parseFloat(inpPos.x.value), y: parseFloat(inpPos.y.value), z: parseFloat(inpPos.z.value) };
    const r = { x: parseFloat(inpRot.x.value), y: parseFloat(inpRot.y.value), z: parseFloat(inpRot.z.value) };
    const s = parseFloat(inpScale.value);
    sceneManager.updateSelectedTransform(p,r,s);
    if (sceneManager.selectedObject) sceneManager.selectedObject.name = inpName.value;
    sceneManager.onSceneUpdate();
  }
  [inpName, inpScale, ...Object.values(inpPos), ...Object.values(inpRot)].forEach(el => el.addEventListener('input', applyTransform));

  inpLinkUrl.addEventListener('input', () => {
    if (sceneManager.selectedObject){
      sceneManager.selectedObject.userData.linkUrl = inpLinkUrl.value.trim();
    }
  });

  // Drag&Drop Overlay
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

  // Assets Panel: Button + Dropzone
  const btnAddAssets   = document.getElementById('btnAddAssets');
  const assetInput     = document.getElementById('asset-upload-input');
  const assetDropzone  = document.getElementById('asset-dropzone');

  btnAddAssets.addEventListener('click', () => assetInput.click());
  assetInput.addEventListener('change', e => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  assetDropzone.addEventListener('dragover', e => {
    e.preventDefault(); assetDropzone.classList.add('drag-active');
  });
  assetDropzone.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) assetDropzone.classList.remove('drag-active');
  });
  assetDropzone.addEventListener('drop', e => {
    e.preventDefault(); assetDropzone.classList.remove('drag-active');
    if (e.dataTransfer.items){
      const fs=[];
      for (const item of e.dataTransfer.items){
        if (item.kind === 'file') fs.push(item.getAsFile());
      }
      handleFiles(fs);
    } else { handleFiles(e.dataTransfer.files); }
  });

  rebuildAssetList();

  // Neu: Snap-Buttons verdrahten
  function updateSnapButtons(){
    if (!btnSnapFloor) return;
    btnSnapFloor.disabled = !sceneManager.selectedObject;
  }
  if (btnSnapFloor){
    btnSnapFloor.addEventListener('click', () => {
      if (sceneManager.selectedObject){
        sceneManager.snapObjectToFloor(sceneManager.selectedObject);
        sceneManager.onTransformChange();
        sceneManager.onSceneUpdate();
      }
    });
  }
  if (btnSnapAllFloor){
    btnSnapAllFloor.addEventListener('click', () => {
      sceneManager.snapAllToFloor();
    });
  }

  // Publizieren: Sicherheits-Snap aller Objekte
  btnPublish.addEventListener('click', async () => {
    const publishStatus = document.getElementById('publish-status');
    if (assetFiles.size === 0){
      publishStatus.textContent = 'Fehler: Szene leer.';
      return;
    }

    // Sicherheit: vor Publish
    if (typeof sceneManager.snapAllToFloor === 'function') {
      sceneManager.snapAllToFloor();
    }

    // Falls du PublishClient verwendest, füge hier deinen bestehenden Code ein.
    // publishStatus.textContent = '⏳ Publiziere…';
    // try { ... } catch (e) { ... } finally { ... }
    publishStatus.textContent = 'Bereit zum Publizieren (Demo – bitte bestehenden Publish-Code verwenden).';
  });
}

window.addEventListener('DOMContentLoaded', init);
