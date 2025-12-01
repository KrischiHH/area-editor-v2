import { SceneManager } from './SceneManager.js';

function init() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) {
    console.error('Canvas #main-canvas nicht gefunden');
    return;
  }
  const mgr = new SceneManager(canvas);
  window.sceneManager = mgr;

  // Standardmäßig etwas heller starten
  mgr.setExposure(2.2);
  mgr.setLightIntensities({ key: 2.5 });
}

window.addEventListener('DOMContentLoaded', init);
