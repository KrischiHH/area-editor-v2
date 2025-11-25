// /js/app.js

import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';
import * as THREE from 'three'; 

// --- Konfiguration ---
const CONFIG = {
    // Der Proxy kümmert sich um den Key!
    WORKER_ORIGIN: 'https://area-publish-proxy.area-webar.workers.dev', 
    VIEWER_BASE: 'https://area-viewer.pages.dev/surface-ar/area-viewer.html',
    PUBLISH_ENDPOINT: '/publish' 
};

let sceneManager;
const assetFiles = new Map(); 

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

    // --- UI Referenzen ---
    const objectList = document.getElementById('object-list');
    const propContent = document.getElementById('prop-content');
    const propEmpty = document.getElementById('prop-empty');
    
    const inpName = document.getElementById('inp-name');
    const inpPos = { x: document.getElementById('inp-px'), y: document.getElementById('inp-py'), z: document.getElementById('inp-pz') };
    const inpRot = { x: document.getElementById('inp-rx'), y: document.getElementById('inp-ry'), z: document.getElementById('inp-rz') };
    const inpScale = document.getElementById('inp-s');

    const btnPublish = document.getElementById('btnPublish');
    const publishStatus = document.getElementById('publish-status');

    // --- Logic: UI Updates (Unverändert) ---
    sceneManager.onSceneUpdate = () => {
        objectList.innerHTML = '';
        if (sceneManager.editableObjects.length === 0) {
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
        if (obj) {
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
        } else {
            propContent.classList.add('hidden');
            propEmpty.classList.remove('hidden');
        }
        sceneManager.onSceneUpdate();
    };

    sceneManager.onSelectionChange = updatePropsUI;
    sceneManager.onTransformChange = updatePropsUI;

    const applyTransform = () => {
        const p = { x: parseFloat(inpPos.x.value), y: parseFloat(inpPos.y.value), z: parseFloat(inpPos.z.value) };
        const r = { x: parseFloat(inpRot.x.value), y: parseFloat(inpRot.y.value), z: parseFloat(inpRot.z.value) };
        const s = parseFloat(inpScale.value);
        sceneManager.updateSelectedTransform(p, r, s);
        if (sceneManager.selectedObject) sceneManager.selectedObject.name = inpName.value;
        sceneManager.onSceneUpdate();
    };

    [inpName, inpScale, ...Object.values(inpPos), ...Object.values(inpRot)].forEach(el => {
        el.addEventListener('input', applyTransform);
    });

    // --- Drag & Drop (Unverändert) ---
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

    // --- PUBLISH LOGIC (Vollautomatisch / Invisible Key) ---
    btnPublish.addEventListener('click', async () => {
        if (assetFiles.size === 0) {
            publishStatus.textContent = 'Fehler: Szene leer.';
            return;
        }

        publishStatus.textContent = '⏳ Publiziere...';
        btnPublish.disabled = true;

        // Automatische Scene-ID
        const timestamp = Date.now().toString(36);
        const sceneId = `scene-${timestamp}`;

        try {
            // Instanz OHNE Key erstellen
            const publishClient = new PublishClient(
                CONFIG.WORKER_ORIGIN + CONFIG.PUBLISH_ENDPOINT,
                CONFIG.VIEWER_BASE,
                CONFIG.WORKER_ORIGIN
            );

            const sceneConfig = sceneManager.getSceneConfig();
            const assets = Array.from(assetFiles.values());
            
            const result = await publishClient.publish(sceneId, sceneConfig, assets);

            publishStatus.innerHTML = `✅ <a href="${result.viewerUrl}" target="_blank">Viewer öffnen</a>`;
            console.log("Publish Erfolg:", result);
        } catch (error) {
            console.error('Publish Error:', error);
            publishStatus.textContent = '❌ Fehler: ' + error.message;
        } finally {
            btnPublish.disabled = false;
        }
    });
}

window.addEventListener('DOMContentLoaded', init);
