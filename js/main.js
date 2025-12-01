import { SceneManager } from './SceneManager.js'; // WICHTIG: relativer Pfad ohne "js/"

function init() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) {
    console.error('Canvas #main-canvas nicht gefunden');
    return;
  }
  const mgr = new SceneManager(canvas);
  // global, damit js/app.js (Controls-Addon) darauf zugreifen kann
  window.sceneManager = mgr;

  // Optional Startwerte
  // mgr.setExposure(1.6);
  // mgr.setLightIntensities({ key: 1.6 });
}

window.addEventListener('DOMContentLoaded', init);
