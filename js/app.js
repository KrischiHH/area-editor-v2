// /js/app.js

import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';
import * as THREE from 'three'; // Für MathUtils

// --- Konfiguration ---
const CONFIG = {
    WORKER_ORIGIN: 'https://area-publish-proxy.area-webar.workers.dev', // Proxy verwenden!
    VIEWER_BASE: 'https://area-viewer.pages.dev/surface-ar/area-viewer.html',
    PUBLISH_ENDPOINT: '/publish' 
};

let sceneManager;
const assetFiles = new Map(); 

// ... (handleFiles, getFileExtension bleiben gleich) ...
function getFileExtension(filename) { return filename.split('.').pop().toLowerCase(); }
function handleFiles(files) {
    for (const file of files) {
        const ext = getFileExtension(file.name);
        if (['glb', 'gltf', 'usdz', 'jpg', 'jpeg', 'png', 'webp', 'bin'].includes(ext)) {
            const assetName = file.name.toLowerCase();
            assetFiles.set(assetName, file);
            console.log(`Asset hinzugefügt: ${assetName}`);
            if (ext === 'glb' || ext === 'gltf') {
                const blobUrl = URL.createObjectURL(file);
                sceneManager.loadModel(blobUrl, assetName);
            }
        }
    }
}

function init() {
    const canvas = document.getElementById('main-canvas');
    sceneManager = new SceneManager(canvas);

    // --- UI REFERENCES ---
    const listContainer = document.getElementById('hierarchy-panel');
    const propContent = document.getElementById('prop-content');
    const propEmpty = document.getElementById('prop-empty');
    
    const inpName = document.getElementById('inp-name');
    const inpPos = { x: document.getElementById('inp-px'), y: document.getElementById('inp-py'), z: document.getElementById('inp-pz') };
    const inpRot = { x: document.getElementById('inp-rx'), y: document.getElementById('inp-ry'), z: document.getElementById('inp-rz') };
    const inpScale = document.getElementById('inp-s');

    // --- UI LOGIC ---
    
    // 1. Szene-Liste aktualisieren
    sceneManager.onSceneUpdate = () => {
        // Leere die Liste (außer Header)
        const header = listContainer.querySelector('h2');
        listContainer.innerHTML = '';
        listContainer.appendChild(header);
        
        sceneManager.editableObjects.forEach(obj => {
            const item = document.createElement('div');
            item.textContent = obj.name || 'Objekt';
            item.style.padding = '8px';
            item.style.cursor = 'pointer';
            item.style.borderBottom = '1px solid #333';
            
            // Highlighting für ausgewähltes Objekt
            if (sceneManager.selectedObject === obj) {
                item.style.background = '#2a4a80';
                item.style.fontWeight = 'bold';
            }
            
            item.onclick = () => sceneManager.selectObject(obj);
            listContainer.appendChild(item);
        });
    };

    // 2. Eigenschaften anzeigen
    const updatePropsUI = () => {
        const obj = sceneManager.selectedObject;
        if (obj) {
            propContent.style.display = 'block';
            propEmpty.style.display = 'none';
            
            inpName.value = obj.name;
            
            inpPos.x.value = obj.position.x.toFixed(2);
            inpPos.y.value = obj.position.y.toFixed(2);
            inpPos.z.value = obj.position.z.toFixed(2);
            
            // Rotation in Grad umrechnen
            inpRot.x.value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
            inpRot.y.value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
            inpRot.z.value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);
            
            inpScale.value = obj.scale.x.toFixed(2);
        } else {
            propContent.style.display = 'none';
            propEmpty.style.display = 'block';
        }
        // Liste auch aktualisieren (für Highlight)
        sceneManager.onSceneUpdate(); 
    };

    sceneManager.onSelectionChange = updatePropsUI;
    sceneManager.onTransformChange = updatePropsUI; // Wenn Gizmo bewegt wird -> Update Inputs

    // 3. Input Changes -> Szene aktualisieren
    const applyTransform = () => {
        const p = { x: parseFloat(inpPos.x.value), y: parseFloat(inpPos.y.value), z: parseFloat(inpPos.z.value) };
        const r = { x: parseFloat(inpRot.x.value), y: parseFloat(inpRot.y.value), z: parseFloat(inpRot.z.value) };
        const s = parseFloat(inpScale.value);
        
        sceneManager.updateSelectedTransform(p, r, s);
        if (sceneManager.selectedObject) sceneManager.selectedObject.name = inpName.value;
        sceneManager.onSceneUpdate(); // Namen in Liste updaten
    };

    [inpName, inpScale, ...Object.values(inpPos), ...Object.values(inpRot)].forEach(el => {
        el.addEventListener('input', applyTransform);
    });


    // ... (Rest: Drag & Drop, Publish Client Setup bleiben gleich) ...
    // 2. Drag & Drop Listener
    const dropOverlay = document.getElementById('drop-overlay');
    document.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('drag-active'); });
    document.addEventListener('dragleave', (e) => {
        if (e.clientX === 0 || e.clientY === 0 || e.clientX === window.innerWidth || e.clientY === window.innerHeight) {
            dropOverlay.classList.remove('drag-active');
        }
    });
    dropOverlay.addEventListener('drop', (e) => {
        e.preventDefault(); dropOverlay.classList.remove('drag-active');
        if (e.dataTransfer.items) {
            const files = [];
            for (const item of e.dataTransfer.items) { if (item.kind === 'file') files.push(item.getAsFile()); }
            handleFiles(files);
        } else { handleFiles(e.dataTransfer.files); }
    });

    // 3. Publish Client Setup
    const publishKeyInput = document.getElementById('publishKeyInput');
    const btnPublish = document.getElementById('btnPublish');
    const publishStatus = document.getElementById('publish-status');
    
    try {
        const storedKey = localStorage.getItem('areaPublishKey');
        if (storedKey) publishKeyInput.value = storedKey;
    } catch (e) {}

    btnPublish.addEventListener('click', async () => {
        const sceneId = document.getElementById('sceneIdInput').value.trim();
        const publishKey = publishKeyInput.value.trim();

        if (!publishKey) { publishStatus.textContent = 'Fehler: X-AREA-Key fehlt.'; return; }
        if (assetFiles.size === 0) { publishStatus.textContent = 'Fehler: Bitte Assets hinzufügen.'; return; }

        publishStatus.textContent = 'Publiziere Szene...';
        btnPublish.disabled = true;

        try {
            const publishClient = new PublishClient(
                CONFIG.WORKER_ORIGIN + CONFIG.PUBLISH_ENDPOINT,
                CONFIG.VIEWER_BASE,
                publishKey,
                CONFIG.WORKER_ORIGIN
            );
            const sceneConfig = sceneManager.getSceneConfig();
            const assets = Array.from(assetFiles.values());
            const result = await publishClient.publish(sceneId, sceneConfig, assets);

            try { localStorage.setItem('areaPublishKey', publishKey); } catch (e) {}

            publishStatus.innerHTML = `✅ Erfolg! <br> Scene-ID: <b>${result.sceneId}</b><br><a href="${result.viewerUrl}" target="_blank">Viewer öffnen</a>`;
        } catch (error) {
            console.error('Publish Error:', error);
            publishStatus.textContent = '❌ Fehler: ' + error.message;
        } finally {
            btnPublish.disabled = false;
        }
    });
}

window.addEventListener('DOMContentLoaded', init);
