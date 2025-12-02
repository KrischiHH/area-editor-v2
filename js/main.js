import { SceneManager } from './SceneManager.js';

function init() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) {
    console.error('Canvas #main-canvas nicht gefunden');
    return;
  }
  const mgr = new SceneManager(canvas);
  window.sceneManager = mgr;

  // Standardmäßig etwas heller und leicht bläulich (Key kräftig)
  mgr.setExposure(2.2);
  mgr.setLightIntensities({ key: 2.5, ambient: 0.6, fill: 1.2 });
}

window.addEventListener('DOMContentLoaded', init);
