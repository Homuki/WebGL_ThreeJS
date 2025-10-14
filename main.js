// =========================================================================
// GLOBALNE ZARZĄDZANIE STANEM I STAŁE
// =========================================================================
let currentScene = null;
let currentRenderer = null;
let currentControls = null;
let currentAnimationId = null;
const clock = new THREE.Clock();
let gui = null; // Globalny interfejs dat.GUI

// Definicje shaderów dla Sceny 1 (Custom Shader)
const vertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
        vUv = uv;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const fragmentShader = `
    uniform float u_time;
    uniform vec3 u_color;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
        float intensity = 0.5 + 0.5 * sin(vNormal.y * 10.0 + u_time * 2.0);
        vec3 finalColor = u_color * intensity;
        float edge = smoothstep(0.9, 1.0, 1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)));
        gl_FragColor = vec4(finalColor + edge * 0.5, 1.0);
    }
`;

// Definicje shaderów dla Sceny 4 (Ocean)
const oceanVertexShader = `
    uniform float u_time;
    uniform float u_amplitude;
    uniform float u_frequency;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vWaveIntensity;

    void main() {
        vPosition = position;
        vNormal = normal;

        // Fale (uproszczona sinusoida)
        float wave = u_amplitude * sin(u_frequency * position.x + u_time * 0.8 + u_frequency * position.z);
        
        vec3 newPosition = position;
        newPosition.y += wave * 0.5; // Deformacja w górę

        vWaveIntensity = wave * 0.1; 

        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
`;

const oceanFragmentShader = `
    uniform float u_time;
    uniform vec3 u_deepColor;
    uniform vec3 u_surfaceColor;
    uniform vec3 u_lightDir;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vWaveIntensity;

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(u_lightDir);
        
        // Model oświetlenia (Diffuse)
        float light = max(dot(normal, lightDir), 0.0);
        
        // Kolor: Głębia + Fale
        float depthFactor = smoothstep(-15.0, 15.0, vPosition.z);
        vec3 color = mix(u_surfaceColor, u_deepColor, depthFactor);
        
        color += light * 0.5;
        color += vWaveIntensity * 0.3;

        // Efekt Fresnela (odbicie)
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
        color = mix(color, vec3(0.5, 0.7, 1.0), fresnel * 0.5); 

        gl_FragColor = vec4(color, 1.0);
    }
`;

// =========================================================================
// FUNKCJE POMOCNICZE I CZYSZCZĄCE
// =========================================================================

function cleanupScene() {
    if (currentAnimationId) {
        cancelAnimationFrame(currentAnimationId);
    }
    if (currentRenderer) {
        currentRenderer.dispose();
        const container = document.getElementById('webgl-container');
        if (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }
    // Czyszczenie Web Audio API
    if (currentScene && currentScene.audioContext && currentScene.audioContext.state !== 'closed') {
        currentScene.audioContext.close();
    }
    if (currentScene && currentScene.audioStream) {
        currentScene.audioStream.getTracks().forEach(track => track.stop());
    }
    // Czyszczenie dat.GUI
    if (gui) {
        gui.destroy();
        gui = null;
        const guiContainer = document.querySelector('.dg.main');
        if (guiContainer) {
            guiContainer.remove();
        }
    }
    
    currentScene = null;
    currentRenderer = null;
    currentControls = null;
    currentAnimationId = null;
    window.removeEventListener('resize', onWindowResize);
}

function onWindowResize() {
    if (currentRenderer && currentScene && currentScene.camera) {
        currentScene.camera.aspect = window.innerWidth / window.innerHeight;
        currentScene.camera.updateProjectionMatrix();
        currentRenderer.setSize(window.innerWidth, window.innerHeight);
        if (currentScene.composer) {
            currentScene.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }
}

function setupRenderer(useShadows = false, useToneMapping = false) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    if (useShadows) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    if (useToneMapping) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
    }

    document.getElementById('webgl-container').appendChild(renderer.domElement);
    currentRenderer = renderer;
    document.getElementById('webgl-container').style.opacity = 1; 
    document.getElementById('menu-overlay').classList.add('hidden'); 
    
    // Upewnienie się, że przycisk powrotu jest widoczny i poprawnie zainicjowany
    let returnButton = document.getElementById('return-btn');
    if (!returnButton) {
        returnButton = document.createElement('button');
        returnButton.innerText = 'Wróć do Menu';
        returnButton.id = 'return-btn';
        returnButton.style.cssText = `
            position: fixed; top: 10px; right: 10px; padding: 10px; 
            z-index: 101; background: rgba(0,0,0,0.5); 
            color: #00ffff; border: 1px solid #00ffff; 
            border-radius: 5px; cursor: pointer; display: none;
        `;
        document.body.appendChild(returnButton);
        
        returnButton.addEventListener('click', () => {
            cleanupScene();
            document.getElementById('webgl-container').style.opacity = 0;
            document.getElementById('menu-overlay').classList.remove('hidden');
            returnButton.style.display = 'none';
        });
    }

    document.getElementById('return-btn').style.display = 'block'; 
    window.addEventListener('resize', onWindowResize, false);
    return renderer;
}

