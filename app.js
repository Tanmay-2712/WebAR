import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

class WebARApp {
    constructor() {
        this.container = null;
        this.renderer = null;
        this.camera = null;
        this.scene = null;
        this.reticle = null;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        this.lightProbeRequested = false;
        this.lightProbe = null;
        this.isARActive = false;
        this.placedObject = null;
        this.shadowCatcher = null;

        this.init();
    }

    async init() {
        this.setupUI();
        this.setupThree();
        this.createReticle();
        
        // Handle window resize
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    setupUI() {
        const arButton = document.getElementById('ar-button');
        const instructionText = document.getElementById('instruction-text');
        const controls = document.getElementById('controls');

        // Check for HTTPS
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            instructionText.innerHTML = "WebXR requires **HTTPS**. <br>Please use a secure connection.";
            return;
        }

        // Check if WebXR is supported
        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
                if (supported) {
                    instructionText.innerText = "Surface detection ready!";
                    controls.classList.remove('hidden');
                    arButton.addEventListener('click', () => this.startAR());
                } else {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                    if (isIOS) {
                        instructionText.innerHTML = "iOS detected. Please use the **WebXR Viewer** app or ensure you are in a WebXR-compatible browser.";
                    } else {
                        instructionText.innerText = "AR not supported. Ensure ARCore is installed and updated.";
                    }
                }
            }).catch(err => {
                instructionText.innerText = "Error checking AR support: " + err.message;
            });
        } else {
            instructionText.innerText = "WebXR not available. Use Chrome on Android or WebXR Viewer on iOS.";
        }
    }

    setupThree() {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        document.body.appendChild(this.renderer.domElement);

        // Lighting - Initial setup
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.directionalLight.position.set(10, 10, 10);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.set(1024, 1024);
        this.scene.add(this.directionalLight);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Shadow Catcher - Invisible plane that catches shadows
        const shadowGeo = new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.4 });
        this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowCatcher.receiveShadow = true;
        this.shadowCatcher.visible = false; // Only visible in AR when surface is hit
        this.scene.add(this.shadowCatcher);
    }

    createReticle() {
        // Advanced Reticle: A glowing ring for surface detection
        const geometry = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x00f2ff,
            transparent: true,
            opacity: 0.8
        });
        
        this.reticle = new THREE.Mesh(geometry, material);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        
        // Add a small center dot
        const dotGeom = new THREE.CircleGeometry(0.01, 32).rotateX(-Math.PI / 2);
        const dot = new THREE.Mesh(dotGeom, material);
        this.reticle.add(dot);
        
        this.scene.add(this.reticle);
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
            console.error('Failed to start AR session:', e);
            document.getElementById('instruction-text').innerText = "Failed to start AR session.";
        }
    }

    onSessionStarted(session) {
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);
        
        this.isARActive = true;
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('ar-status').classList.remove('hidden');
        
        // Listener to place object
        session.addEventListener('select', () => this.placeObject());

        // Handle session end
        session.addEventListener('end', () => {
            this.hitTestSourceRequested = false;
            this.hitTestSource = null;
            this.lightProbeRequested = false;
            this.lightProbe = null;
            this.isARActive = false;
            document.getElementById('instructions').classList.remove('hidden');
            document.getElementById('ar-status').classList.add('hidden');
        });

        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    placeObject() {
        if (this.reticle.visible) {
            // Create a high-quality 3D model (using a simple stylized sphere/gem for now)
            const geometry = new THREE.IcosahedronGeometry(0.1, 1);
            const material = new THREE.MeshStandardMaterial({ 
                color: 0x7000ff,
                metalness: 0.8,
                roughness: 0.2,
                emissive: 0x7000ff,
                emissiveIntensity: 0.2
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            // Set position and orientation from reticle
            this.reticle.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
            
            // Update shadow catcher position to match the ground
            this.shadowCatcher.position.copy(mesh.position);
            this.shadowCatcher.visible = true;
            
            // Add some "spawn" animation
            mesh.scale.set(0, 0, 0);
            this.scene.add(mesh);
            
            this.placedObject = mesh;
            
            // Very simple "pop" in animation
            let s = 0;
            const animateIn = () => {
                if (s < 1) {
                    s += 0.05;
                    mesh.scale.set(s, s, s);
                    requestAnimationFrame(animateIn);
                }
            };
            animateIn();
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

            if (!this.lightProbeRequested && session.requestLightProbe) {
                session.requestLightProbe().then((probe) => {
                    this.lightProbe = probe;
                });
                this.lightProbeRequested = true;
            }

            if (this.hitTestSource) {
                const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                if (hitTestResults.length) {
                    const hit = hitTestResults[0];
                    const pose = hit.getPose(referenceSpace);
                    this.reticle.visible = true;
                    this.reticle.matrix.fromArray(pose.transform.matrix);
                    document.getElementById('hit-status').innerText = "Surface Detected - Tap to Place";
                } else {
                    this.reticle.visible = false;
                    document.getElementById('hit-status').innerText = "Scanning Surface...";
                }
            }

            // --- Light Estimation ---
            if (this.lightProbe) {
                const lightEstimate = frame.getLightEstimate(this.lightProbe);
                if (lightEstimate) {
                    const intensity = Math.max(0.5, lightEstimate.primaryLightIntensity.x);
                    this.directionalLight.intensity = intensity;
                    this.directionalLight.color.setRGB(
                        lightEstimate.primaryLightColor.x,
                        lightEstimate.primaryLightColor.y,
                        lightEstimate.primaryLightColor.z
                    );
                    
                    if (lightEstimate.primaryLightDirection) {
                        this.directionalLight.position.copy(lightEstimate.primaryLightDirection).multiplyScalar(10);
                    }
                }
            }
        }

        // Random animation for placed object
        if (this.placedObject) {
            this.placedObject.rotation.y += 0.01;
            this.placedObject.position.y += Math.sin(time / 1000) * 0.0002;
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new WebARApp();
