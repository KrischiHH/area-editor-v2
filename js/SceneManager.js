// /js/SceneManager.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Verwaltet die gesamte Three.js Szene, Objekte und Interaktion.
 */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.transformControls = null;
    this.loader = new GLTFLoader();

    // Zentrale Speicherung aller bearbeitbaren Objekte
    this.editableObjects = []; 

    this.init();
    this.animate();
  }

  init() {
    const { width, height } = this.canvas.getBoundingClientRect();

    // 1. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true; // Für zukünftige Schatten
    
    // 2. Szene & Hintergrund
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23); // Dunkler Hintergrund (passt zum Dark Mode)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); // Weiches Umgebungslicht

    // 3. Kamera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(2, 2, 3);

    // 4. OrbitControls (Kamera bewegen)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    
    // 5. TransformControls (Gizmos)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transformControls);
    
    // 6. GridHelper für bessere Orientierung
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
    this.scene.add(grid);

    // Event Listener
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Deaktiviere OrbitControls, wenn Gizmo aktiv
    this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
    });

    // Event für Modus-Wechsel (Translate/Rotate/Scale)
    window.addEventListener('keydown', (event) => {
      switch (event.key.toLowerCase()) {
        case 'w': // Translate
          this.transformControls.setMode('translate');
          break;
        case 'e': // Rotate
          this.transformControls.setMode('rotate');
          break;
        case 'r': // Scale
          this.transformControls.setMode('scale');
          break;
      }
    });

    // Dummy: Ein Würfel zum Testen
    const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 0.25, 0);
    this.scene.add(box);
    this.editableObjects.push(box);
    this.transformControls.attach(box); // Gizmo am Würfel befestigen
  }

  onWindowResize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    this.controls.update(); 
    this.renderer.render(this.scene, this.camera);
  }

  // --- Kernfunktionen für den Editor ---

  /**
   * Lädt ein GLB-Modell und fügt es der Szene hinzu.
   * @param {string} url Pfad zum GLB/GLTF.
   * @param {object} initialTransform Optional: {position, rotation, scale}
   */
  loadModel(url, initialTransform = {}) {
    console.log(`Loading model: ${url}`);
    this.loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        // Optional: Skalierung, Rotation, Position anwenden
        if (initialTransform.position) model.position.copy(initialTransform.position);
        // ... weitere Transformationen anwenden ...

        this.scene.add(model);
        this.editableObjects.push(model);
        
        // Wähle das neu geladene Modell aus
        this.selectObject(model); 
      },
      undefined,
      (error) => {
        console.error('Error loading GLTF model:', error);
      }
    );
  }
  
  /**
   * Wählt ein Objekt aus und hängt die TransformControls daran.
   * @param {THREE.Object3D} object 
   */
  selectObject(object) {
      if (this.editableObjects.includes(object)) {
          this.transformControls.attach(object);
      } else {
          this.transformControls.detach();
      }
  }

  /**
   * Sammelt die aktuelle Konfiguration der Szene, um sie zu publizieren.
   * @returns {object} Das Datenobjekt für scene.json
   */
  getSceneConfig() {
    // Später hier die Daten aller Objekte in ein sauberes JSON-Format bringen
    return {
      meta: {
        title: "Neue AArea Scene V2",
        createdAt: new Date().toISOString()
      },
      objects: this.editableObjects
        .filter(obj => obj.userData.isEditable) // Später filtern wir nur die Assets
        .map(obj => ({
          uuid: obj.uuid,
          name: obj.name || 'Untitled Object',
          type: 'model', // Modell, Licht, etc.
          url: obj.userData.assetUrl, // Die Original-Asset-URL/Name
          position: obj.position.toArray(),
          rotation: obj.rotation.toVector3().toArray(), // Wichtig: Euler zu Array
          scale: obj.scale.toArray(),
        }))
    };
  }
}