// =========================================================================
// SCENA 1: NIESTANDARDOWY SHADER (GLSL)
// =========================================================================

function initCustomShaderScene() {
    cleanupScene();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;
    scene.camera = camera; 

    const renderer = setupRenderer();
    
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; 
    currentControls = controls;

    const geometry = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            u_time: { value: 0.0 },
            u_color: { value: new THREE.Color(0x00ffff) }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    scene.mesh = mesh;
    scene.material = material; 

    currentScene = scene;

    function animateShader() {
        currentAnimationId = requestAnimationFrame(animateShader);
        
        const elapsedTime = clock.getElapsedTime();
        scene.material.uniforms.u_time.value = elapsedTime;
        scene.mesh.rotation.x = elapsedTime * 0.1;
        scene.mesh.rotation.y = elapsedTime * 0.15;
        
        currentControls.update();
        currentRenderer.render(scene, camera);
    }

    animateShader();
}

// =========================================================================
// SCENA 2: PULSAR AUDIO (Domyślny Mikrofon Systemowy)
// =========================================================================

async function initAudioVisualizerScene() {
    cleanupScene();
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Twoja przeglądarka nie wspiera Web Audio API lub dostępu do mikrofonu.");
        return initCustomShaderScene();
    }
    
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        alert(`Błąd dostępu do mikrofonu (Kod: ${err.name}). Upewnij się, że zezwoliłeś na dostęp.`);
        return initCustomShaderScene();
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    source.connect(analyser);
    
    analyser.fftSize = 512; 
    analyser.minDecibels = -95; 
    analyser.maxDecibels = -5;  
    analyser.smoothingTimeConstant = 0.6; 
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // --- Konfiguracja Sceny Three.js ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); 
    scene.audioContext = audioContext; 
    scene.audioStream = stream; 

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;
    scene.camera = camera; 
    const initialCameraZ = camera.position.z; 

    const renderer = setupRenderer();
    renderer.setClearColor(0x000000); 

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    currentControls = controls;

    const geometry = new THREE.PlaneGeometry(20, 20, 64, 64); 
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; 
    scene.add(mesh);
    scene.mesh = mesh;
    
    const initialPositions = geometry.attributes.position.array.slice(0); 
    
    // Post-Processing: Efekt Poświaty (Bloom Effect)
    const composer = new THREE.EffectComposer(renderer);
    const renderPass = new THREE.RenderPass(scene, camera);
    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.0, 0.0, 0.0
    );
    bloomPass.threshold = 0.0;
    bloomPass.strength = 1.5; 
    bloomPass.radius = 1.0;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);


    currentScene = scene;
    scene.composer = composer; 
    
    // --- Pętla Animacji Wizualizera ---
    function animateAudioVisualizer() {
        currentAnimationId = requestAnimationFrame(animateAudioVisualizer);

        analyser.getByteFrequencyData(dataArray);

        const bassData = dataArray.slice(0, 16);
        const averageAmplitude = bassData.reduce((a, b) => a + b) / (bassData.length * 255.0);
        
        // Dynamiczna Kamera (Dolly/Zoom)
        camera.position.z = initialCameraZ - averageAmplitude * 1.5; 
        
        // Deformacja Geometrii
        const positions = geometry.attributes.position.array;
        
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const dataIndex = Math.floor(i % bufferLength); 
            const amplitude = dataArray[dataIndex] / 255.0; 
            
            const deformationFactor = amplitude * 2.5; 
            
            positions[i * 3 + 1] = initialPositions[i * 3 + 1] + deformationFactor * Math.sin(positions[i * 3 + 0] * 0.5 + clock.getElapsedTime() * 2.5); 
        }
        
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals(); 
        
        mesh.rotation.z += 0.002; 

        // Zmiana koloru i poświaty
        const totalVolume = dataArray.reduce((a, b) => a + b) / (bufferLength * 255);
        const colorHue = 0.5 + totalVolume * 0.4;
        material.color.setHSL(colorHue, 1.0, 0.7); 
        
        bloomPass.strength = 1.5 + totalVolume * 3.0; 
        
        currentControls.update();
        scene.composer.render(); 
    }

    animateAudioVisualizer();

    window.removeEventListener('resize', onWindowResize);
    window.addEventListener('resize', onWindowResize, false);
}


