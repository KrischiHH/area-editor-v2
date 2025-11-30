import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // THREE Grundelemente
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      200
    );
    this.camera.position.set(0, 1.6, 3);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.2, 0);
    this.controls.update();

    // Licht
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    // Boden-Referenz
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    grid.position.y = 0;
    this.scene.add(grid);

    // State
    this.editableObjects = [];
    this.selectedObject = null;
    this.audioConfig = null;
    this.modelAnimationMap = new Map(); // Map<THREE.Object3D, { clips: THREE.AnimationClip[] }>

    // Loader / Exporter
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);
    this.exporter = new GLTFExporter();

    // Callbacks (vom App-Code überschrieben)
    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    // Animation / Render Loop
    this._clock = new THREE.Clock();
    this._mixers = [];

    const animate = () => {
      requestAnimationFrame(animate);
      const delta = this._clock.getDelta();
      this._mixers.forEach(m => m.update(delta));
      this.controls.update(); // wichtig für Damping
      this.renderer.render(this.scene, this.camera);
    };
    animate();

    // Resize
    window.addEventListener('resize', () => this._handleResize());
  }

  _handleResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setAudioConfig(cfg) {
    this.audioConfig = cfg;
  }

  loadModel(url, nameHint) {
    this.loader.load(
      url,
      gltf => {
        const root = gltf.scene;
        root.traverse(o => {
          o.userData.isEditable = true;
        });

        if (gltf.animations && gltf.animations.length > 0) {
          this.modelAnimationMap.set(root, { clips: gltf.animations });
          const mixer = new THREE.AnimationMixer(root);
          gltf.animations.forEach(clip => mixer.clipAction(clip).play());
          this._mixers.push(mixer);
        }

        root.name = nameHint || 'Modell';
        this.scene.add(root);
        this.editableObjects.push(root);

        // Falls erstes Modell → Fokus
        if (this.editableObjects.length === 1) {
          this.focusObject(root);
        }

        this._fireSceneUpdate();
      },
      undefined,
      err => {
        console.error('Modell laden fehlgeschlagen:', err);
      }
    );
  }

  selectObject(obj) {
    if (!obj || !this.editableObjects.includes(obj)) {
      this.selectedObject = null;
    } else {
      this.selectedObject = obj;
      // OrbitControls Fokus aktualisieren
      this.controls.target.copy(obj.position);
      this.controls.update();
    }
    this.onSelectionChange();
    this._fireSceneUpdate();
  }

  focusObject(obj) {
    if (!obj) return;
    // Kamera etwas versetzt zum Objekt platzieren
    const offset = new THREE.Vector3(0, 0.5, 3);
    this.camera.position.copy(obj.position).add(offset);
    this.controls.target.copy(obj.position);
    this.controls.update();
  }

  focusSelected() {
    if (this.selectedObject) {
      this.focusObject(this.selectedObject);
    }
  }

  updateSelectedTransform(pos, rotDeg, scale) {
    if (!this.selectedObject) return;
    if (pos) {
      if (Number.isFinite(pos.x)) this.selectedObject.position.x = pos.x;
      if (Number.isFinite(pos.y)) this.selectedObject.position.y = pos.y;
      if (Number.isFinite(pos.z)) this.selectedObject.position.z = pos.z;
    }
    if (rotDeg) {
      const toRad = THREE.MathUtils.degToRad;
      if (Number.isFinite(rotDeg.x)) this.selectedObject.rotation.x = toRad(rotDeg.x);
      if (Number.isFinite(rotDeg.y)) this.selectedObject.rotation.y = toRad(rotDeg.y);
      if (Number.isFinite(rotDeg.z)) this.selectedObject.rotation.z = toRad(rotDeg.z);
    }
    if (Number.isFinite(scale) && scale > 0) {
      this.selectedObject.scale.set(scale, scale, scale);
    }
    // Nach Transform optional Fokus aktualisieren
    this.controls.target.copy(this.selectedObject.position);
    this.controls.update();

    this.onTransformChange();
    this._fireSceneUpdate();
  }

  _fireSceneUpdate() {
    this.onSceneUpdate();
  }

  getSceneConfig() {
    const assets = []; // Optional später befüllen

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
      }));

    const audio = (this.audioConfig && this.audioConfig.url)
      ? {
          url: this.audioConfig.url,
          loop: !!this.audioConfig.loop,
          delaySeconds: this.audioConfig.delaySeconds || 0,
          volume: Math.min(1, Math.max(0, this.audioConfig.volume ?? 0.8)),
          embedElement: true
        }
      : undefined;

    const modelEntry = {
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

  exportMergedGlbBlob() {
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
          gltf => {
            resolve(new Blob([gltf], { type: 'application/octet-stream' }));
          },
          error => { reject(error); },
          {
            binary: true,
            animations: animations.length > 0 ? animations : undefined,
            embedImages: true,
            onlyVisible: true,
            includeCustomExtensions: false
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  buildMergedAnimationClip(objects) {
    const allClips = [];
    objects.forEach(obj => {
      if (this.modelAnimationMap.has(obj)) {
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
