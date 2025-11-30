import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // Hintergrund bewusst etwas heller als True-Black
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 800);
    this.camera.position.set(0, 1.6, 4);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Modernes Farbmanagement (Three r160+)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35; // etwas heller als Standard

    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();

    // Transform Controls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(1.0);
    this.transformControls.addEventListener('dragging-changed', e => {
      this.controls.enabled = !e.value;
      if (e.value) {
        if (this.pivotEditMode) {
          this._pivotDragStart = this._captureTransform(this._pivot);
        } else if (this.selectedObjects.length > 0) {
          this._groupTransformStartStates = this.selectedObjects.map(o => ({
            object: o,
            prev: this._captureTransform(o)
          }));
          this._pivotStartState = this._captureTransform(this._pivot);
        }
      } else {
        if (this.pivotEditMode) {
          const end = this._captureTransform(this._pivot);
          if (!this._compareTransform(this._pivotDragStart, end)) {
            this._pushCommand({
              type: 'groupPivotChange',
              prev: this._pivotDragStart,
              next: end
            });
          }
          this._pivotDragStart = null;
        } else if (this.selectedObjects.length > 0 && this._groupTransformStartStates) {
          const mode = this.transformControls.getMode();
          const items = this.selectedObjects.map(o => ({
            object: o,
            prev: this._groupTransformStartStates.find(s => s.object === o)?.prev,
            next: this._captureTransform(o)
          }));
          const changed = items.some(i => !this._compareTransform(i.prev, i.next));
          if (changed) {
            this._pushCommand({
              type: 'groupTransform',
              mode,
              items
            });
            this.onTransformChange?.();
          }
        }
        this._groupTransformStartStates = null;
        this._pivotStartState = null;
      }
    });
    this.transformControls.addEventListener('change', () => {
      if (this.transformControls.dragging && this.selectedObjects.length > 1 && !this.pivotEditMode) {
        this._applyPivotLiveTransform();
      }
    });
    this.scene.add(this.transformControls);

    // Licht (Standard “Studio” – heller)
    this.currentLightProfile = 'studio';
    this._lights = [];
    this._applyLightingProfile(this.currentLightProfile);

    // Helleres Grid
    const grid = new THREE.GridHelper(50, 50, 0x6b7785, 0x343b43);
    grid.material.opacity = 0.7;
    grid.material.transparent = true;
    this.scene.add(grid);

    // Achsen-Helfer
    this.axesHelper = new THREE.AxesHelper(1.2);
    this.axesHelper.visible = false;
    this.scene.add(this.axesHelper);

    // State
    this.editableObjects = [];
    this.selectedObjects = [];
    this.audioConfig = null;
    this.modelAnimationMap = new Map();
    this._mixers = [];
    this._clock = new THREE.Clock();
    this._outlineEnabled = true;

    // Pivot
    this._pivot = new THREE.Object3D();
    this._pivot.name = '_SelectionPivot';
    this.scene.add(this._pivot);
    this.pivotEditMode = false;
    this._pivotDragStart = null;

    // Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this._groupTransformStartStates = null;
    this._pivotStartState = null;

    // Loader / Exporter
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);
    this.exporter = new GLTFExporter();

    // Environment (RoomEnvironment → neutral und ausreichend hell)
    this._setupRoomEnvironment();

    // Postprocessing Outline
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.outlinePass = new OutlinePass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), this.scene, this.camera);
    this.outlinePass.edgeStrength = 5.0;
    this.outlinePass.edgeGlow = 0.3;
    this.outlinePass.edgeThickness = 1.0;
    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#4da6ff');
    this.outlinePass.hiddenEdgeColor.set('#1a3d66');
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outlinePass);

    // Callbacks
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

    window.addEventListener('resize', () => this._handleResize());
  }

  /* ---------- Lighting Profiles ---------- */
  _clearLights() {
    this._lights.forEach(l => this.scene.remove(l));
    this._lights = [];
  }

  _applyLightingProfile(profile) {
    this._clearLights();

    if (profile === 'studio') {
      // Helles, weiches Studio-Setup
      const hemi = new THREE.HemisphereLight(0xffffff, 0x24303a, 1.0);
      const key = new THREE.DirectionalLight(0xffffff, 1.45);
      key.position.set(5, 7, 4);
      const fill = new THREE.DirectionalLight(0xdfe7f5, 0.75);
      fill.position.set(-6, 4, -3);
      const rim = new THREE.DirectionalLight(0xbcd4ff, 0.8);
      rim.position.set(-3, 6, 6);
      const ambient = new THREE.AmbientLight(0xffffff, 0.35);
      [hemi, key, fill, rim, ambient].forEach(l => {
        l.castShadow = false;
        this.scene.add(l);
        this._lights.push(l);
      });
      this.renderer.toneMappingExposure = 1.35;
    } else if (profile === 'neutral') {
      const ambient = new THREE.AmbientLight(0xffffff, 0.8);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f48, 0.8);
      this.scene.add(ambient, hemi);
      this._lights.push(ambient, hemi);
      this.renderer.toneMappingExposure = 1.2;
    } else if (profile === 'bright') {
      const hemi = new THREE.HemisphereLight(0xffffff, 0xbdd2ff, 1.2);
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(6, 9, 4);
      const fill = new THREE.DirectionalLight(0xeaf1ff, 0.9);
      fill.position.set(-6, 5, -4);
      [hemi, key, fill].forEach(l => this.scene.add(l));
      this._lights.push(hemi, key, fill);
      this.renderer.toneMappingExposure = 1.5;
    }

    this.currentLightProfile = profile;
  }

  cycleLightProfile() {
    const order = ['studio', 'neutral', 'bright'];
    const next = order[(order.indexOf(this.currentLightProfile) + 1) % order.length];
    this._applyLightingProfile(next);
    return next;
  }

  /* ---------- RoomEnvironment (keine sigma-Warnungen) ---------- */
  _setupRoomEnvironment() {
    const pmrem = new PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.03); // kleine blur
    this.scene.environment = env.texture;
    // Kein fromScene eigener Dummy mehr → keine sigma-Warnungen
  }

  /* ---------- Utility ---------- */
  _handleResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setAudioConfig(cfg) { this.audioConfig = cfg; }

  _captureTransform(obj) {
    if (!obj) return null;
    return {
      position: obj.position.clone(),
      rotation: obj.rotation.clone(),
      scale: obj.scale.clone(),
      name: obj.name
    };
  }

  _applyTransform(obj, state) {
    if (!obj || !state) return;
    obj.position.copy(state.position);
    obj.rotation.copy(state.rotation);
    obj.scale.copy(state.scale);
    if (state.name !== undefined) obj.name = state.name;
  }

  _compareTransform(a, b) {
    if (!a || !b) return false;
    return a.position.equals(b.position) &&
      a.rotation.x === b.rotation.x &&
      a.rotation.y === b.rotation.y &&
      a.rotation.z === b.rotation.z &&
      a.scale.equals(b.scale) &&
      a.name === b.name;
  }

  _pushCommand(cmd) {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  /* ---------- Load ---------- */
  loadModel(url, nameHint) {
    this.loader.load(
      url,
      gltf => {
        const root = gltf.scene;
        root.traverse(o => { o.userData.isEditable = true; });

        // Notfalls minimal heller färben, wenn reines Schwarz vorkommt
        root.traverse(o => {
          if (o.isMesh && o.material) {
            if (o.material.color && o.material.color.getHex() === 0x000000) {
              o.material.color.setHex(0x222931);
            }
            o.material.needsUpdate = true;
          }
        });

        if (gltf.animations?.length) {
          this.modelAnimationMap.set(root, { clips: gltf.animations });
          const mixer = new THREE.AnimationMixer(root);
          gltf.animations.forEach(c => mixer.clipAction(c).play());
          this._mixers.push(mixer);
        }
        root.name = nameHint || 'Modell';
        this.scene.add(root);
        this.editableObjects.push(root);
        this._pushCommand({ type: 'groupAdd', objects: [root] });
        if (this.editableObjects.length === 1) this.focusObject(root);
        this._fireSceneUpdate();
      },
      undefined,
      err => console.error('Modell laden fehlgeschlagen:', err)
    );
  }

  /* ---------- Selection & Pivot ---------- */
  selectObject(obj, additive = false) {
    if (!obj || !this.editableObjects.includes(obj)) {
      if (!additive) this.clearSelection();
      return;
    }
    if (additive) {
      if (this.selectedObjects.includes(obj)) {
        this.selectedObjects = this.selectedObjects.filter(o => o !== obj);
      } else {
        this.selectedObjects.push(obj);
      }
    } else {
      this.selectedObjects = [obj];
    }
    this._updateSelectionVisuals();
  }

  clearSelection() {
    this.selectedObjects = [];
    this._updateSelectionVisuals();
  }

  selectAll() {
    this.selectedObjects = [...this.editableObjects];
    this._updateSelectionVisuals();
  }

  _updateSelectionVisuals() {
    this.outlinePass.selectedObjects = [...this.selectedObjects];
    if (this.selectedObjects.length === 0) {
      this.transformControls.detach();
      this.axesHelper.visible = false;
      if (this.pivotEditMode) this.pivotEditMode = false;
    } else if (this.selectedObjects.length === 1) {
      const only = this.selectedObjects[0];
      if (!this.pivotEditMode) this.transformControls.attach(only);
      this.axesHelper.visible = true;
      this.axesHelper.position.copy(only.position);
      this.controls.target.copy(only.position);
    } else {
      const center = new THREE.Vector3();
      this.selectedObjects.forEach(o => center.add(o.position));
      center.multiplyScalar(1 / this.selectedObjects.length);
      if (!this.pivotEditMode && this._pivotDragStart == null) {
        this._pivot.position.copy(center);
      }
      if (!this.pivotEditMode) {
        this.transformControls.attach(this._pivot);
      }
      this.axesHelper.visible = true;
      this.axesHelper.position.copy(this._pivot.position);
      this.controls.target.copy(this._pivot.position);
    }
    this.controls.update();
    this.onSelectionChange?.();
    this._fireSceneUpdate();
  }

  togglePivotEdit() {
    if (this.selectedObjects.length < 2) return false;
    this.pivotEditMode = !this.pivotEditMode;
    if (this.pivotEditMode) {
      this.transformControls.attach(this._pivot);
    } else {
      this.transformControls.attach(this._pivot);
    }
    return this.pivotEditMode;
  }

  _applyPivotLiveTransform() {
    if (!this._pivotStartState || !this._pivot || this.selectedObjects.length < 2 || this.pivotEditMode) return;
    const mode = this.transformControls.getMode();
    const pivotPrev = this._pivotStartState.position;
    const pivotCurrent = this._pivot.position.clone();
    const deltaPos = pivotCurrent.clone().sub(pivotPrev);

    if (mode === 'translate') {
      this.selectedObjects.forEach(o => o.position.add(deltaPos));
    } else if (mode === 'rotate') {
      const qPrev = new THREE.Quaternion().setFromEuler(this._pivotStartState.rotation);
      const qCurr = new THREE.Quaternion().setFromEuler(this._pivot.rotation);
      const qDelta = qPrev.clone().invert().multiply(qCurr);
      this.selectedObjects.forEach(o => {
        const offset = o.position.clone().sub(pivotPrev);
        offset.applyQuaternion(qDelta);
        o.position.copy(pivotPrev.clone().add(offset));
        o.quaternion.multiply(qDelta);
      });
    } else if (mode === 'scale') {
      const prevScale = this._pivotStartState.scale;
      const currScale = this._pivot.scale;
      const sx = currScale.x / (prevScale.x || 1);
      this.selectedObjects.forEach(o => {
        const offset = o.position.clone().sub(pivotPrev).multiplyScalar(sx);
        o.position.copy(pivotPrev.clone().add(offset));
        o.scale.multiplyScalar(sx);
      });
    }
    this.axesHelper.position.copy(this._pivot.position);
  }

  cycleGizmoMode() {
    const mode = this.transformControls.getMode();
    const order = ['translate','rotate','scale'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    this.transformControls.setMode(next);
    return next;
  }

  focusSelected() {
    if (this.selectedObjects.length === 0) return;
    this.focusObject(this.selectedObjects[0]);
  }

  focusObject(obj) {
    if (!obj) return;
    const offset = new THREE.Vector3(0, 0.5, 4);
    this.camera.position.copy(obj.position).add(offset);
    this.controls.target.copy(obj.position);
    this.controls.update();
  }

  /* ---------- Actions ---------- */
  duplicateSelected() {
    if (this.selectedObjects.length === 0) return [];
    const newObjects = this.selectedObjects.map(src => {
      const clone = src.clone(true);
      clone.name = src.name + '_Copy';
      clone.position.x += 0.5;
      clone.position.z += 0.5;
      clone.traverse(o => { o.userData.isEditable = true; });
      this.scene.add(clone);
      this.editableObjects.push(clone);
      return clone;
    });
    this._pushCommand({ type: 'groupAdd', objects: newObjects });
    this.selectedObjects = newObjects;
    this._updateSelectionVisuals();
    return newObjects;
  }

  deleteSelected() {
    if (this.selectedObjects.length === 0) return;
    const toDelete = [...this.selectedObjects];
    toDelete.forEach(obj => {
      const idx = this.editableObjects.indexOf(obj);
      if (idx >= 0) this.editableObjects.splice(idx, 1);
      this.scene.remove(obj);
    });
    this._pushCommand({
      type: 'groupDelete',
      objects: toDelete,
      prevStates: toDelete.map(o => this._captureTransform(o))
    });
    this.selectedObjects = [];
    this._updateSelectionVisuals();
  }

  snapToGround() {
    if (this.selectedObjects.length === 0) return;
    const beforeStates = this.selectedObjects.map(o => this._captureTransform(o));
    this.selectedObjects.forEach(o => {
      const box = new THREE.Box3().setFromObject(o);
      const minY = box.min.y;
      if (Number.isFinite(minY)) o.position.y -= minY;
    });
    const afterStates = this.selectedObjects.map(o => this._captureTransform(o));
    const changed = afterStates.some((aft, i) => !this._compareTransform(beforeStates[i], aft));
    if (changed) {
      this._pushCommand({
        type: 'groupTransform',
        mode: 'snap',
        items: this.selectedObjects.map((o, i) => ({
          object: o,
          prev: beforeStates[i],
          next: afterStates[i]
        }))
      });
      this.onTransformChange?.();
      this._fireSceneUpdate();
    }
  }

  toggleOutline() {
    this._outlineEnabled = !this._outlineEnabled;
    return this._outlineEnabled;
  }

  updateSelectedTransform(pos, rotDeg, scale) {
    if (this.selectedObjects.length !== 1) return;
    const obj = this.selectedObjects[0];
    const before = this._captureTransform(obj);
    if (pos) {
      if (Number.isFinite(pos.x)) obj.position.x = pos.x;
      if (Number.isFinite(pos.y)) obj.position.y = pos.y;
      if (Number.isFinite(pos.z)) obj.position.z = pos.z;
    }
    if (rotDeg) {
      const toRad = THREE.MathUtils.degToRad;
      if (Number.isFinite(rotDeg.x)) obj.rotation.x = toRad(rotDeg.x);
      if (Number.isFinite(rotDeg.y)) obj.rotation.y = toRad(rotDeg.y);
      if (Number.isFinite(rotDeg.z)) obj.rotation.z = toRad(rotDeg.z);
    }
    if (Number.isFinite(scale) && scale > 0) obj.scale.set(scale, scale, scale);
    const after = this._captureTransform(obj);
    if (!this._compareTransform(before, after)) {
      this._pushCommand({ type: 'transform', object: obj, prev: before, next: after });
      this.onTransformChange?.();
      this._fireSceneUpdate();
    }
  }

  /* ---------- Undo / Redo ---------- */
  undo() {
    if (this.undoStack.length === 0) return;
    const cmd = this.undoStack.pop();
    this.redoStack.push(cmd);

    switch(cmd.type) {
      case 'groupAdd':
        cmd.objects.forEach(o => {
          const idx = this.editableObjects.indexOf(o);
          if (idx >= 0) this.editableObjects.splice(idx, 1);
          this.scene.remove(o);
        });
        this.selectedObjects = this.selectedObjects.filter(o => !cmd.objects.includes(o));
        this._updateSelectionVisuals();
        break;
      case 'groupDelete':
        cmd.objects.forEach((o, i) => {
          this.scene.add(o);
          if (!this.editableObjects.includes(o)) this.editableObjects.push(o);
          this._applyTransform(o, cmd.prevStates[i]);
        });
        this.selectedObjects = [...cmd.objects];
        this._updateSelectionVisuals();
        break;
      case 'transform':
        this._applyTransform(cmd.object, cmd.prev);
        this._fireSceneUpdate();
        break;
      case 'groupTransform':
        cmd.items.forEach(it => this._applyTransform(it.object, it.prev));
        this._fireSceneUpdate();
        break;
      case 'groupPivotChange':
        this._applyTransform(this._pivot, cmd.prev);
        this._fireSceneUpdate();
        break;
      default:
        console.warn('Unbekannter Undo-Typ:', cmd.type);
    }
    this.onSelectionChange?.();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const cmd = this.redoStack.pop();
    this.undoStack.push(cmd);

    switch(cmd.type) {
      case 'groupAdd':
        cmd.objects.forEach(o => {
          this.scene.add(o);
          if (!this.editableObjects.includes(o)) this.editableObjects.push(o);
        });
        this.selectedObjects = [...cmd.objects];
        this._updateSelectionVisuals();
        break;
      case 'groupDelete':
        cmd.objects.forEach(o => {
          const idx = this.editableObjects.indexOf(o);
          if (idx >= 0) this.editableObjects.splice(idx, 1);
          this.scene.remove(o);
        });
        this.selectedObjects = this.selectedObjects.filter(o => !cmd.objects.includes(o));
        this._updateSelectionVisuals();
        break;
      case 'transform':
        this._applyTransform(cmd.object, cmd.next);
        this._fireSceneUpdate();
        break;
      case 'groupTransform':
        cmd.items.forEach(it => this._applyTransform(it.object, it.next));
        this._fireSceneUpdate();
        break;
      case 'groupPivotChange':
        this._applyTransform(this._pivot, cmd.next);
        this._fireSceneUpdate();
        break;
      default:
        console.warn('Unbekannter Redo-Typ:', cmd.type);
    }
    this.onSelectionChange?.();
  }

  /* ---------- SceneConfig ---------- */
  _fireSceneUpdate() { this.onSceneUpdate?.(); }

  getSceneConfig() {
    const assets = [];
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
    const modelEntry = { url: this.currentModelFileName || 'scene.glb' };
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
        exportableAssets.forEach(asset => tempScene.add(asset.clone()));
        const animations = this.buildMergedAnimationClip(exportableAssets);
        this.exporter.parse(
          tempScene,
          gltf => resolve(new Blob([gltf], { type: 'application/octet-stream' })),
          err => reject(err),
          {
            binary: true,
            animations: animations.length > 0 ? animations : undefined,
            embedImages: true,
            onlyVisible: true,
            includeCustomExtensions: false
          }
        );
      } catch(e) { reject(e); }
    });
  }

  buildMergedAnimationClip(objects) {
    const allClips = [];
    objects.forEach(o => {
      if (this.modelAnimationMap.has(o)) {
        allClips.push(...this.modelAnimationMap.get(o).clips);
      }
    });
    if (!allClips.length) return [];
    const merged = new THREE.AnimationClip('merged_animation', -1, allClips.flatMap(c => c.tracks));
    return [merged];
  }
}

export default SceneManager;
