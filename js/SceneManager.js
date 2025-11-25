// /js/SceneManager.js (AKTUALISIERT)

// Diese Imports werden nun durch die Import Map in index.html aufgelöst
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
    this.initialBox = null; // Referenz auf den Dummy-Würfel

    // Zentrale Speicherung aller bearbeitbaren Objekte
    // Wir speichern hier die THREE.Object3D-Instanzen
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
    this.renderer.shadowMap.enabled = true; 
    
    // 2. Szene & Hintergrund
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23); 
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); 
    // Hinzufügen eines gerichteten Lichts für realistischere Schatten/Highlights
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

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
    
    this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
    });

    window.addEventListener('keydown', (event) => {
      switch (event.key.toLowerCase()) {
        case 'w': 
          this.transformControls.setMode('translate');
          break;
        case 'e': 
          this.transformControls.setMode('rotate');
          break;
        case 'r': 
          this.transformControls.setMode('scale');
          break;
        case 'delete':
        case 'backspace':
            this.removeSelectedObject();
            break;
      }
    });

    // Dummy: Ein Würfel zum Testen (wird später entfernt)
    this.initialBox = this._addInitialBox();
  }

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
        // Speichern des originalen Asset-Namens in userData für getSceneConfig()
        model.userData.assetUrl = assetName;
        model.userData.isEditable = true;
        model.name = assetName;
        
        // Versuche, das Modell auf den Boden (y=0) zu setzen
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        model.position.y -= center.y - (size.y / 2); // Setzt den tiefsten Punkt auf Y=0
        
        this.scene.add(model);
        this.editableObjects.push(model);
        
        this.selectObject(model); 
        
        // Entferne die temporäre Blob-URL
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
   * Entfernt das aktuell ausgewählte Objekt aus der Szene und der Liste.
   */
  removeSelectedObject() {
      const selected = this.transformControls.object;
      if (selected) {
          this.transformControls.detach();
          this.scene.remove(selected);
          this.editableObjects = this.editableObjects.filter(obj => obj.uuid !== selected.uuid);
          console.log(`Objekt entfernt: ${selected.name}`);
      }
  }

  /**
   * Sammelt die aktuelle Konfiguration der Szene, um sie zu publizieren.
   * @returns {object} Das Datenobjekt für scene.json
   */
  getSceneConfig() {
    // Wandelt Euler-Rotation in ein Array um
    const rotationToArray = (rotation) => {
        const euler = new THREE.Euler().copy(rotation);
        return [euler.x, euler.y, euler.z];
    };
    
    // Array von Assets für die V2-Szene
    const assets = this.editableObjects
        .filter(obj => obj.userData.isEditable && obj.userData.assetUrl) 
        .map(obj => ({
          uuid: obj.uuid,
          name: obj.name || obj.userData.assetUrl,
          type: 'model',
          url: obj.userData.assetUrl, // Der im Worker gespeicherte Dateiname
          position: obj.position.toArray().map(v => parseFloat(v.toFixed(4))),
          rotation: rotationToArray(obj.rotation).map(v => parseFloat(v.toFixed(4))), 
          scale: obj.scale.toArray().map(v => parseFloat(v.toFixed(4))),
          // Später: color, roughness, metallic, etc.
        }));
        
    // Das neue Szene-Format: Eine Liste von Objekten/Assets
    return {
      meta: {
        title: "ARea Scene V2",
        createdAt: new Date().toISOString()
      },
      assets: assets,
      // Später: Lichter, Umgebungseinstellungen, etc.
    };
  }
}
