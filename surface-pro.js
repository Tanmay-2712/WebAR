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

        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
                if (supported) {
                    instructionText.innerText = "Advanced Spatial Tracking Loaded.";
                    controls.classList.remove('hidden');
                    arButton.addEventListener('click', () => this.startAR());
                } else {
                    instructionText.innerText = "WebXR Surface tracking not supported on this device.";
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

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.directionalLight.position.set(2, 4, 3);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.set(1024, 1024);
        this.scene.add(this.directionalLight);

        // Advanced Shadow Catcher
        const shadowGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.5 });
        this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowCatcher.receiveShadow = true;
        this.shadowCatcher.visible = false;
        this.scene.add(this.shadowCatcher);
    }

    createAdvancedReticle() {
        this.reticle = new THREE.Group();
        
        // Inner Ring
        const innerGeom = new THREE.RingGeometry(0.04, 0.05, 32).rotateX(-Math.PI / 2);
        const innerMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
        const inner = new THREE.Mesh(innerGeom, innerMat);
        
        // Outer Dotted Ring (Visual fluff for "high-tech" look)
        const outerGeom = new THREE.RingGeometry(0.07, 0.08, 32, 1, 0, Math.PI * 1.5).rotateX(-Math.PI / 2);
        const outerMat = new THREE.MeshBasicMaterial({ color: 0x7000ff, transparent: true, opacity: 0.5 });
        const outer = new THREE.Mesh(outerGeom, outerMat);
        
        this.reticle.add(inner);
        this.reticle.add(outer);
        
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);
        
        // Store for animation
        this.reticleOuter = outer;
    }

    async startAR() {
        const sessionInit = { 
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay', 'light-estimation'],
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
        document.getElementById('ar-status').classList.remove('hidden');
        
        session.addEventListener('select', () => this.placeObjectOnSurface());
        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    placeObjectOnSurface() {
        if (this.reticle.visible && !this.placedObject) {
            // Load Astronaut
            this.loader.load('https://modelviewer.dev/shared-assets/models/Astronaut.glb', (gltf) => {
                const model = gltf.scene;
                
                // Copy reticle position and rotation
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
                
                // Align shadow catcher permanently
                this.shadowCatcher.position.copy(model.position);
                this.shadowCatcher.visible = true;
                
                document.getElementById('hit-status').innerText = "Object Anchored Successfully.";
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
                    
                    // --- ARITHMETIC SMOOTHING ---
                    // Instead of jumps, we lerp the matrix components
                    this.targetMatrix.fromArray(hitPose.transform.matrix);
                    
                    // Simple smoothing (LERP) for position only for now to keep it responsive
                    if (!this.reticle.visible) {
                        this.currentMatrix.copy(this.targetMatrix);
                    } else {
                        // Blend current and target
                        const t = this.smoothingFactor;
                        for (let i = 0; i < 16; i++) {
                            this.currentMatrix.elements[i] = this.currentMatrix.elements[i] * (1 - t) + this.targetMatrix.elements[i] * t;
                        }
                    }

                    this.reticle.visible = true;
                    this.reticle.matrix.copy(this.currentMatrix);
                    
                    // Animate reticle
                    this.reticleOuter.rotation.y += 0.05;
                    
                    document.getElementById('hit-status').innerText = "Surface Locked - Tap to Anchor Model";
                } else {
                    this.reticle.visible = false;
                    document.getElementById('hit-status').innerText = "Hold Still... Detecting Surface";
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
