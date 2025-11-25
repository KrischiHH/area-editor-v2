import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SceneManager {
  constructor(canvas){
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
    this.selectedObject = null;

    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    this.audioConfig = null;

    this.init();
    this.animate();
  }

  setAudioConfig(cfg){
    this.audioConfig = cfg ? { ...cfg } : null;
  }

  init(){
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b23);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7.5);
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
  }

  loadModel(url, assetName){
    this.loader.load(url, gltf => {
      const model = gltf.scene;
      model.userData.assetUrl = assetName;
      model.userData.isEditable = true;
      model.name = assetName;

      // Auto-Center / Boden
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.y -= center.y - (size.y / 2);

      if (gltf.animations && gltf.animations.length){
        const mixer = new THREE.AnimationMixer(model);
        this.mixers.push(mixer);
        mixer.clipAction(gltf.animations[0]).play();
      }

      this.scene.add(model);
      this.editableObjects.push(model);
      this.onSceneUpdate();
      this.selectObject(model);
      URL.revokeObjectURL(url);
    }, undefined, err => console.error(err));
  }

  selectObject(object){
    this.selectedObject = object;
    if (object && this.editableObjects.includes(object)){
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

    const clickableNodes = this.editableObjects
      .filter(o => o.userData.linkUrl && o.userData.linkUrl.trim())
      .map(o => ({
        url: o.userData.linkUrl.trim(),
        position: o.position.toArray().map(v => +v.toFixed(4)),
        label: o.name || ''
      }));

    const audio = (this.audioConfig && this.audioConfig.url)
      ? {
          url: this.audioConfig.url,
          loop: !!this.audioConfig.loop,
          delaySeconds: this.audioConfig.delaySeconds || 0,
          volume: Math.min(1, Math.max(0, this.audioConfig.volume ?? 0.8))
        }
      : undefined;

    return {
      meta: { title: 'ARea Scene V2', createdAt: new Date().toISOString() },
      model: main ? { url: main.url } : undefined,
      audio,
      clickableNodes,
      assets
    };
  }
}
