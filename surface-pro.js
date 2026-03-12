import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class AdvancedWebAR {
    constructor() {
        this.renderer = null;
        this.camera = null;
        this.scene = null;
        this.reticle = null;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        
        // Smoothing properties
        this.targetMatrix = new THREE.Matrix4();
        this.currentMatrix = new THREE.Matrix4();
        this.smoothingFactor = 0.15; // Lower = smoother, higher = snappier
        
        this.placedObject = null;
        this.shadowCatcher = null;
        this.loader = new GLTFLoader();

        this.init();
    }

    async init() {
        this.setupUI();
        this.setupThree();
        this.createAdvancedReticle();
        
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    setupUI() {
        const arButton = document.getElementById('ar-button');
        const instructionText = document.getElementById('instruction-text');
        const controls = document.getElementById('controls');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
                if (supported) {
                    statusText.innerText = "READY";
                    statusDot.classList.add('active');
                    controls.classList.remove('hidden');
                    arButton.addEventListener('click', () => this.startAR());
                } else {
                    statusText.innerText = "UNSUPPORTED";
                    instructionText.innerText = "WEBXR NOT FOUND";
                }
            });
        }
    }

    setupThree() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.directionalLight.position.set(2, 4, 3);
        this.directionalLight.castShadow = true;
        this.scene.add(this.directionalLight);

        const shadowGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.3 });
        this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowCatcher.receiveShadow = true;
        this.shadowCatcher.visible = false;
        this.scene.add(this.shadowCatcher);
    }

    createAdvancedReticle() {
        this.reticle = new THREE.Group();
        
        // Minimal Single Ring
        const innerGeom = new THREE.RingGeometry(0.045, 0.05, 64).rotateX(-Math.PI / 2);
        const innerMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff, opacity: 0.5, transparent: true });
        const inner = new THREE.Mesh(innerGeom, innerMat);
        
        this.reticle.add(inner);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);
    }

    async startAR() {
        const sessionInit = { 
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('overlay') }
        };

        try {
            const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
            this.onSessionStarted(session);
        } catch (e) {
            console.error(e);
        }
    }

    onSessionStarted(session) {
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);
        
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('controls').classList.add('hidden');
        document.getElementById('ar-status').classList.remove('hidden');
        document.getElementById('status-text').innerText = "CALIBRATING";
        
        session.addEventListener('select', () => this.placeObjectOnSurface());
        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    placeObjectOnSurface() {
        if (this.reticle.visible && !this.placedObject) {
            this.loader.load('https://modelviewer.dev/shared-assets/models/Astronaut.glb', (gltf) => {
                const model = gltf.scene;
                this.reticle.matrix.decompose(model.position, model.quaternion, model.scale);
                model.scale.set(0.1, 0.1, 0.1);
                
                model.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                this.scene.add(model);
                this.placedObject = model;
                this.shadowCatcher.position.copy(model.position);
                this.shadowCatcher.visible = true;
                
                document.getElementById('hit-status').innerText = "ANCHORED";
                document.getElementById('status-text').innerText = "STABLE";
            });
        }
    }

    render(time, frame) {
        if (frame) {
            const referenceSpace = this.renderer.xr.getReferenceSpace();
            const session = frame.session;

            if (!this.hitTestSourceRequested) {
                session.requestReferenceSpace('viewer').then((viewerSpace) => {
                    session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                        this.hitTestSource = source;
                    });
                });
                this.hitTestSourceRequested = true;
            }

            if (this.hitTestSource) {
                const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                if (hitTestResults.length) {
                    const hit = hitTestResults[0];
                    const hitPose = hit.getPose(referenceSpace);
                    
                    this.targetMatrix.fromArray(hitPose.transform.matrix);
                    
                    if (!this.reticle.visible) {
                        this.currentMatrix.copy(this.targetMatrix);
                    } else {
                        const t = this.smoothingFactor;
                        for (let i = 0; i < 16; i++) {
                            this.currentMatrix.elements[i] = this.currentMatrix.elements[i] * (1 - t) + this.targetMatrix.elements[i] * t;
                        }
                    }

                    this.reticle.visible = true;
                    this.reticle.matrix.copy(this.currentMatrix);
                    
                    document.getElementById('hit-status').innerText = "TAP TO PLACE";
                    document.getElementById('status-text').innerText = "LOCKED";
                } else {
                    this.reticle.visible = false;
                    document.getElementById('hit-status').innerText = "FINDING SURFACE";
                    document.getElementById('status-text').innerText = "SCANNING";
                }
            }
        }

        if (this.placedObject) {
            this.placedObject.rotation.y += 0.005;
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new AdvancedWebAR();