// =========================================================================
// SCENA 3: INTERAKTYWNY SYSTEM PLANETARNY (Orbital Simulator)
// =========================================================================

class Body extends THREE.Mesh {
    constructor(mass, radius, color, position, velocity) {
        super(
            new THREE.SphereGeometry(radius, 32, 32),
            new THREE.MeshBasicMaterial({ color: color, emissive: color, emissiveIntensity: (mass > 100 ? 2 : 1) })
        );
        this.mass = mass;
        this.radius = radius;
        this.position.set(position.x, position.y, position.z);
        this.velocity = velocity;
        this.acceleration = new THREE.Vector3(0, 0, 0);
        this.isDraggable = (mass < 100); 
    }
}

function initPlanetaryScene() {
    cleanupScene();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000005);
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 50, 50);
    scene.camera = camera; 

    const renderer = setupRenderer();
    renderer.setClearColor(0x000005);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; 
    currentControls = controls;

    const G = 50; 
    const timeStep = 0.01;

    const sun = new Body(
        1000, 5, 0xffaa00, 
        new THREE.Vector3(0, 0, 0), 
        new THREE.Vector3(0, 0, 0)
    );
    scene.add(sun);

    const planets = [
        new Body(5, 1.5, 0x00aaff, new THREE.Vector3(25, 0, 0), new THREE.Vector3(0, 0, -4.5)),
        new Body(10, 2.5, 0xff00aa, new THREE.Vector3(-40, 0, 0), new THREE.Vector3(0, 0, 3.5))
    ];

    planets.forEach(p => scene.add(p));
    const allBodies = [sun, ...planets];
    scene.bodies = allBodies;

    // Post-Processing: Bloom Effect
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 
        1.5, 0.4, 0.85
    );
    composer.addPass(bloomPass);
    scene.composer = composer;

    // Interaktywność: dat.GUI (PRZENIESIONE DO PRAWEGO DOLNEGO ROGU)
    gui = new dat.GUI({ autoPlace: false });
    gui.domElement.style.position = 'absolute';
    gui.domElement.style.bottom = '0px'; 
    gui.domElement.style.right = '0px'; 
    document.body.appendChild(gui.domElement);
    
    const settings = { G: G, sunMass: sun.mass };
    
    gui.add(settings, 'G', 1, 100).name('Stała Grawitacji (G)').onChange(val => { sun.G = val; });
    gui.add(settings, 'sunMass', 100, 5000).name('Masa Słońca').onChange(val => { sun.mass = val; });

    planets.forEach((p, index) => {
        gui.add(p, 'mass', 1, 50).name(`Planeta ${index + 1} Masa`);
    });

    // Raycaster dla interaktywności
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;
    let draggedBody = null;

    function onMouseInteraction(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
    }
    
    function onMouseDown(event) {
        onMouseInteraction(event);
        const intersects = raycaster.intersectObjects(planets);

        if (intersects.length > 0) {
            draggedBody = intersects[0].object;
            isDragging = true;
            controls.enabled = false;
        }
    }

    function onMouseMove(event) {
        onMouseInteraction(event);
        if (!isDragging || !draggedBody) return;

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersection);
        draggedBody.position.copy(intersection);
    }

    function onMouseUp() {
        if (draggedBody) {
            // Po zwolnieniu: losowa prędkość, by zacząć nową orbitę
            draggedBody.velocity = new THREE.Vector3(
                THREE.MathUtils.randFloatSpread(1), 
                0, 
                THREE.MathUtils.randFloatSpread(1)
            ).multiplyScalar(5); 
        }
        isDragging = false;
        draggedBody = null;
        controls.enabled = true; 
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onMouseUp, false);


    currentScene = scene;

    function animatePlanetary() {
        currentAnimationId = requestAnimationFrame(animatePlanetary);

        // Symulacja N-ciał
        for (let i = 0; i < allBodies.length; i++) {
            const bodyA = allBodies[i];
            
            if (bodyA === sun) continue; 
            
            bodyA.acceleration.set(0, 0, 0);

            for (let j = 0; j < allBodies.length; j++) {
                if (i === j) continue;
                const bodyB = allBodies[j];

                const direction = new THREE.Vector3().subVectors(bodyB.position, bodyA.position);
                const distanceSq = direction.lengthSq();
                
                if (distanceSq < 1.0) continue; 
                
                let strength = (settings.G * bodyA.mass * bodyB.mass) / distanceSq;
                strength = Math.min(strength, 100); 

                direction.normalize().multiplyScalar(strength / bodyA.mass);
                bodyA.acceleration.add(direction);
            }

            // Integracja
            bodyA.velocity.add(bodyA.acceleration.clone().multiplyScalar(timeStep));
            bodyA.position.add(bodyA.velocity.clone().multiplyScalar(timeStep));
        }

        currentControls.update();
        scene.composer.render();
    }

    animatePlanetary();
}


