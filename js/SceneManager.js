import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

/**
 * Erweiterter SceneManager:
 * - Multi-Select mit unabhängigem Pivot (Position + Rotation + Scale)
 * - Pivot-Edit-Modus (P)
 * - Group Transform mit Undo/Redo
 * - Box-Selection kompatibel
 */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 1.6, 4);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(1.0);
    this.transformControls.addEventListener('dragging-changed', e => {
      this.controls.enabled = !e.value;
      if (e.value) {
        if (this.pivotEditMode) {
          // Drag start for pivot edit
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

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x394053, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);

    // Helpers
    const grid = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    this.scene.add(grid);

    this.axesHelper = new THREE.AxesHelper(1.5);
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

    // Pivot with independent orientation
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

    // Loaders / Exporter
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);
    this.exporter = new GLTFExporter();

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
      // Multi: pivot position = center; keep existing rotation unless first time
      const center = new THREE.Vector3();
      this.selectedObjects.forEach(o => center.add(o.position));
      center.multiplyScalar(1 / this.selectedObjects.length);
      if (!this.pivotEditMode && this._pivotDragStart == null) {
        // Nur bei erster Erstellung die Position setzen
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
      // Nach Ende bleibt Orientierung erhalten
      this.transformControls.attach(this._pivot);
    }
    return this.pivotEditMode;
  }

  /* ---------- Multi-Live Transform ---------- */
  _applyPivotLiveTransform() {
    if (!this._pivotStartState || !this._pivot || this.selectedObjects.length < 2 || this.pivotEditMode) return;
    const mode = this.transformControls.getMode();
    const pivotPrev = this._pivotStartState.position;
    const pivotCurrent = this._pivot.position.clone();
    const deltaPos = pivotCurrent.clone().sub(pivotPrev);

    if (mode === 'translate') {
      this.selectedObjects.forEach(o => o.position.add(deltaPos));
    } else if (mode === 'rotate') {
      // Relative rotation using pivot orientation delta
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
