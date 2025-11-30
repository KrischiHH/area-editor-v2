import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

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

    // Licht
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    // State
    this.editableObjects = [];
    this.selectedObject = null;
    this.audioConfig = null;
    this.modelAnimationMap = new Map(); // Map<THREE.Object3D, { clips: THREE.AnimationClip[] }>

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);

    this.exporter = new GLTFExporter();

    // Callbacks (vom App-Code überschrieben)
    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    // Animation Loop
    this._clock = new THREE.Clock();
    this._mixers = [];

    const animate = () => {
      requestAnimationFrame(animate);
      const delta = this._clock.getDelta();
      this._mixers.forEach(m => m.update(delta));
      this.renderer.render(this.scene, this.camera);
    };
    animate();

    // Resize
    window.addEventListener('resize', () => this._handleResize());

    // Boden-Referenz (optional)
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    grid.position.y = 0;
    this.scene.add(grid);
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
        // Markiere als editierbar
        root.traverse(o => {
          o.userData.isEditable = true;
        });

        // Animationen sammeln
        if (gltf.animations && gltf.animations.length > 0) {
          this.modelAnimationMap.set(root, { clips: gltf.animations });
          // Optional sofort einen Mixer anlegen
          const mixer = new THREE.AnimationMixer(root);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
          this._mixers.push(mixer);
        }

        root.name = nameHint || 'Modell';
        this.scene.add(root);
        this.editableObjects.push(root);
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
    }
    this.onSelectionChange();
    this._fireSceneUpdate();
  }

  updateSelectedTransform(pos, rotDeg, scale) {
    if (!this.selectedObject) return;
    if (pos) {
      if (Number.isFinite(pos.x)) this.selectedObject.position.x = pos.x;
      if (Number.isFinite(pos.y)) this.selectedObject.position.y = pos.y;
      if (Number.isFinite(pos.z)) this.selectedObject.position.z = pos.z;
    }
    if (rotDeg) {
      // Rotation in Grad → Rad
      const toRad = THREE.MathUtils.degToRad;
      if (Number.isFinite(rotDeg.x)) this.selectedObject.rotation.x = toRad(rotDeg.x);
      if (Number.isFinite(rotDeg.y)) this.selectedObject.rotation.y = toRad(rotDeg.y);
      if (Number.isFinite(rotDeg.z)) this.selectedObject.rotation.z = toRad(rotDeg.z);
    }
    if (Number.isFinite(scale) && scale > 0) {
      this.selectedObject.scale.set(scale, scale, scale);
    }
    this.onTransformChange();
    this._fireSceneUpdate();
  }

  _fireSceneUpdate() {
    this.onSceneUpdate();
  }

  getSceneConfig() {
    const assets = []; // Optional: hier später echte Asset-Liste ergänzen

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
