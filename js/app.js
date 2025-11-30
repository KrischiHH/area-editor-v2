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
const assetBlobUrls = new Map();
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
  const units = ['B','KB','MB','GB']; let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length-1) { v/=1024; i++; }
  return v.toFixed(v<10?2:1)+' '+units[i];
}

function rebuildAssetList() {
  const ul=document.getElementById('asset-list');
  if(!ul) return;
  ul.innerHTML='';
  if(assetFiles.size===0){
    ul.innerHTML='<li class="empty">Noch keine Assets</li>';
    return;
  }
  for(const [name,file] of assetFiles.entries()){
    const li=document.createElement('li');
    const type=classifyAsset(file);
    const title=document.createElement('div'); title.textContent=name;
    const badge=document.createElement('span'); badge.className='asset-type'; badge.textContent=type;
    const sizeEl=document.createElement('span');
    sizeEl.style.fontSize='10px'; sizeEl.style.color='var(--text-muted)';
    sizeEl.textContent=formatBytes(file.size);
    const actions=document.createElement('div'); actions.className='asset-actions';

    if(type==='audio'){
      const btnAudio=document.createElement('button');
      btnAudio.textContent='▶'; btnAudio.title='Audio-Vorschau'; btnAudio.className='audio-preview-btn';
      let audioObj=null;
      btnAudio.onclick=()=>{
        if(!audioObj){
          audioObj=new Audio(URL.createObjectURL(file));
          audioObj.onended=()=>{ btnAudio.textContent='▶'; btnAudio.classList.remove('playing'); };
        }
        if(audioObj.paused){
          audioObj.play().catch(e=>console.warn('Audio preview failed',e));
          btnAudio.textContent='⏸'; btnAudio.classList.add('playing');
        } else {
          audioObj.pause(); btnAudio.textContent='▶'; btnAudio.classList.remove('playing');
        }
      };
      actions.appendChild(btnAudio);
    }

    const btnRemove=document.createElement('button');
    btnRemove.textContent='✕'; btnRemove.title='Asset entfernen';
    btnRemove.onclick=()=>{
      if(assetBlobUrls.has(name)){
        URL.revokeObjectURL(assetBlobUrls.get(name));
        assetBlobUrls.delete(name);
      }
      assetFiles.delete(name);
      rebuildAssetList();
      if(AUDIO_EXT.includes(getFileExtension(name))){
        const sel=document.getElementById('sel-audio-file');
        if(sel){
          [...sel.options].forEach(o=>{ if(o.value===name) o.remove(); });
          if(sel.value===name){ sel.value=''; sel.dispatchEvent(new Event('input')); }
        }
        syncAudio();
      }
    };
    actions.appendChild(btnRemove);
    li.appendChild(title); li.appendChild(badge); li.appendChild(sizeEl); li.appendChild(actions);
    ul.appendChild(li);
  }
}

function sanitizeUrl(raw){
  const trimmed=(raw||'').trim();
  if(!trimmed) return '';
  try {
    const u=new URL(trimmed, window.location.origin);
    if(u.protocol==='http:'||u.protocol==='https:') return u.href;
  } catch(_) {}
  return '';
}

function handleFiles(files){
  for(const file of files){
    const ext=getFileExtension(file.name);
    if(['glb','gltf','usdz','jpg','jpeg','png','webp','bin',...AUDIO_EXT,...VIDEO_EXT].includes(ext)){
      const assetName=file.name;
      if(assetFiles.has(assetName)){
        const overwrite=confirm(`Datei "${assetName}" existiert schon. Überschreiben?`);
        if(!overwrite) continue;
        if(assetBlobUrls.has(assetName)){
          URL.revokeObjectURL(assetBlobUrls.get(assetName));
          assetBlobUrls.delete(assetName);
        }
      }
      assetFiles.set(assetName,file);
      if(ext==='glb'||ext==='gltf'){
        const blobUrl=URL.createObjectURL(file);
        assetBlobUrls.set(assetName, blobUrl);
        sceneManager.loadModel(blobUrl, assetName);
      }
      if(AUDIO_EXT.includes(ext)){
        const sel=document.getElementById('sel-audio-file');
        if(sel && ![...sel.options].some(o=>o.value===assetName)){
          const opt=document.createElement('option');
          opt.value=assetName; opt.textContent=assetName;
          sel.appendChild(opt);
        }
      }
    }
  }
  rebuildAssetList();
}

