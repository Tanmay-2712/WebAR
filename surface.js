import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class WebARMaster {
    constructor() {
        this.renderer = null;
        this.camera = null;
        this.scene = null;
        this.reticle = null;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        
        // --- High-Precision Smoothing Properties ---
        this.smoothingFactor = 0.12; // Lower = ultra smooth, higher = more responsive
        this.tempMatrix = new THREE.Matrix4();
        this.currentMatrix = new THREE.Matrix4();
        this.isReticleLocalized = false;

        this.placedObject = null;
        this.shadowCatcher = null;
        this.loader = new GLTFLoader();

        this.init();
    }

    async init() {
        this.checkCompatibility();
        this.setupThree();
        this.createMasterReticle();
        
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    async checkCompatibility() {
        const instructionText = document.getElementById('instruction-text');
        const startBtn = document.getElementById('start-ar');
        const fallbackViewer = document.getElementById('fallback-viewer');

        if (navigator.xr) {
            try {
                const supported = await navigator.xr.isSessionSupported('immersive-ar');
                if (supported) {
                    instructionText.innerText = "High-Precision Engine Standby.";
                    startBtn.classList.remove('hidden');
                    startBtn.addEventListener('click', () => this.startHighPrecisionAR());
                    document.querySelector('.loader-ring').style.display = 'none';
                } else {
                    this.switchToFallback("ARCore/WebXR not supported. Using Universal View.");
                }
            } catch (e) {
                this.switchToFallback("Secure context required for High-Precision AR.");
            }
        } else {
            this.switchToFallback("Browser doesn't support WebXR. Using Universal View.");
        }
    }

    switchToFallback(msg) {
        document.getElementById('instruction-text').innerText = msg;
        document.querySelector('.loader-ring').classList.add('hidden');
        document.getElementById('fallback-viewer').classList.remove('hidden');
        document.getElementById('overlay').style.background = 'rgba(0,0,0,0.3)';
    }

    setupThree() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        
        // High-Quality Shadows
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Lighting System
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        this.sunlight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.sunlight.position.set(5, 10, 7);
        this.sunlight.castShadow = true;
        this.sunlight.shadow.mapSize.set(2048, 2048); // High-res shadows
        this.sunlight.shadow.camera.near = 0.1;
        this.sunlight.shadow.camera.far = 20;
        this.scene.add(this.sunlight);

        // Advanced Shadow Catcher (Ground)
        const shadowGeo = new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.4 });
        this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowCatcher.receiveShadow = true;
        this.shadowCatcher.visible = false;
        this.scene.add(this.shadowCatcher);
    }

    createMasterReticle() {
        this.reticle = new THREE.Group();
        
        // Inner Glow Circle
        const innerGeom = new THREE.RingGeometry(0.045, 0.05, 32).rotateX(-Math.PI / 2);
        const innerMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
        const inner = new THREE.Mesh(innerGeom, innerMat);
        
        // Outer Pulsing Ring
        const outerGeom = new THREE.RingGeometry(0.07, 0.08, 64).rotateX(-Math.PI / 2);
        const outerMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.3 });
        this.reticleOuter = new THREE.Mesh(outerGeom, outerMat);
        
        this.reticle.add(inner);
        this.reticle.add(this.reticleOuter);
        
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);
    }

    async startHighPrecisionAR() {
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
            this.switchToFallback("Session access denied.");
        }
    }

    onSessionStarted(session) {
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);
        
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('status-bar').classList.remove('hidden');
        
        session.addEventListener('select', () => this.placeMasterObject());

        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    placeMasterObject() {
        if (this.reticle.visible && !this.placedObject) {
            document.getElementById('tracking-status').innerText = "Streaming Asset Data...";
            
            // Loading the Astronaut model
            this.loader.load('https://modelviewer.dev/shared-assets/models/Astronaut.glb', (gltf) => {
                const model = gltf.scene;
                
                // Set position and rotation exactly at reticle
                this.reticle.matrix.decompose(model.position, model.quaternion, model.scale);
                model.scale.set(0.12, 0.12, 0.12);
                
                model.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                        // Boost materials for premium look
                        if (node.material) {
                            node.material.metalness = 0.9;
                            node.material.roughness = 0.1;
                        }
                    }
                });

                this.scene.add(model);
                this.placedObject = model;
                
                // Anchor shadows
                this.shadowCatcher.position.copy(model.position);
                this.shadowCatcher.visible = true;
                
                document.getElementById('tracking-status').innerText = "SPATIAL ANCHOR LOCKED";
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
                    
                    // --- THE SMOOTHING CORE ---
                    this.tempMatrix.fromArray(hitPose.transform.matrix);
                    
                    if (!this.isReticleLocalized) {
                        this.currentMatrix.copy(this.tempMatrix);
                        this.isReticleLocalized = true;
                    } else {
                        // Exponential Moving Average Interpolation (EMA)
                        const lerp = this.smoothingFactor;
                        for (let i = 0; i < 16; i++) {
                            this.currentMatrix.elements[i] = 
                                this.currentMatrix.elements[i] * (1 - lerp) + 
                                this.tempMatrix.elements[i] * lerp;
                        }
                    }

                    this.reticle.visible = true;
                    this.reticle.matrix.copy(this.currentMatrix);
                    
                    // Subtle animations for high-tech feel
                    this.reticleOuter.scale.setScalar(1 + Math.sin(time * 0.005) * 0.1);
                    this.reticleOuter.rotation.y += 0.02;
                    
                    document.getElementById('tracking-status').innerText = "SURFACE IDENTIFIED";
                } else {
                    this.reticle.visible = false;
                    document.getElementById('tracking-status').innerText = "SCANNIG TOPOLOGY...";
                }
            }
        }

        if (this.placedObject) {
            // Gentle idle animation
            this.placedObject.rotation.y += 0.004;
            this.placedObject.position.y += Math.sin(time * 0.002) * 0.0001; 
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new WebARMaster();
