import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // Grundelemente
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 1.6, 4);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();

    // TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(1.0);
    this.transformControls.addEventListener('dragging-changed', e => {
      this.controls.enabled = !e.value;
    });
    this.transformControls.addEventListener('change', () => {
      // Trigger transform callback bei echter Änderung (Drag Ende)
      if (!this.transformControls.dragging && this.selectedObject) {
        this.onTransformChange?.();
      }
    });
    this.scene.add(this.transformControls);

    // Licht
    const hemi = new THREE.HemisphereLight(0xffffff, 0x394053, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(6, 12, 8);
    dir.castShadow = false;
    this.scene.add(dir);

    // Boden / Hilfen
    const grid = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    grid.position.y = 0;
    this.scene.add(grid);

    // Achsenhelper optional:
    this.axesHelper = new THREE.AxesHelper(1.5);
    this.axesHelper.visible = false; // auf Wunsch aktivierbar
    this.scene.add(this.axesHelper);

    // State
    this.editableObjects = [];
    this.selectedObject = null;
    this.audioConfig = null;
    this.modelAnimationMap = new Map();
    this._mixers = [];
    this._clock = new THREE.Clock();
    this._outlineEnabled = true;

    // Loader / Exporter
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);
    this.exporter = new GLTFExporter();

    // Postprocessing Composer + OutlinePass
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      this.scene,
      this.camera
    );
    this.outlinePass.edgeStrength = 5.0;
    this.outlinePass.edgeGlow = 0.3;
    this.outlinePass.edgeThickness = 1.0;
    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#4da6ff');
    this.outlinePass.hiddenEdgeColor.set('#1a3d66');

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outlinePass);

    // Callbacks (werden von app.js gesetzt)
    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    // Render Loop
    const animate = () => {
      requestAnimationFrame(animate);
      const delta = this._clock.getDelta();
      this._mixers.forEach(m => m.update(delta));
      this.controls.update();

      if (this._outlineEnabled) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();

    // Resize Handling
    window.addEventListener('resize', () => this._handleResize());
  }

  _handleResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
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
          o.castShadow = false;
          o.receiveShadow = false;
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

        // Erstes Modell fokusieren
        if (this.editableObjects.length === 1) {
          this.focusObject(root);
        }

        this._fireSceneUpdate();
      },
      undefined,
      err => console.error('Modell laden fehlgeschlagen:', err)
    );
  }

  selectObject(obj) {
    if (!obj || !this.editableObjects.includes(obj)) {
      this.selectedObject = null;
      this.transformControls.detach();
      this.outlinePass.selectedObjects = [];
      this.axesHelper.visible = false;
    } else {
      this.selectedObject = obj;
      this.transformControls.attach(obj);
      this.outlinePass.selectedObjects = [obj];
      this.axesHelper.visible = true;
      this.axesHelper.position.copy(obj.position);
    }
    // Orbit Ziel anpassen
    if (this.selectedObject) {
      this.controls.target.copy(this.selectedObject.position);
      this.controls.update();
    }
    this.onSelectionChange?.();
    this._fireSceneUpdate();
  }

  cycleGizmoMode() {
    const mode = this.transformControls.getMode();
    const order = ['translate','rotate','scale'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    this.transformControls.setMode(next);
    return next;
  }

  focusSelected() {
    if (this.selectedObject) this.focusObject(this.selectedObject);
  }

  focusObject(obj) {
    if (!obj) return;
    const offset = new THREE.Vector3(0, 0.5, 4);
    this.camera.position.copy(obj.position).add(offset);
    this.controls.target.copy(obj.position);
    this.controls.update();
  }

  duplicateSelected() {
    if (!this.selectedObject) return null;
    const clone = this.selectedObject.clone(true);
    clone.name = this.selectedObject.name + '_Copy';
    clone.position.x += 0.5;
    clone.position.z += 0.5;
    clone.traverse(o => { o.userData.isEditable = true; });
    this.scene.add(clone);
    this.editableObjects.push(clone);
    this.selectObject(clone);
    this._fireSceneUpdate();
    return clone;
  }

  deleteSelected() {
    if (!this.selectedObject) return;
    const idx = this.editableObjects.indexOf(this.selectedObject);
    if (idx >= 0) this.editableObjects.splice(idx, 1);
    this.scene.remove(this.selectedObject);
    this.selectedObject = null;
    this.transformControls.detach();
    this.outlinePass.selectedObjects = [];
    this.axesHelper.visible = false;
    this._fireSceneUpdate();
    this.onSelectionChange?.();
  }

  snapToGround() {
    if (!this.selectedObject) return;
    // Bounding Box holen
    const box = new THREE.Box3().setFromObject(this.selectedObject);
    const minY = box.min.y;
    if (Number.isFinite(minY)) {
      // Verschiebe so, dass die Unterkante auf y=0 liegt
      this.selectedObject.position.y -= minY;
      this.onTransformChange?.();
      this._fireSceneUpdate();
    }
  }

  toggleOutline() {
    this._outlineEnabled = !this._outlineEnabled;
    return this._outlineEnabled;
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
    this.axesHelper.position.copy(this.selectedObject.position);
    this.onTransformChange?.();
    this._fireSceneUpdate();
  }

  _fireSceneUpdate() {
    this.onSceneUpdate?.();
  }

  getSceneConfig() {
    const assets = []; // Kann später gefüllt werden

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