/* ---------- Selection Marquee ---------- */
function ensureSelectionOverlay(){
  let el=document.getElementById('selection-marquee');
  if(!el){
    el=document.createElement('div');
    el.id='selection-marquee';
    el.style.position='fixed';
    el.style.border='1px dashed #4da6ff';
    el.style.background='rgba(77,166,255,0.15)';
    el.style.pointerEvents='none';
    el.style.zIndex='9999';
    el.style.display='none';
    document.body.appendChild(el);
  }
  return el;
}
let isMarquee=false;
let marqueeStart={x:0,y:0};
let marqueeCurrent={x:0,y:0};
let marqueeAppend=false;
const MARQUEE_THRESHOLD=8; // px Mindestbewegung damit Box-Select startet
let marqueeCandidate=false; // nur "Kandidat" bis Threshold erreicht ist

function beginMarqueeCandidate(x,y,append){
  marqueeCandidate=true;
  marqueeAppend=append;
  marqueeStart.x=x; marqueeStart.y=y;
  marqueeCurrent.x=x; marqueeCurrent.y=y;
}
function tryStartMarquee(x,y){
  if(!marqueeCandidate) return;
  const dx=Math.abs(x - marqueeStart.x);
  const dy=Math.abs(y - marqueeStart.y);
  if(dx>=MARQUEE_THRESHOLD || dy>=MARQUEE_THRESHOLD){
    isMarquee=true;
    marqueeCandidate=false;
    const box=ensureSelectionOverlay();
    Object.assign(box.style,{left:Math.min(marqueeStart.x,x)+'px',top:Math.min(marqueeStart.y,y)+'px',width:Math.abs(x-marqueeStart.x)+'px',height:Math.abs(y-marqueeStart.y)+'px',display:'block'});
  }
}
function updateMarquee(x,y){
  marqueeCurrent.x=x; marqueeCurrent.y=y;
  const box=ensureSelectionOverlay();
  const minX=Math.min(marqueeStart.x, x);
  const minY=Math.min(marqueeStart.y, y);
  const w=Math.abs(x - marqueeStart.x);
  const h=Math.abs(y - marqueeStart.y);
  Object.assign(box.style,{left:minX+'px',top:minY+'px',width:w+'px',height:h+'px'});
}
function endMarquee(){
  const box=ensureSelectionOverlay();
  box.style.display='none';

  if(!isMarquee){ // Kein echter Marquee gestartet → nichts tun
    marqueeCandidate=false;
    return;
  }

  isMarquee=false;
  marqueeCandidate=false;

  const x1=Math.min(marqueeStart.x, marqueeCurrent.x);
  const y1=Math.min(marqueeStart.y, marqueeCurrent.y);
  const x2=Math.max(marqueeStart.x, marqueeCurrent.x);
  const y2=Math.max(marqueeStart.y, marqueeCurrent.y);

  const newly=[];
  sceneManager.editableObjects.forEach(obj=>{
    const bb=new THREE.Box3().setFromObject(obj);
    if(!isFinite(bb.min.x)||!isFinite(bb.max.x)) return;
    const corners=[
      new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z)
    ];
    let inside=false;
    for(const c of corners){
      const v=c.clone().project(sceneManager.camera);
      const sx=(v.x*0.5+0.5)*window.innerWidth;
      const sy=(-v.y*0.5+0.5)*window.innerHeight;
      if(sx>=x1 && sx<=x2 && sy>=y1 && sy<=y2){ inside=true; break; }
    }
    if(inside){
      newly.push(obj);
      return;
    }
    const center=bb.getCenter(new THREE.Vector3()).project(sceneManager.camera);
    const csx=(center.x*0.5+0.5)*window.innerWidth;
    const csy=(-center.y*0.5+0.5)*window.innerHeight;
    if(csx>=x1 && csx<=x2 && csy>=y1 && csy<=y2){ newly.push(obj); }
  });

  if(!marqueeAppend){
    sceneManager.selectedObjects=newly;
  } else {
    newly.forEach(o=>{
      if(!sceneManager.selectedObjects.includes(o)){
        sceneManager.selectedObjects.push(o);
      }
    });
  }
  sceneManager._updateSelectionVisuals();
}

