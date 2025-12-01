import { SceneManager } from './js/SceneManager.js';

function init() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) {
    console.error('Canvas #main-canvas nicht gefunden');
    return;
  }
  const mgr = new SceneManager(canvas);
  // global verfügbar für js/app.js (Controls-Addon)
  window.sceneManager = mgr;

  // Optional: Startwerte
  // mgr.setExposure(1.6);
  // mgr.setLightIntensities({ key: 1.6 });
}

window.addEventListener('DOMContentLoaded', init);
