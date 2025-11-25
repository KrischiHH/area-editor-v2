import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';
import * as THREE from 'three';

const CONFIG = {
  WORKER_ORIGIN: 'https://area-publish-proxy.area-webar.workers.dev',
  VIEWER_BASE: 'https://krischihh.github.io/area-viewer-v2/viewer.html',
  PUBLISH_ENDPOINT: '/publish'
};

let sceneManager;
const assetFiles = new Map();
const AUDIO_EXT = ['mp3','ogg','m4a'];
const VIDEO_EXT = ['mp4','webm'];

function getFileExtension(filename){ return filename.split('.').pop().toLowerCase(); }

function handleFiles(files){
  for (const file of files){
    const ext = getFileExtension(file.name);
    if (['glb','gltf','usdz','jpg','jpeg','png','webp','bin',...AUDIO_EXT,...VIDEO_EXT].includes(ext)){
      const assetName = file.name; // Original Case behalten
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

  // Audio UI
  const selAudioFile = document.getElementById('sel-audio-file');
  const chkAudioLoop = document.getElementById('chk-audio-loop');
  const inpAudioDelay= document.getElementById('inp-audio-delay');
  const inpAudioVol  = document.getElementById('inp-audio-vol');

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
      return;
    }
    sceneManager.editableObjects.forEach(obj => {
      const li = document.createElement('li');
      li.textContent = obj.name || 'Unbenanntes Objekt';
      if (sceneManager.selectedObject === obj) li.classList.add('selected');
      li.onclick = () => sceneManager.selectObject(obj);
      objectList.appendChild(li);
    });
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

  sceneManager.onSelectionChange = updatePropsUI;
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

  // Drag & Drop
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
      const fs = [];
      for (const item of e.dataTransfer.items){
        if (item.kind === 'file') fs.push(item.getAsFile());
      }
      handleFiles(fs);
    } else {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Publish
  btnPublish.addEventListener('click', async () => {
    if (assetFiles.size === 0){
      publishStatus.textContent = 'Fehler: Szene leer.';
      return;
    }
    publishStatus.textContent = '⏳ Publiziere…';
    btnPublish.disabled = true;
    const sceneId = `scene-${Date.now().toString(36)}`;
    try {
      const publishClient = new PublishClient(
        CONFIG.WORKER_ORIGIN + CONFIG.PUBLISH_ENDPOINT,
        CONFIG.VIEWER_BASE,
        CONFIG.WORKER_ORIGIN
      );
      const sceneConfig = sceneManager.getSceneConfig();
      const assets = Array.from(assetFiles.values());
      const result = await publishClient.publish(sceneId, sceneConfig, assets);
      publishStatus.innerHTML = `✅ <a href="${result.viewerUrl}" target="_blank">Viewer öffnen</a>`;
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
