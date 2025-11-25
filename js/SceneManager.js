// /js/SceneManager.js (Mit Event-Support für UI)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.transformControls = null;
    this.loader = new GLTFLoader();
    
    this.clock = new THREE.Clock(); 
    this.mixers = []; 
    this.editableObjects = []; 
    
    // Aktuell ausgewähltes Objekt
    this.selectedObject = null;

    // Callbacks für die UI (werden von app.js gesetzt)
    this.onSceneUpdate = () => {};     // Wenn Objekte hinzukommen/weggehen
    this.onSelectionChange = () => {}; // Wenn ein anderes Objekt gewählt wird
    this.onTransformChange = () => {}; // Wenn sich Position/Scale ändert (beim Ziehen)

    this.init();
    this.animate();
  }

  init() {
    const { width, height } = this.canvas.getBoundingClientRect();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true; 
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23); 
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); 
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(2, 2, 3);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    // Wichtig: Wenn wir ziehen, feuern wir das Transform-Event für die UI
    this.transformControls.addEventListener('change', () => {
        if (this.transformControls.dragging) this.onTransformChange();
    });
    this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
    });
    this.scene.add(this.transformControls);
    
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
    this.scene.add(grid);

    window.addEventListener('resize', this.onWindowResize.bind(this));
    window.addEventListener('keydown', (event) => {
      // Ignorieren, wenn User gerade im Input-Feld tippt
      if (event.target.tagName === 'INPUT') return;

      switch (event.key.toLowerCase()) {
        case 'w': this.transformControls.setMode('translate'); break;
        case 'e': this.transformControls.setMode('rotate'); break;
        case 'r': this.transformControls.setMode('scale'); break;
        case 'delete': case 'backspace': this.removeSelectedObject(); break;
      }
    });
    
    // Raycaster für Klick-Auswahl im 3D Raum
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    this.canvas.addEventListener('pointerdown', (event) => {
        // Nur auswählen, wenn wir nicht gerade Gizmo ziehen
        if (this.transformControls.dragging) return;

        const rect = this.canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.camera);
        const intersects = raycaster.intersectObjects(this.editableObjects, true);

        if (intersects.length > 0) {
            // Finde das Root-Objekt (das wir in editableObjects gespeichert haben)
            let target = intersects[0].object;
            while (target.parent && !this.editableObjects.includes(target)) {
                target = target.parent;
            }
            if (this.editableObjects.includes(target)) {
                this.selectObject(target);
            }
        } else {
            this.selectObject(null); // Klick ins Leere = Deselect
        }
    });
  }

  loadModel(url, assetName) {
    this.loader.load(url, (gltf) => {
        const model = gltf.scene;
        model.userData.assetUrl = assetName;
        model.userData.isEditable = true;
        model.name = assetName;
        
        // Auto-Center
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.y -= center.y - (size.y / 2); 
        
        // Animation
        if (gltf.animations && gltf.animations.length) {
            const mixerRoot = model.getObjectByName('Armature') || model; 
            const mixer = new THREE.AnimationMixer(mixerRoot);
            this.mixers.push(mixer); 
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
        }
        
        this.scene.add(model);
        this.editableObjects.push(model);
        
        this.onSceneUpdate(); // UI Bescheid geben!
        this.selectObject(model); 
        
        URL.revokeObjectURL(url); 
      }, undefined, (err) => console.error(err));
  }
  
  selectObject(object) {
      this.selectedObject = object;
      if (object && this.editableObjects.includes(object)) {
          this.transformControls.attach(object);
      } else {
          this.transformControls.detach();
      }
      this.onSelectionChange(); // UI Bescheid geben!
  }
  
  removeSelectedObject() {
      const selected = this.transformControls.object;
      if (selected) {
          // Mixer entfernen
          const index = this.mixers.findIndex(m => m.getRoot() === selected);
          if (index !== -1) this.mixers.splice(index, 1);
          
          this.transformControls.detach();
          this.scene.remove(selected);
          this.editableObjects = this.editableObjects.filter(obj => obj.uuid !== selected.uuid);
          this.selectedObject = null;
          
          this.onSceneUpdate(); // UI Bescheid geben!
          this.onSelectionChange();
      }
  }
  
  // Hilfsfunktion um Eigenschaften zu setzen (aus UI)
  updateSelectedTransform(position, rotation, scale) {
      if (!this.selectedObject) return;
      if (position) this.selectedObject.position.set(position.x, position.y, position.z);
      if (rotation) this.selectedObject.rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
      if (scale) this.selectedObject.scale.setScalar(scale);
  }

  onWindowResize() { /* ... wie vorher ... */ 
    const { width, height } = this.canvas.getBoundingClientRect();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() { /* ... wie vorher ... */ 
    requestAnimationFrame(this.animate.bind(this));
    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m.update(delta)); 
    this.controls.update(); 
    this.renderer.render(this.scene, this.camera);
  }

  getSceneConfig() { /* ... wie vorher ... */ 
    const rotationToArray = (rotation) => {
        const euler = new THREE.Euler().copy(rotation);
        return [euler.x, euler.y, euler.z];
    };
    const assets = this.editableObjects
        .filter(obj => obj.userData.isEditable && obj.userData.assetUrl) 
        .map(obj => ({
          uuid: obj.uuid,
          name: obj.name || obj.userData.assetUrl,
          type: 'model',
          url: obj.userData.assetUrl,
          position: obj.position.toArray().map(v => parseFloat(v.toFixed(4))),
          rotation: rotationToArray(obj.rotation).map(v => parseFloat(v.toFixed(4))), 
          scale: obj.scale.toArray().map(v => parseFloat(v.toFixed(4))),
        }));
    return {
      meta: { title: "ARea Scene V2", createdAt: new Date().toISOString() },
      assets: assets,
    };
  }
  
  removeInitialObject() { /* leer, da wir keinen Dummy mehr nutzen */ }
}
