// /js/SceneManager.js (FINAL MIT ANIMATIONSLOGIK)

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

    // [NEU] Animation: Uhr für die Zeitmessung
    this.clock = new THREE.Clock(); 
    // [NEU] Animation: Liste der AnimationMixer für alle animierten Modelle
    this.mixers = []; 

    // Zentrale Speicherung aller bearbeitbaren Objekte
    this.editableObjects = []; 
    this.initialBox = null; 

    this.init();
    this.animate();
  }

  init() {
    const { width, height } = this.canvas.getBoundingClientRect();

    // 1. Renderer Setup (unverändert)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true; 
    
    // 2. Szene & Licht (unverändert)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23); 
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); 
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // 3. Kamera (unverändert)
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(2, 2, 3);

    // 4. OrbitControls & TransformControls & GridHelper (unverändert)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transformControls);
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
    this.scene.add(grid);

    // Event Listener (unverändert)
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
    });
    window.addEventListener('keydown', (event) => {
      switch (event.key.toLowerCase()) {
        case 'w': this.transformControls.setMode('translate'); break;
        case 'e': this.transformControls.setMode('rotate'); break;
        case 'r': this.transformControls.setMode('scale'); break;
        case 'delete': case 'backspace': this.removeSelectedObject(); break;
      }
    });

    // Dummy (wird durch app.js entfernt)
    this.initialBox = this._addInitialBox();
  }

  // ... (removeInitialObject, onWindowResize, _addInitialBox bleiben unverändert) ...
  _addInitialBox() {
    const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 0.25, 0);
    this.scene.add(box);
    this.editableObjects.push(box);
    this.selectObject(box); 
    return box;
  }
  
  removeInitialObject() {
      if (this.initialBox) {
          this.scene.remove(this.initialBox);
          this.editableObjects = this.editableObjects.filter(obj => obj !== this.initialBox);
          this.transformControls.detach();
          this.initialBox = null;
      }
  }

  onWindowResize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    
    // [NEU] Animation: Delta-Zeit holen und alle Mixer aktualisieren
    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m.update(delta)); 
    
    this.controls.update(); 
    this.renderer.render(this.scene, this.camera);
  }

  // --- Kernfunktionen für den Editor ---

  /**
   * Lädt ein GLB-Modell und fügt es der Szene hinzu.
   * @param {string} url Die lokale Blob URL des Modells.
   * @param {string} assetName Der Dateiname des Assets (wichtig für scene.json).
   */
  loadModel(url, assetName) {
    console.log(`Loading model: ${assetName}`);
    this.loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.userData.assetUrl = assetName;
        model.userData.isEditable = true;
        model.name = assetName;
        
        // Berechnung, um Modell auf den Boden zu setzen (unverändert)
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.y -= center.y - (size.y / 2); 
        
        // [NEU] Animationslogik hinzufügen
        if (gltf.animations && gltf.animations.length) {
            const mixer = new THREE.AnimationMixer(model);
            this.mixers.push(mixer); // Mixer zur Liste hinzufügen
            
            // Starte die erste gefundene Animation im GLB
            const clip = gltf.animations[0];
            const action = mixer.clipAction(clip);
            action.play();
            console.log(`Animation gestartet: ${clip.name || 'Clip 0'} (${gltf.animations.length} Clips gefunden)`);
        }
        
        this.scene.add(model);
        this.editableObjects.push(model);
        this.selectObject(model); 
        
        URL.revokeObjectURL(url); 
      },
      undefined,
      (error) => {
        console.error('Error loading GLTF model:', error);
      }
    );
  }
  
  /**
   * Wählt ein Objekt aus und hängt die TransformControls daran.
   */
  selectObject(object) {
      // ... (unverändert) ...
  }
  
  /**
   * Entfernt das aktuell ausgewählte Objekt.
   */
  removeSelectedObject() {
      const selected = this.transformControls.object;
      if (selected) {
          // [NEU] Entferne auch den zugehörigen Mixer, falls vorhanden
          const index = this.mixers.findIndex(m => m.getRoot() === selected);
          if (index !== -1) {
              this.mixers.splice(index, 1);
          }
          
          this.transformControls.detach();
          this.scene.remove(selected);
          this.editableObjects = this.editableObjects.filter(obj => obj.uuid !== selected.uuid);
          console.log(`Objekt entfernt: ${selected.name}`);
      }
  }

  /**
   * Sammelt die aktuelle Konfiguration der Szene für scene.json.
   */
  getSceneConfig() {
    // ... (unverändert) ...
  }
}
