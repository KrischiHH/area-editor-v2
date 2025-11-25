// /js/app.js (AKTUALISIERT für Key-Automation)

import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';

// --- Konfiguration ---
const CONFIG = {
    // !!! WICHTIG: DIESEN PLATZHALTER ERSETZEN !!!
    WORKER_ORIGIN: 'YOUR_CLOUDFLARE_WORKER_URL_HERE', 
    VIEWER_BASE: 'https://area-viewer.pages.dev/surface-ar/area-viewer.html',
    PUBLISH_ENDPOINT: '/publish' 
};

let sceneManager;
const assetFiles = new Map(); 

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

/**
 * Verarbeitet eine Liste von File-Objekten aus Drag/Drop oder Input.
 */
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
    if (!canvas) {
        console.error('Canvas element not found.');
        return;
    }

    // 1. Scene Manager starten (3D-Umgebung)
    sceneManager = new SceneManager(canvas);

    // 2. Drag & Drop Listener (Logik bleibt gleich)
    const dropOverlay = document.getElementById('drop-overlay');
    
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('drag-active');
    });

    document.addEventListener('dragleave', (e) => {
        if (e.clientX === 0 || e.clientY === 0 || e.clientX === window.innerWidth || e.clientY === window.innerHeight) {
            dropOverlay.classList.remove('drag-active');
        }
    });

    dropOverlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('drag-active');

        if (e.dataTransfer.items) {
            const files = [];
            for (const item of e.dataTransfer.items) {
                if (item.kind === 'file') {
                    files.push(item.getAsFile());
                }
            }
            handleFiles(files);
        } else {
            handleFiles(e.dataTransfer.files);
        }
    });


    // 3. Publish Client Setup & KEY AUTOMATION
    const publishKeyInput = document.getElementById('publishKeyInput');
    const btnPublish = document.getElementById('btnPublish');
    const publishStatus = document.getElementById('publish-status');
    
    sceneManager.removeInitialObject();

    // 🔑 NEU: Versuche, den Key aus Local Storage zu laden
    try {
        const storedKey = localStorage.getItem('areaPublishKey');
        if (storedKey) {
            publishKeyInput.value = storedKey;
            console.log("Publish Key aus Local Storage geladen.");
        }
    } catch (e) {
        console.warn("Konnte nicht auf Local Storage zugreifen.", e);
    }


    btnPublish.addEventListener('click', async () => {
        const sceneId = document.getElementById('sceneIdInput').value.trim();
        const publishKey = publishKeyInput.value.trim(); // Key wird hier aus dem Feld geholt

        if (!publishKey) {
            publishStatus.textContent = 'Fehler: X-AREA-Key fehlt.';
            return;
        }

        if (assetFiles.size === 0) {
             publishStatus.textContent = 'Fehler: Bitte GLB-Modelle oder Assets per Drag & Drop hinzufügen.';
             return;
        }

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

            // 🔑 NEU: Key bei Erfolg in Local Storage speichern
            try {
                localStorage.setItem('areaPublishKey', publishKey);
                console.log("Publish Key erfolgreich in Local Storage gespeichert.");
            } catch (e) {
                console.warn("Konnte Key nicht in Local Storage speichern.", e);
            }


            publishStatus.innerHTML = `✅ Erfolg! <br> Scene-ID: <b>${result.sceneId}</b><br>
                <a href="${result.viewerUrl}" target="_blank">Viewer öffnen</a>`;

        } catch (error) {
            console.error('Publish Error:', error);
            publishStatus.textContent = '❌ Fehler beim Publizieren: ' + error.message;
        } finally {
            btnPublish.disabled = false;
        }
    });
}

window.addEventListener('DOMContentLoaded', init);
