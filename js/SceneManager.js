// Hinweis: Nur relevante Ausschnitte ergänzt. Falls deine Datei weitere Logik enthält, bitte vollständig übernehmen und diese Methode ersetzen/ergänzen.

import * as THREE from 'three';

export class SceneManager {
  constructor(canvas){
    // ... bestehende Initialisierung ...
    this.editableObjects = [];
    this.selectedObject = null;
    this.audioConfig = null;
    this.modelAnimationMap = new Map();
    // exporter etc. vorher definiert
  }

  setAudioConfig(cfg){
    this.audioConfig = cfg;
  }

  // Auswahl/Transform-Methoden etc. ...

  getSceneConfig() {
    // Bestehende Modell-Ermittlung
    const assets = []; // Falls du hier extrahierst, unverändert lassen oder erweitern.
    const clickableNodes = this.editableObjects
      .filter(o => !!o.userData.linkUrl)
      .map(o => ({
        url: o.userData.linkUrl.trim(),
        label: o.name || o.uuid,
        position: {
          x: Number(o.position.x.toFixed(3)),
          y: Number(o.position.y.toFixed(3)),
          z: Number(o.position.z.toFixed(3))
        }
        // Optional später: normal / rotation / scale
      }));

    const audio = (this.audioConfig && this.audioConfig.url)
      ? {
          url: this.audioConfig.url,
          loop: !!this.audioConfig.loop,
          delaySeconds: this.audioConfig.delaySeconds || 0,
          volume: Math.min(1, Math.max(0, this.audioConfig.volume ?? 0.8)),
          // NEU: Signal an den Viewer, ein persistentes <audio> Element zu erzeugen,
          // damit MediaRecorder den Audiotrack zuverlässig mit aufnehmen kann.
          embedElement: true
        }
      : undefined;

    // Modell-Eintrag (abhängig von deiner Logik)
    const modelEntry = {
      // Wird im app.js später überschrieben mit scene.glb
      url: this.currentModelFileName || 'scene.glb'
    };

    return {
      meta: {
        title: 'ARea Scene V2',
        createdAt: new Date().toISOString(),
        animationStrategy: 'merged'
      },
      model: modelEntry,
      audio,
      clickableNodes,
      assets
    };
  }

  exportMergedGlbBlob(){
    return new Promise(async (resolve, reject) => {
      try {
        const exportableAssets = this.editableObjects.filter(o => o.userData.isEditable);
        const tempScene = new THREE.Scene();
        exportableAssets.forEach(asset => {
          const clone = asset.clone();
          tempScene.add(clone);
        });

        const animations = this.buildMergedAnimationClip(exportableAssets);
        this.exporter.parse(
          tempScene,
          (gltf) => {
            resolve(new Blob([gltf], { type: 'application/octet-stream' }));
          },
          (error) => { reject(error); },
          {
            binary: true,
            animations: animations.length > 0 ? animations : undefined,
            embedImages: true,
            onlyVisible: true,
            includeCustomExtensions: false
          }
        );
      } catch(e) {
        reject(e);
      }
    });
  }

  buildMergedAnimationClip(objects){
    const allClips = [];
    objects.forEach(obj => {
      if (this.modelAnimationMap.has(obj)){
        allClips.push(...this.modelAnimationMap.get(obj).clips);
      }
    });
    if (allClips.length === 0) return [];
    const mergedClip = new THREE.AnimationClip(
      'merged_animation',
      -1,
      allClips.flatMap(clip => clip.tracks)
    );
    return [mergedClip];
  }
}