// =========================================================================
// SCENA 4: INTERAKTYWNY OCEAN Z FALAMI I ŚWIATŁEM
// =========================================================================

function initOceanScene() {
    cleanupScene();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000033);
    
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2000);
    camera.position.set(0, 5, 20);
    scene.camera = camera; 

    const renderer = setupRenderer();

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    currentControls = controls;

    // Światło (słońce)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(20, 50, 20);
    scene.add(sunLight);
    scene.sunLight = sunLight;
    
    // Obiekt Wody
    const waterGeometry = new THREE.PlaneGeometry(100, 100, 256, 256);
    
    const waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
            u_time: { value: 0.0 },
            u_amplitude: { value: 1.0 }, // Wzmocniona domyślna amplituda
            u_frequency: { value: 0.6 }, // Wzmocniona domyślna częstotliwość
            u_deepColor: { value: new THREE.Color(0x000055) },
            u_surfaceColor: { value: new THREE.Color(0x00aaff) },
            u_lightDir: { value: sunLight.position.clone().normalize() } 
        },
        vertexShader: oceanVertexShader,
        fragmentShader: oceanFragmentShader,
        side: THREE.DoubleSide
    });
    
    const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    waterMesh.rotation.x = -Math.PI / 2;
    scene.add(waterMesh);
    scene.waterMaterial = waterMaterial;

    // Interaktywność: dat.GUI (PRZENIESIONE DO PRAWEGO DOLNEGO ROGU Z ODSTĘPEM 100PX)
    gui = new dat.GUI({ autoPlace: false });
    gui.domElement.style.position = 'absolute';
    gui.domElement.style.bottom = '100px'; // Podniesienie o 100px od dołu
    gui.domElement.style.right = '0px'; 
    document.body.appendChild(gui.domElement);
    
    const oceanFolder = gui.addFolder('Ocean Parameters');
    oceanFolder.add(waterMaterial.uniforms.u_amplitude, 'value', 0.1, 5.0).name('Amplituda Fal'); // Zwiększono max
    oceanFolder.add(waterMaterial.uniforms.u_frequency, 'value', 0.05, 2.0).name('Częstotliwość Fal'); // Zwiększono max
    
    const colorFolder = gui.addFolder('Kolory');
    colorFolder.addColor({ surface: 0x00aaff }, 'surface').onChange(val => {
        waterMaterial.uniforms.u_surfaceColor.value.set(val);
    });
    colorFolder.addColor({ deep: 0x000055 }, 'deep').onChange(val => {
        waterMaterial.uniforms.u_deepColor.value.set(val);
    });
    oceanFolder.open();
    colorFolder.open();

    currentScene = scene;

    function animateOcean() {
        currentAnimationId = requestAnimationFrame(animateOcean);

        const elapsedTime = clock.getElapsedTime();
        scene.waterMaterial.uniforms.u_time.value = elapsedTime;
        
        // Rotacja słońca (symulacja ruchu)
        scene.sunLight.position.x = Math.sin(elapsedTime * 0.05) * 50;
        scene.sunLight.position.z = Math.cos(elapsedTime * 0.05) * 50;
        scene.waterMaterial.uniforms.u_lightDir.value.copy(scene.sunLight.position).normalize();
        
        currentControls.update();
        currentRenderer.render(scene, camera);
    }

    animateOcean();
}

// =========================================================================
// ZARZĄDZANIE UI I ODSŁUCHIWANIE ZDARZEŃ
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Aktualizacja menu przycisków
    const menuOverlay = document.getElementById('menu-overlay');
    menuOverlay.innerHTML = `
        <h1>Wybierz Zaawansowaną Scenę Three.js</h1>
        <button id="scene-shader-btn">1. Niestandardowy Shader (GLSL)</button>
        <button id="scene-audio-btn">2. Pulsar Audio (Mikrofon)</button>
        <button id="scene-planetary-btn">3. Symulator Orbitalny (Grawitacja)</button>
        <button id="scene-ocean-btn">4. Interaktywny Ocean (Shadery)</button>
    `;
    
    // Odsłuch na przyciskach wyboru scen
    document.getElementById('scene-shader-btn').addEventListener('click', initCustomShaderScene);
    document.getElementById('scene-audio-btn').addEventListener('click', initAudioVisualizerScene);
    document.getElementById('scene-planetary-btn').addEventListener('click', initPlanetaryScene);
    document.getElementById('scene-ocean-btn').addEventListener('click', initOceanScene);
});