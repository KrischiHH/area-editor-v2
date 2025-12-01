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

    this.scene = new THREE.Scene();
    // Hintergrundfarbe für den Editor (dunkles Grau/Blau)
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    this.camera.position.set(0, 1.6, 6);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    // Wichtig für PBR-Materialien und realistische Darstellung
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.8; // Leicht erhöhte Belichtung
    this.renderer.shadowMap.enabled = false;
    this.renderer.physicallyCorrectLights = true; // Empfohlen für moderne Beleuchtung

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 250;
    this.controls.minPolarAngle = 0.0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();

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
              this._pushCommand({ type: 'groupPivotChange', prev: this._pivotDragStart, next: end });
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
            this._pushCommand({ type: 'groupTransform', mode, items });
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

    this.currentLightProfile = 'aero-simple';
    this._lights = [];
    this.pmremGenerator = new PMREMGenerator(this.renderer); // PMREMGenerator einmal erstellen
    this.roomEnvironment = new RoomEnvironment(this.renderer);
    this._applyLightingProfile(this.currentLightProfile);

    const grid = new THREE.GridHelper(50, 50, 0x9aa4af, 0x49525b);
    grid.material.opacity = 0.9;
    grid.material.transparent = true;
    this.scene.add(grid);

    this.axesHelper = new THREE.AxesHelper(1.3);
    this.axesHelper.visible = false;
    this.scene.add(this.axesHelper);

    this.editableObjects = [];
    this.selectedObjects = [];
    this.audioConfig = null;
    this.modelAnimationMap = new Map();
    this._mixers = [];
    this._clock = new THREE.Clock();
    this._outlineEnabled = true;

    this._pivot = new THREE.Object3D();
    this._pivot.name = '_SelectionPivot';
    this.scene.add(this._pivot);
    this.pivotEditMode = false;
    this._pivotDragStart = null;

    this.undoStack = [];
    this.redoStack = [];
    this._groupTransformStartStates = null;
    this._pivotStartState = null;

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    this.loader.setDRACOLoader(dracoLoader);
    this.exporter = new GLTFExporter();

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

    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    this._basicPreview = false;

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

  /* ---------- Helper / New Methods ---------- */
  setExposure(v){
    this.renderer.toneMappingExposure = Math.max(0.1, Math.min(5, v));
  }

  setLightIntensities({ ambient, key, fill }){
    if (!this._lights || this._lights.length === 0) return;
    this._lights.forEach(l => {
      if (l.isAmbientLight && ambient !== undefined) l.intensity = ambient;
      if (l.isDirectionalLight) {
        if (key !== undefined && l.userData.role === 'key') l.intensity = key;
        if (fill !== undefined && l.userData.role === 'fill') l.intensity = fill;
      }
    });
  }

  enableEnvironment(flag){
    if (flag){
      // Verwenden der bereits erstellten Instanzen
      const env = this.pmremGenerator.fromScene(this.roomEnvironment, 0.02);
      this.scene.environment = env.texture;
    } else {
      this.scene.environment = null;
    }
  }

  previewBasicMode(flag){
    if (flag === this._basicPreview) return;
    this._basicPreview = flag;
    this.editableObjects.forEach(root => {
      root.traverse(o => {
        if (o.isMesh) {
          if (flag){
            if (!o.userData._origMaterial) o.userData._origMaterial = o.material;
            o.material = new THREE.MeshBasicMaterial({ map: o.userData._origMaterial.map, color: o.userData._origMaterial.color });
          } else {
            if (o.userData._origMaterial) {
              o.material = o.userData._origMaterial;
              delete o.userData._origMaterial;
            }
          }
        }
      });
    });
  }

  autoBrightenSelected(faktor=0.3){
    this.selectedObjects.forEach(obj => {
      obj.traverse(o=>{
        if (o.isMesh && o.material && o.material.color){
          const c = o.material.color;
          const lum = (c.r + c.g + c.b)/3;
            const target = lum + faktor;
          const scale = target / (lum || 0.001);
          c.multiplyScalar(scale);
          o.material.needsUpdate = true;
        }
      });
    });
    this.onSceneUpdate?.();
  }

  disableVertexColorsInSelected(){
    this.selectedObjects.forEach(obj=>{
      obj.traverse(o=>{
        if (o.isMesh && o.material && o.material.vertexColors){
          o.material.vertexColors = false;
          o.material.needsUpdate = true;
        }
      });
    });
    this.onSceneUpdate?.();
  }

  _clearLights() {
    this._lights.forEach(l => this.scene.remove(l));
    this._lights = [];
  }

  _applyLightingProfile(profile) {
    this._clearLights();
    // NEU: PBR-freundlicher Standard, ähnlich wie Viewer-Neutral/Aero
    if (profile === 'aero-simple') {
      // 1. IBL-Umgebung für weiches Licht (Der "Aero" Look)
      this.enableEnvironment(true);
      // 2. Nur ein kräftiges DirectionalLight als Key Light
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 6, 4);
      key.userData.role = 'key';
      this.scene.add(key);
      this._lights.push(key);
      this.renderer.toneMappingExposure = 1.8; // Helle Exposition
      // Hintergrund bleibt auf Color (0x0d1117)

    } else if (profile === 'viewer-neutral-env') {
      this.enableEnvironment(true);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f48, 0.9); hemi.userData.role='hemi';
      const ambient = new THREE.AmbientLight(0xffffff, 0.45); ambient.userData.role='ambient';
      this.scene.add(hemi, ambient);
      this._lights.push(hemi, ambient);
      this.renderer.toneMappingExposure = 1.4;

    } else if (profile === 'bright') {
      this.enableEnvironment(false); // Kein IBL
      const ambient = new THREE.AmbientLight(0xffffff, 1.0); ambient.userData.role='ambient';
      const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(6,9,4); key.userData.role='key';
      const fill = new THREE.DirectionalLight(0xeaf1ff, 1.2); fill.position.set(-6,5,-4); fill.userData.role='fill';
      this.scene.add(ambient, key, fill);
      this._lights.push(ambient, key, fill);
      this.renderer.toneMappingExposure = 1.7;

    } else if (profile === 'studio') {
      this.enableEnvironment(false); // Kein IBL
      const hemi = new THREE.HemisphereLight(0xffffff, 0x24303a, 1.05); hemi.userData.role='hemi';
      const key = new THREE.DirectionalLight(0xffffff, 1.55); key.position.set(5,7,4); key.userData.role='key';
      const fill = new THREE.DirectionalLight(0xdfe7f5, 0.85); fill.position.set(-6,4,-3); fill.userData.role='fill';
      const ambient = new THREE.AmbientLight(0xffffff, 0.5); ambient.userData.role='ambient';
      this.scene.add(hemi, key, fill, ambient);
      this._lights.push(hemi, key, fill, ambient);
      this.renderer.toneMappingExposure = 1.5;
    }
    this.currentLightProfile = profile;
    this.renderer.render(this.scene, this.camera); // Sofortiges Rendern nach Lichtwechsel
  }

  cycleLightProfile() {
    const order = ['aero-simple', 'viewer-neutral-env', 'studio', 'bright'];
    const next = order[(order.indexOf(this.currentLightProfile) + 1) % order.length];
    this._applyLightingProfile(next);
    return next;
  }

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

  loadModel(url, nameHint) {
    this.loader.load(
      url,
      gltf => {
        const root = gltf.scene;
        root.traverse(o => { o.userData.isEditable = true; });
        root.traverse(o => {
          // Korrektur von Schwarz (0x000000) zu einem dunklen Grau, falls nötig
          if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0x000000) {
            o.material.color.setHex(0x2a313a);
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
        // NEU: Dateiname für getSceneConfig() merken
        this.currentModelFileName = nameHint || this.currentModelFileName || 'scene.glb';

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
    this.transformControls.attach(this._pivot);
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
    // Mixer-Cleanup
    this._mixers = this._mixers.filter(m => {
      const root = m.getRoot?.() || m._root || m._rootObject;
      if (root && toDelete.includes(root)) {
        try { m.stopAllAction?.(); } catch(_) {}
        return false;
      }
      return true;
    });
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
}
