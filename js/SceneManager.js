import * as THREE from 'three';

export class SceneManager {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth/canvas.clientHeight, 0.01, 200);
    this.camera.position.set(0,1.6,3);
    this.clock = new THREE.Clock();

    this.editableObjects = [];
    this.selectedObject = null;

    // Hooks (werden von app.js gesetzt)
    this.onSceneUpdate = () => {};
    this.onSelectionChange = () => {};
    this.onTransformChange = () => {};

    window.addEventListener('resize', ()=> this.handleResize());
    this.animate();
  }

  handleResize(){
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const W = w || window.innerWidth;
    const H = h || window.innerHeight;
    this.camera.aspect = W/H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W,H);
  }

  animate(){
    requestAnimationFrame(()=> this.animate());
    this.renderer.render(this.scene, this.camera);
  }

  // Neu: Objekt an Boden schnappen (minY → 0)
  snapObjectToFloor(obj){
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (!Number.isFinite(box.min.y)) return;
    if (Math.abs(box.min.y) < 1e-5) return; // Toleranz
    obj.position.y -= box.min.y;
  }

  // Neu: Alle bearbeitbaren Objekte schnappen
  snapAllToFloor(){
    for (const o of this.editableObjects){
      this.snapObjectToFloor(o);
    }
    this.onSceneUpdate();
  }

  // GLTF/GLB laden und automatisch auf Boden setzen
  async loadModel(url, name){
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(url, gltf => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root){
          reject(new Error('GLTF ohne Szene'));
          return;
        }
        root.name = name || 'Model';

        // Automatischer Boden-Snap direkt nach dem Laden
        this.snapObjectToFloor(root);

        this.scene.add(root);
        this.editableObjects.push(root);
        this.onSceneUpdate();
        resolve(root);
      }, undefined, err => reject(err));
    });
  }

  selectObject(obj){
    this.selectedObject = obj;
    this.onSelectionChange();
  }

  updateSelectedTransform(position, rotationDeg, scaleVal){
    const obj = this.selectedObject;
    if (!obj) return;

    if (Number.isFinite(position.x)) obj.position.x = position.x;
    if (Number.isFinite(position.y)) obj.position.y = position.y;
    if (Number.isFinite(position.z)) obj.position.z = position.z;

    if (Number.isFinite(rotationDeg.x)) obj.rotation.x = THREE.MathUtils.degToRad(rotationDeg.x);
    if (Number.isFinite(rotationDeg.y)) obj.rotation.y = THREE.MathUtils.degToRad(rotationDeg.y);
    if (Number.isFinite(rotationDeg.z)) obj.rotation.z = THREE.MathUtils.degToRad(rotationDeg.z);

    if (Number.isFinite(scaleVal)) obj.scale.set(scaleVal, scaleVal, scaleVal);

    this.onTransformChange();
  }

  setAudioConfig(cfg){
    this.audioConfig = { ...cfg };
  }

  getSceneConfig(){
    return {
      objects: this.editableObjects.map(o => ({
        name: o.name,
        position: [o.position.x, o.position.y, o.position.z],
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
        scale: o.scale.x,
        linkUrl: o.userData?.linkUrl || null
      })),
      audio: this.audioConfig || null
    };
  }
}