/* -------------------- Init -------------------- */
function init(){
  const canvas=document.getElementById('main-canvas');
  if(!canvas){ console.error('Canvas #main-canvas nicht gefunden'); return; }
  sceneManager=new SceneManager(canvas);

  // Shortcuts
  window.addEventListener('keydown', e=>{
    if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
    const key=e.key.toLowerCase();
    const isMac=navigator.platform.toLowerCase().includes('mac');
    const ctrl=isMac? e.metaKey : e.ctrlKey;

    if(ctrl && key==='z' && !e.shiftKey){ e.preventDefault(); sceneManager.undo(); return; }
    if((ctrl && key==='y') || (ctrl && key==='z' && e.shiftKey)){ e.preventDefault(); sceneManager.redo(); return; }
    if(ctrl && key==='a'){ e.preventDefault(); sceneManager.selectAll(); return; }

    switch(key){
      case 'f': sceneManager.focusSelected(); break;
      case 'g': sceneManager.snapToGround(); break;
      case 'd': sceneManager.duplicateSelected(); break;
      case 'r': console.log('Gizmo Mode:', sceneManager.cycleGizmoMode()); break;
      case 'o': console.log('Outline:', sceneManager.toggleOutline()); break;
      case 'p': console.log('Pivot Edit Mode:', sceneManager.togglePivotEdit()); break;
      case 'l': console.log('Light Profile:', sceneManager.cycleLightProfile()); break;
      case 'escape': if(!isMarquee && !marqueeCandidate) sceneManager.clearSelection(); break;
      case 'delete':
      case 'backspace': sceneManager.deleteSelected(); break;
    }
  });

  // Box-Selection / Canvas interactions
  // Änderung: Box-Selection NUR mit Shift+Linksklick-Drag auf Canvas-Hintergrund und erst ab Threshold.
  canvas.addEventListener('mousedown', e=>{
    if(e.button===2) return; // Kontextmenü separat
    if(e.button!==0) return; // nur linke Taste
    if(e.target!==canvas) return; // nicht auf UI-Elementen oder Gizmo
    // Box-Selection nur mit Shift (oder Ctrl/Meta als additive Auswahl)
    const append = e.shiftKey || e.ctrlKey || e.metaKey;
    if(append && !e.altKey){
      beginMarqueeCandidate(e.clientX, e.clientY, append);
    } else {
      // Kein Marquee-Kandidat → OrbitControls übernehmen (Standard)
      marqueeCandidate=false;
    }
  });

  window.addEventListener('mousemove', e=>{
    if(marqueeCandidate) tryStartMarquee(e.clientX, e.clientY);
    if(isMarquee) updateMarquee(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', e=>{
    if(isMarquee || marqueeCandidate){
      endMarquee();
    }
  });

  // Kontextmenü
  let contextMenuEl=null;
  function ensureContextMenu(){
    if(!contextMenuEl){
      contextMenuEl=document.createElement('div');
      contextMenuEl.id='viewport-context-menu';
      contextMenuEl.innerHTML=`
        <button data-action="duplicate">Duplizieren</button>
        <button data-action="snap">Snap to Ground</button>
        <button data-action="delete">Löschen</button>
        <hr>
        <button data-action="pivot">${'Pivot Edit'}</button>
        <button data-action="clear">Auswahl leeren</button>
      `;
      document.body.appendChild(contextMenuEl);
      contextMenuEl.addEventListener('click', e=>{
        const act=e.target.getAttribute('data-action');
        if(!act) return;
        switch(act){
          case 'duplicate': sceneManager.duplicateSelected(); break;
          case 'snap': sceneManager.snapToGround(); break;
          case 'delete': sceneManager.deleteSelected(); break;
          case 'pivot': console.log('Pivot Edit Mode:', sceneManager.togglePivotEdit()); break;
          case 'clear': sceneManager.clearSelection(); break;
        }
        hideContextMenu();
      });
    }
    return contextMenuEl;
  }
  function showContextMenu(x,y){
    const el=ensureContextMenu();
    el.style.display='flex';
    el.style.left=x+'px';
    el.style.top=y+'px';
  }
  function hideContextMenu(){
    if(contextMenuEl) contextMenuEl.style.display='none';
  }
  canvas.addEventListener('contextmenu', e=>{
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  window.addEventListener('click', e=>{
    if(contextMenuEl && contextMenuEl.style.display==='flex'){
      if(!contextMenuEl.contains(e.target)) hideContextMenu();
    }
  });

  const objectList=document.getElementById('object-list');
  const propContent=document.getElementById('prop-content');
  const propEmpty=document.getElementById('prop-empty');

  const inpName=document.getElementById('inp-name');
  const inpPos={ x:document.getElementById('inp-px'), y:document.getElementById('inp-py'), z:document.getElementById('inp-pz') };
  const inpRot={ x:document.getElementById('inp-rx'), y:document.getElementById('inp-ry'), z:document.getElementById('inp-rz') };
  const inpScale=document.getElementById('inp-s');
  const inpLinkUrl=document.getElementById('inp-link-url');

  const btnPublish=document.getElementById('btnPublish');
  const publishStatus=document.getElementById('publish-status');

  const selAudioFile=document.getElementById('sel-audio-file');
  const chkAudioLoop=document.getElementById('chk-audio-loop');
  const inpAudioDelay=document.getElementById('inp-audio-delay');
  const inpAudioVol=document.getElementById('inp-audio-vol');

  const audioState={ url:'', loop:false, delaySeconds:0, volume:0.8 };
  function syncAudio(){
    audioState.url=selAudioFile?.value||'';
    audioState.loop=!!chkAudioLoop?.checked;
    audioState.delaySeconds=parseFloat(inpAudioDelay?.value)||0;
    const v=parseFloat(inpAudioVol?.value);
    audioState.volume=Number.isFinite(v)? Math.min(1, Math.max(0, v)) : 0.8;
    sceneManager.setAudioConfig(audioState);
  }
  [selAudioFile,chkAudioLoop,inpAudioDelay,inpAudioVol].forEach(el=>el&&el.addEventListener('input',syncAudio));
  syncAudio();

  function refreshObjectList(){
    if(!objectList) return;
    objectList.innerHTML='';
    if(sceneManager.editableObjects.length===0){
      objectList.innerHTML='<li class="empty-state">Keine Objekte</li>';
      return;
    }
    sceneManager.editableObjects.forEach(obj=>{
      const li=document.createElement('li');
      li.textContent=obj.name||'Unbenanntes Objekt';
      if(sceneManager.selectedObjects.includes(obj)) li.classList.add('selected');
      li.addEventListener('click', e=>{
        sceneManager.selectObject(obj, e.shiftKey || e.ctrlKey || e.metaKey);
        refreshObjectList();
        updatePropsUI();
      });
      objectList.appendChild(li);
    });
  }

  sceneManager.onSceneUpdate=()=>{ refreshObjectList(); };

  const updatePropsUI=()=>{
    const sel=sceneManager.selectedObjects;
    if(!propContent || !propEmpty) return;
    if(sel.length===1){
      propContent.classList.remove('hidden');
      propEmpty.classList.add('hidden');
      const obj=sel[0];
      inpName.value=obj.name||'';
      inpPos.x.value=obj.position.x.toFixed(2);
      inpPos.y.value=obj.position.y.toFixed(2);
      inpPos.z.value=obj.position.z.toFixed(2);
      inpRot.x.value=THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
      inpRot.y.value=THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
      inpRot.z.value=THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);
      inpScale.value=obj.scale.x.toFixed(2);
      inpLinkUrl.value=obj.userData.linkUrl||'';
    } else {
      propContent.classList.add('hidden');
      propEmpty.classList.remove('hidden');
      inpLinkUrl.value='';
    }
  };

  sceneManager.onSelectionChange=updatePropsUI;
  sceneManager.onTransformChange=updatePropsUI;

  function applyTransform(){
    if(sceneManager.selectedObjects.length!==1) return;
    const p={ x:parseFloat(inpPos.x.value), y:parseFloat(inpPos.y.value), z:parseFloat(inpPos.z.value) };
    const r={ x:parseFloat(inpRot.x.value), y:parseFloat(inpRot.y.value), z:parseFloat(inpRot.z.value) };
    const s=parseFloat(inpScale.value);
    sceneManager.updateSelectedTransform(p,r,s);
    if(sceneManager.selectedObjects.length===1){
      sceneManager.selectedObjects[0].name=inpName.value;
      refreshObjectList();
    }
  }
  [inpName,inpScale,...Object.values(inpPos),...Object.values(inpRot)].forEach(el=>el&&el.addEventListener('input',applyTransform));

  inpLinkUrl.addEventListener('input',()=>{
    if(sceneManager.selectedObjects.length===1){
      const obj=sceneManager.selectedObjects[0];
      const sanitized=sanitizeUrl(inpLinkUrl.value);
      obj.userData.linkUrl=sanitized;
      if(sanitized!==inpLinkUrl.value){
        inpLinkUrl.value=sanitized;
      }
    }
  });

  // Drag & Drop global
  const dropOverlay=document.getElementById('drop-overlay');
  document.addEventListener('dragover', e=>{
    e.preventDefault();
    dropOverlay?.classList.add('drag-active');
  });
  document.addEventListener('dragleave', e=>{
    if(e.clientX===0||e.clientY===0||e.clientX===window.innerWidth||e.clientY===window.innerHeight){
      dropOverlay?.classList.remove('drag-active');
    }
  });
  dropOverlay?.addEventListener('drop', e=>{
    e.preventDefault();
    dropOverlay.classList.remove('drag-active');
    if(e.dataTransfer.items){
      const fs=[]; for(const item of e.dataTransfer.items){ if(item.kind==='file') fs.push(item.getAsFile()); }
      handleFiles(fs);
    } else { handleFiles(e.dataTransfer.files); }
  });

  // Asset Dropzone
  const btnAddAssets=document.getElementById('btnAddAssets');
  const assetInput=document.getElementById('asset-upload-input');
  const assetDropzone=document.getElementById('asset-dropzone');
  btnAddAssets?.addEventListener('click',()=>assetInput?.click());
  assetInput?.addEventListener('change', e=>{
    handleFiles(e.target.files); e.target.value='';
  });
  assetDropzone?.addEventListener('dragover', e=>{
    e.preventDefault(); assetDropzone.classList.add('drag-active');
  });
  assetDropzone?.addEventListener('dragleave', e=>{
    if(e.relatedTarget===null) assetDropzone.classList.remove('drag-active');
  });
  assetDropzone?.addEventListener('drop', e=>{
    e.preventDefault(); assetDropzone.classList.remove('drag-active');
    if(e.dataTransfer.items){
      const fs=[]; for(const item of e.dataTransfer.items){ if(item.kind==='file') fs.push(item.getAsFile()); }
      handleFiles(fs);
    } else { handleFiles(e.dataTransfer.files); }
  });

  rebuildAssetList();

  // Publish
  btnPublish?.addEventListener('click', async ()=>{
    if(assetFiles.size===0){
      publishStatus.textContent='Fehler: Szene leer.';
      return;
    }
    publishStatus.textContent='⏳ Mergen & Publizieren…';
    btnPublish.disabled=true;
    const sceneId=`scene-${Date.now().toString(36)}`;
    try {
      const publishClient=new PublishClient(
        CONFIG.WORKER_ORIGIN + CONFIG.PUBLISH_ENDPOINT,
        CONFIG.VIEWER_BASE,
        CONFIG.WORKER_ORIGIN
      );
      const sceneConfig=sceneManager.getSceneConfig();
      const originalAssets=Array.from(assetFiles.values());

      let mergedBlob=null;
      try {
        mergedBlob=await sceneManager.exportMergedGlbBlob();
      } catch(errMerge){
        console.warn('Merge fehlgeschlagen, Fallback erstes GLB', errMerge);
        const firstGlb=originalAssets.find(f=>f.name.toLowerCase().endsWith('.glb'));
        if(!firstGlb) throw new Error('Kein GLB für Fallback.');
        mergedBlob=firstGlb;
      }

      if(!sceneConfig.model){
        sceneConfig.model={ url:'scene.glb' };
      } else {
        sceneConfig.model.url='scene.glb';
      }

      const uploadAssets=[];
      const mergedFile=new File([mergedBlob],'scene.glb',{ type:'application/octet-stream' });
      uploadAssets.push(mergedFile);
      if(audioState.url && assetFiles.has(audioState.url)){
        uploadAssets.push(assetFiles.get(audioState.url));
      }

      const result=await publishClient.publish(sceneId, sceneConfig, uploadAssets);
      publishStatus.innerHTML=`✅ <a href="${result.viewerUrl}" target="_blank" rel="noopener">Viewer öffnen</a>`;
      console.log('Publish Erfolg:', result);
    } catch(err){
      console.error('Publish Error:', err);
      publishStatus.textContent='❌ Fehler: '+err.message;
    } finally {
      btnPublish.disabled=false;
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
