// /js/app.js

import { SceneManager } from './SceneManager.js';
import { PublishClient } from './PublishClient.js';

// --- Konfiguration (MUSS angepassst werden) ---
const CONFIG = {
    // Deinen Worker-Origin hier eintragen (z.B. https://api.krischhh.dev)
    WORKER_ORIGIN: 'YOUR_CLOUDFLARE_WORKER_URL_HERE', 
    VIEWER_BASE: 'https://area-viewer.pages.dev/surface-ar/area-viewer.html',
    PUBLISH_ENDPOINT: '/publish' // Endpunkt im Worker
};

let sceneManager;

function init() {
    const canvas = document.getElementById('main-canvas');
    if (!canvas) {
        console.error('Canvas element not found.');
        return;
    }

    // 1. Scene Manager starten (3D-Umgebung)
    sceneManager = new SceneManager(canvas);

    // 2. Publish Client Setup
    const publishForm = document.getElementById('publish-form');
    const btnPublish = document.getElementById('btnPublish');
    const publishStatus = document.getElementById('publish-status');

    btnPublish.addEventListener('click', async () => {
        const sceneId = document.getElementById('sceneIdInput').value.trim();
        const publishKey = document.getElementById('publishKeyInput').value.trim();

        if (!publishKey) {
            publishStatus.textContent = 'Fehler: X-AREA-Key fehlt.';
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

            // --- V2 Publish Logik: Nur scene.json mit Asset-Referenzen ---
            const sceneConfig = sceneManager.getSceneConfig();
            
            // TODO: In V2 müssten die hochgeladenen Assets hier als File-Objekte 
            // gesammelt werden (z.B. aus einem Drop-Bereich).
            // Vorerst senden wir nur die scene.json und KEINE Assets.
            const assets = []; 

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
