import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class SceneManager {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.transformControls = null;
    this.loader = new GLTFLoader();
    this.exporter = new GLTFExporter();

    this.clock = new THREE.Clock();
    this.mixers = [];
    this.editableObjects = [];
    this.selectedObject = null;

    // Root -> { clips: AnimationClip[] }
    this.modelAnimationMap = new Map();

    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};
    this.audioConfig = null;

    this.init();
    this.animate();
  }

  setAudioConfig(cfg){ 
    // NEU: Nur speichern, wenn die URL gesetzt ist, sonst null setzen.
    this.audioConfig = (cfg && cfg.url) ? { ...cfg } : null; 
  }

  init(){
    const { width, height } = this.canvas.getBoundingClientRect();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23);
    
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7.5);
    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, 0, -1);
    dirLight.add(lightTarget);
    dirLight.target = lightTarget;
    this.scene.add(dirLight);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(2, 2, 3);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
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

    // Click selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.transformControls.dragging) return;
      const rect = this.canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(this.editableObjects, true);
      if (intersects.length > 0) {
        let target = intersects[0].object;
        while (target.parent && !this.editableObjects.includes(target)) {
          target = target.parent;
        }
        if (this.editableObjects.includes(target)) {
          this.selectObject(target);
        }
      } else {
        this.selectObject(null);
      }
    });
  }

  loadModel(url, assetName){
    this.loader.load(url, gltf => {
      const model = gltf.scene;
      model.userData.assetUrl = assetName;
      model.userData.isEditable = true;
      model.name = this.makeUniqueName(assetName.replace(/\.(glb|gltf)$/i,''));

      // NEU: Floor alignment und Y-Offset Speicherung
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      const yOffsetCorrection = center.y - (size.y / 2);
      
      // Korrektur in THREE.js anwenden
      model.position.y -= yOffsetCorrection; 
      
      // Den Korrekturwert speichern (der Wert, der den Editor korrigiert hat)
      model.userData.yOffsetCorrection = yOffsetCorrection; 

      if (gltf.animations && gltf.animations.length){
        const clonedClips = gltf.animations.map(c => c.clone());
        this.modelAnimationMap.set(model, { clips: clonedClips });

        // Preview (optional)
        const mixer = new THREE.AnimationMixer(model);
        this.mixers.push(mixer);
        mixer.clipAction(clonedClips[0]).play();
      }

      this.scene.add(model);
      this.editableObjects.push(model);

      this.onSceneUpdate();
      this.selectObject(model);
      URL.revokeObjectURL(url);
    }, undefined, err => console.error(err));
  }

  makeUniqueName(base){
    let name = base;
    let i = 2;
    const exists = () => this.editableObjects.some(o => o.name === name);
    while (exists()) {
      name = base + '_' + i;
      i++;
    }
    return name;
  }

  selectObject(object){
    this.selectedObject = object;
    if (object && this.editableObjects.includes(object)) {
      this.transformControls.attach(object);
    } else {
      this.transformControls.detach();
    }
    this.onSelectionChange();
  }

  updateSelectedTransform(position, rotation, scale){
    if (!this.selectedObject) return;
    if (position) this.selectedObject.position.set(position.x, position.y, position.z);
    if (rotation) this.selectedObject.rotation.set(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z)
    );
    if (scale) this.selectedObject.scale.setScalar(scale);
    this.onTransformChange();
  }

  onWindowResize(){
    const { width, height } = this.canvas.getBoundingClientRect();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate(){
    requestAnimationFrame(this.animate.bind(this));
    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m.update(delta));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  getSceneConfig(){
    const rotationToArray = (rot) => [rot.x, rot.y, rot.z];
    
    // Filtert alle Modelle heraus, die exportiert werden sollen.
    const assets = this.editableObjects
      .filter(o => o.userData.isEditable && o.userData.assetUrl)
      .map(o => ({
        uuid: o.uuid,
        name: o.name || o.userData.assetUrl,
        type: 'model',
        url: o.userData.assetUrl,
        position: o.position.toArray().map(v => +v.toFixed(4)),
        rotation: rotationToArray(o.rotation).map(v => +v.toFixed(4)),
        scale: o.scale.toArray().map(v => +v.toFixed(4))
      }));

    const main = assets.find(a => a.url.toLowerCase().endsWith('.glb'));
    let modelEntry = undefined;
    if (main) {
      modelEntry = { url: 'scene.glb' };
      
      // NEU: Y-Offset für Viewer exportieren
      const mainObject = this.editableObjects.find(o => o.uuid === main.uuid);
      if (mainObject && mainObject.userData.yOffsetCorrection) {
        // Der Wert, der im Viewer-CSS verwendet werden kann.
        // Muss hier als float exportiert werden, damit er im Viewer verarbeitet werden kann.
        modelEntry.yOffset = +mainObject.userData.yOffsetCorrection.toFixed(4); 
      }
    }

    const clickableNodes = this.editableObjects
      .filter(o => o.userData.linkUrl && o.userData.linkUrl.trim())
      .map(o => ({
        // ACHTUNG: Hier müssten wir den Node-Namen statt der Position übergeben, 
        // wenn wir das Modell verschieben. Fürs Erste nehmen wir den Hauptnamen.
        url: o.userData.linkUrl.trim(),
        // Da wir Submeshes einführen wollen, ändern wir das Label in den Namen des Objekts
        label: o.name || o.uuid 
      }));

    // KORRIGIERT: Audio-Block wird nur erstellt, wenn this.audioConfig existiert (was es tut, 
    // wenn im Dropdown etwas ausgewählt wurde).
    const audio = this.audioConfig ? {
        url: this.audioConfig.url,
        loop: !!this.audioConfig.loop,
        delaySeconds: this.audioConfig.delaySeconds || 0,
        volume: Math.min(1, Math.max(0, this.audioConfig.volume ?? 0.8))
      }
      : undefined; // Wenn this.audioConfig null ist (keine URL gewählt), wird der audio Block weggelassen

    return {
      meta: { title: 'ARea Scene V2', createdAt: new Date().toISOString(), animationStrategy: 'merged' },
      model: modelEntry,
      audio,
      clickableNodes,
      assets
    };
  }

exportMergedGlbBlob(){
    return new Promise(async (resolve, reject) => {
      try {
        // Nur Assets exportieren, die in der Szene sind
        const exportableAssets = this.editableObjects.filter(o => o.userData.isEditable);
        
        // Temporäre Szene für den Export erstellen, um nur das Modell zu enthalten
        const tempScene = new THREE.Scene();
        exportableAssets.forEach(asset => {
          // Position, Rotation und Skalierung der Assets kopieren
          const clone = asset.clone();
          tempScene.add(clone);
        });

        // Animationen zusammenführen
        const animations = this.buildMergedAnimationClip(exportableAssets);
        
        // Export
        this.exporter.parse(
          tempScene,
          (gltf) => {
            resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
          },
          (error) => {
            reject(error);
          },
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
    // Sammelt alle Animation Clips
    const allClips = [];
    objects.forEach(obj => {
      if (this.modelAnimationMap.has(obj)){
        allClips.push(...this.modelAnimationMap.get(obj).clips);
      }
    });

    if (allClips.length === 0) return [];
    
    // Zusammenführen aller Clips in einen einzigen "merged" Clip
    // Dies ist notwendig für den GLTFExporter, wenn er mehrere Animationen hat.
    const mergedClip = THREE.AnimationUtils.createClip(
      'merged_animation',
      -1, // Dauer wird automatisch berechnet
      allClips.flatMap(clip => clip.tracks)
    );

    return [mergedClip];
  }

} // <-- Schließt die Klasse SceneManager
