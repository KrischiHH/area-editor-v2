// /js/app.js (AKTUALISIERT)

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
// [NEU] Zentrale Liste der zum Upload vorgesehenen Asset-Dateien
const assetFiles = new Map(); // Speichert { fileName: FileObject }

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

/**
 * Verarbeitet eine Liste von File-Objekten aus Drag/Drop oder Input.
 */
function handleFiles(files) {
    for (const file of files) {
        const ext = getFileExtension(file.name);
        
        // Erlaubte Endungen basierend auf Worker-Konfig
        if (['glb', 'gltf', 'usdz', 'jpg', 'jpeg', 'png', 'webp', 'bin'].includes(ext)) {
            
            // Dateiname für den Worker normalisieren (alle Kleinbuchstaben)
            const assetName = file.name.toLowerCase();
            
            // Speichern
            assetFiles.set(assetName, file);
            console.log(`Asset hinzugefügt: ${assetName}`);

            // Wenn es ein 3D-Modell ist, lade es in die Szene
            if (ext === 'glb' || ext === 'gltf') {
                // Erstelle eine lokale Blob-URL, um die Datei direkt in three.js zu laden
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

    // 2. Drag & Drop Listener
    const dropOverlay = document.getElementById('drop-overlay');
    
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('drag-active');
    });

    document.addEventListener('dragleave', (e) => {
        // Nur entfernen, wenn der Cursor das gesamte Dokument verlässt, 
        // um Flackern zu vermeiden.
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
                // Wir interessieren uns nur für Dateien
                if (item.kind === 'file') {
                    files.push(item.getAsFile());
                }
            }
            handleFiles(files);
        } else {
            handleFiles(e.dataTransfer.files);
        }
    });


    // 3. Publish Client Setup
    const btnPublish = document.getElementById('btnPublish');
    const publishStatus = document.getElementById('publish-status');
    
    // Den Dummy-Würfel entfernen, da wir jetzt Modelle hochladen
    sceneManager.removeInitialObject();

    btnPublish.addEventListener('click', async () => {
        const sceneId = document.getElementById('sceneIdInput').value.trim();
        const publishKey = document.getElementById('publishKeyInput').value.trim();

        if (!publishKey) {
            publishStatus.textContent = 'Fehler: X-AREA-Key fehlt.';
            return;
        }

        // Stelle sicher, dass Assets vorhanden sind
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

            // 1. Szene-Konfiguration aus dem SceneManager holen
            const sceneConfig = sceneManager.getSceneConfig();
            
            // 2. Assets-Array für den Upload erstellen
            const assets = Array.from(assetFiles.values());

            const result = await publishClient.publish(sceneId, sceneConfig, assets);

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
