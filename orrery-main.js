'use strict';

// Global toggle for using textures (checked by default)
let useTextures = true;

// ═══════════════════════════════════════════════════════════════
// RENDERER / SCENE / CAMERA
// ═══════════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 12000);
camera.position.set(0, 80, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// Enable shadows for Eclipse simulation
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Beautiful diffused soft shadows
// (Removed physicallyCorrectLights because inverse-square dropoff makes outer planets completely dark)

document.body.appendChild(renderer.domElement);
// Optional Anaglyph (red/cyan) stereo effect
let anaglyphEffect = null;
try {
    if (typeof THREE.AnaglyphEffect === 'function') {
        anaglyphEffect = new THREE.AnaglyphEffect(renderer);
        anaglyphEffect.setSize(window.innerWidth, window.innerHeight);
        
        // Patch AnaglyphEffect internally-created stereoscopic cameras to inherit the main camera's layer mask.
        // This prevents objects in Layer 1 (focused bodies) from disappearing because 
        // _cameraL and _cameraR default to strictly Layer 0.
        const originalRender = renderer.render;
        renderer.render = function(renderScene, renderCamera) {
            if (renderCamera && renderCamera !== camera && renderCamera.isPerspectiveCamera) {
                renderCamera.layers.mask = camera.layers.mask;
            }
            originalRender.apply(this, arguments);
        };
    }
} catch (e) {
    console.warn('AnaglyphEffect not available:', e);
    anaglyphEffect = null;
}

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.02;
controls.autoRotate = false;
controls.enableZoom = true;
controls.zoomSpeed = 1.2;
controls.rotateSpeed = 1;
controls.enablePan = true;
controls.panSpeed = 1.2;
controls.maxPolarAngle = Math.PI;
controls.enableKeys = false; // Prevent modern Three.js OrbitControls from catching keys
controls.noKeys = true;      // Prevent old Three.js OrbitControls from catching keys

// Vector3 object pooling to reduce garbage collection pressure
const _tempVec3 = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _translation = new THREE.Vector3();
const _cachedWorldPos = new THREE.Vector3();

// ═══════════════════════════════════════════════════════════════
// LIGHTING (base + camera light + Eclipses)
// ═══════════════════════════════════════════════════════════════
const ambientLight = new THREE.AmbientLight(0x404060, 0.35);  // Increased ambient light for better moon visibility
ambientLight.layers.enable(1); // Seen by both scenes
scene.add(ambientLight);

// Global illumination (layer 0). No shadows to avoid blocky mapping over 2500 units.
const sunLight = new THREE.PointLight(0xfff5e6, 0.8, 0, 0);  // Increased sun light intensity
sunLight.position.set(0, 0, 0);
sunLight.castShadow = false;
scene.add(sunLight);

// Highly focused dynamic shadow caster (layer 1). Acts exactly as the sun, but strictly over focused planet!
const eclipseLight = new THREE.DirectionalLight(0xfff5e6, 0.8);  // Increased from 0.5 to 0.8
eclipseLight.position.set(0, 0, 0);
eclipseLight.castShadow = true;
eclipseLight.shadow.mapSize.width = 2048; // Crisp 2048 softly blurred over a tiny area
eclipseLight.shadow.mapSize.height = 2048;
eclipseLight.shadow.bias = -0.002;
eclipseLight.shadow.normalBias = 0.15; // Increased to prevent shadow banding on flat ring geometry
eclipseLight.layers.set(1); // ONLY touches layer 1!
scene.add(eclipseLight);
scene.add(eclipseLight.target);

// Fill lights from camera - NO shadow casting, kept dim
const cameraLight = new THREE.PointLight(0xfff5e6, 0.15, 0, 0);
cameraLight.layers.enable(1);
camera.add(cameraLight);
scene.add(camera);

const cameraDirLight = new THREE.DirectionalLight(0xffffff, 0.15);
cameraDirLight.layers.enable(1);
camera.add(cameraDirLight);
cameraDirLight.position.set(0, 0, -1);

camera.layers.enable(1); // Let the camera see layer 1 Objects!

// ═══════════════════════════════════════════════════════════════
// STARFIELD (distant)
// ═══════════════════════════════════════════════════════════════
(function createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const count = 12000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
        const r = 4000 + Math.random() * 1500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i] = r * Math.sin(phi) * Math.cos(theta);
        positions[i+1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i+2] = r * Math.cos(phi);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.0, transparent: true });
    scene.add(new THREE.Points(geometry, material));
})();

// ═══════════════════════════════════════════════════════════════
// TEXTURE LOADING (Bump Maps supported)
// ═══════════════════════════════════════════════════════════════
const LOCAL_BASE = 'textures/planets/';

const TEX_SOURCES = {
    Sun:        { local: LOCAL_BASE + 'sunmap.jpg' },
    Mercury:    { local: LOCAL_BASE + 'mercurymap.jpg' },
    Venus:      { local: LOCAL_BASE + 'venusmap.jpg' },
    Earth:      { local: LOCAL_BASE + 'earthmap1k.jpg' },
    Moon:       { local: LOCAL_BASE + 'moonmap.png' },
    Mars:       { local: LOCAL_BASE + 'mars_1k_color.jpg' },
    Phobos:     { local: LOCAL_BASE + 'phobosbump.jpg' },
    Deimos:     { local: LOCAL_BASE + 'deimosbump.jpg' },
    Jupiter:    { local: LOCAL_BASE + 'jupitermap.jpg' },
    Io:         { local: LOCAL_BASE + 'iomap.png' },
    Europa:     { local: LOCAL_BASE + 'europamap.png' },
    Ganymede:   { local: LOCAL_BASE + 'ganymedemap.png' },
    Callisto:   { local: LOCAL_BASE + 'callistomap.png' },
    Saturn:     { local: LOCAL_BASE + 'saturnmap.jpg' },
    SaturnRing: { local: LOCAL_BASE + 'saturnringcolor.jpg' },
    Uranus:     { local: LOCAL_BASE + 'uranusmap.jpg' },
    UranusRing: { local: LOCAL_BASE + 'uranusringcolour.jpg' },
    Neptune:    { local: LOCAL_BASE + 'neptunemap.jpg' },
    Pluto:      { local: LOCAL_BASE + 'plutomap2k.jpg' },
    Charon:     { local: LOCAL_BASE + 'charonmap.jpg' },
    Eros:        { local: LOCAL_BASE + 'erosmap.png' },
    Vesta:       { local: LOCAL_BASE + 'vestamap.jpg' },
    Ceres:       { local: LOCAL_BASE + 'ceresmap.jpg' },
};

const FALLBACK_COLORS = {
    // Inner Solar System
    Sun: 0xffdd77,        // yellow
    Mercury: 0xbcbcbc,    // gray
    Venus: 0xe6b800,      // yellow
    Earth: 0x2e6da3,      // blue
    Moon: 0xcccccc,       // gray
    Mars: 0xc0713b,       // red
    
    // Mars Moons
    Phobos: 0x887766,     // brown
    Deimos: 0x778866,     // olive
    
    // Asteroid Belt & Minor Planets
    Ceres: 0x9999aa,      // mauve
    Vesta: 0xbbaa88,      // tan
    Pallas: 0xaa99aa,     // mauve
    Juno: 0xaa8877,       // brown
    Eros: 0x996644,       // brown
    Hebe: 0xaa99bb,       // mauve
    
    // Outer Solar System
    Jupiter: 0xd8a27a,    // tan
    Io: 0xe3c878,         // gold
    Europa: 0xccbbaa,     // tan
    Ganymede: 0x9a8e7a,   // tan
    Callisto: 0x6a6a5a,   // gray-brown
    Saturn: 0xe0c090,     // pale
    Uranus: 0xc6d3e3,     // cyan
    Neptune: 0x4a6da8,    // blue
    
    // Plutinos and Dwarf Planets
    Pluto: 0xddddcc,      // tan
    Charon: 0xbbbbcc,     // mauve
    Eris: 0xccccaa,       // pale-tan
    Haumea: 0xbbccdd,     // pale-blue
    Makemake: 0xaabbcc,   // pale-blue
    Planet9: 0x444455     // dark-gray
};

const texLoader = new THREE.TextureLoader();

function loadTexture(name, onLoad) {
    const src = TEX_SOURCES[name];
    if (!src || !src.local) return onLoad(null);
    
    texLoader.load(src.local, tex => onLoad(tex), undefined, err => onLoad(null));
}

// Load GLB models for Phobos and Deimos
const gltfLoader = new THREE.GLTFLoader();
const glbCache = {};

function loadGLBModel(name, onLoad) {
     // Return cached model if available
     if (glbCache[name]) {
         return onLoad(glbCache[name]);
     }
     
     const url = `models-json/${name.toLowerCase()}.glb`;
     gltfLoader.load(
         url,
         (gltf) => {
             glbCache[name] = gltf.scene;
             console.log('[DEBUG] Successfully loaded GLB model from: ' + url);
             onLoad(gltf.scene);
         },
         (progressEvent) => {
             if (progressEvent.lengthComputable) {
                 const percentComplete = (progressEvent.loaded / progressEvent.total) * 100;
                 console.log('[PROGRESS] Loading ' + name + ': ' + percentComplete.toFixed(1) + '%');
             }
         },
         (error) => {
             console.warn('[ERROR] Could not load GLB model for ' + name + ' from URL: ' + url);
             console.warn('[ERROR] Details:', error);
             onLoad(null);
         }
     );
}

function makeMaterial(name, emissive = false) {
    const fallbackColor = FALLBACK_COLORS[name] || 0xaaaaaa;
    
    // Enhanced lighting for Phobos and Deimos
    const isMarsMoon = (name === 'Phobos' || name === 'Deimos');
    
    const mat = emissive 
        ? new THREE.MeshBasicMaterial({ color: fallbackColor }) // Sun doesn't need to receive lighting
        : new THREE.MeshPhysicalMaterial({ 
            color: fallbackColor, 
            roughness: isMarsMoon ? 0.15 : 0.6,  // Very shiny surface for maximum reflectance
            metalness: isMarsMoon ? 0.7 : 0.1,  // Highly metallic/reflective
            clearcoat: isMarsMoon ? 0.9 : 0.4,  // Maximum surface reflection
            clearcoatRoughness: isMarsMoon ? 0.05 : 0.3,  // Very sharp reflections
            emissive: isMarsMoon ? 0x888888 : 0x000000,  // Bright self-illumination
            emissiveIntensity: isMarsMoon ? 0.6 : 0.0,  // Very bright glow
            envMapIntensity: isMarsMoon ? 1.5 : 1.0  // Enhanced environment map reflection
        });
    
    // Only load and apply textures if useTextures is true
    if (useTextures) {
        loadTexture(name, (tex) => {
            if (tex) {
                // Apply bump maps for Phobos and Deimos realism
                if (name === 'Phobos' || name === 'Deimos') {
                    mat.bumpMap = tex;
                    mat.bumpScale = 0.25;  // Higher bump scale for pronounced surface detail
                } else {
                    mat.map = tex;
                    if (!emissive) mat.color.setHex(0xffffff);
                }
                mat.needsUpdate = true;
            }
        });
    }
    return mat;
}

// Re-apply materials to all objects (used when toggling textures)
function reapplyAllMaterials() {
    // Re-apply material to planets
    for (let name in planets) {
        const p = planets[name];
        if (p.mesh && p.mesh.isMesh) {
            const oldMat = p.mesh.material;
            p.mesh.material = makeMaterial(name);
            if (oldMat && oldMat.dispose) oldMat.dispose();
        }
    }
    
    // Re-apply material to moons
    for (let name in satBodies) {
        const s = satBodies[name];
        if (s.mesh && s.mesh.isMesh) {
            const oldMat = s.mesh.material;
            s.mesh.material = makeMaterial(name);
            if (oldMat && oldMat.dispose) oldMat.dispose();
        }
    }
    
    // Re-apply material to Sun
    if (sunInner && sunInner.isMesh) {
        const oldMat = sunInner.material;
        sunInner.material = makeMaterial('Sun', true);
        if (oldMat && oldMat.dispose) oldMat.dispose();
    }
}

// ═══════════════════════════════════════════════════════════════
// KEPLERIAN ELEMENTS & AXIAL TILTS
// ═══════════════════════════════════════════════════════════════
// Orbital elements are based on J2000 epoch (January 1, 2000, 12:00 TT)
// and are simplified for visualization purposes.
//  a: Semi-major axis (AU)
//  e: Eccentricity
//  i: Inclination (degrees)
//  L: Mean longitude at epoch (degrees)
//  longPeri: Longitude of perihelion (degrees)
//  node: Longitude of ascending node (degrees)
//  period: Orbital period (days)
//  size: Relative size for rendering
//  selfRot: Rotation speed for day/night cycle
//  tilt: Axial tilt (degrees)
//  rings: Boolean for Saturn's rings
    
const D2R = Math.PI / 180;
const DIST_SCALE = 50; 

const KEPLER = {
    Mercury: { a:0.387, e:0.2056, i:7.005, L:252.25, longPeri:77.45, node:48.33, period:87.97, size:0.45, selfRot:0.002, tilt:0.034 },
    Venus:   { a:0.723, e:0.0067, i:3.394, L:181.98, longPeri:131.53, node:76.68, period:224.70, size:0.80, selfRot:0.0015, tilt:177.36 },
    Earth:   { a:1.000, e:0.0167, i:0.000, L:100.46, longPeri:102.94, node:0.00, period:365.25, size:0.90, selfRot:0.010, tilt:23.44 },
    Mars:    { a:1.524, e:0.0934, i:1.850, L:355.45, longPeri:336.04, node:49.57, period:686.97, size:0.60, selfRot:0.009, tilt:25.19 },
    // Asteroid Belt Objects
    Ceres:   { a:2.769, e:0.0755, i:10.59, L:73.12, longPeri:73.12, node:80.33, period:1681.6, size:0.35, selfRot:0.005, tilt:0 },
    Vesta:   { a:2.362, e:0.0890, i:7.134, L:152.03, longPeri:151.43, node:103.85, period:1325.4, size:0.25, selfRot:0.008, tilt:0 },
    Pallas:  { a:2.773, e:0.2355, i:34.84, L:310.97, longPeri:310.97, node:173.00, period:1685.0, size:0.22, selfRot:0.006, tilt:0 },
    Juno:    { a:2.669, e:0.2574, i:12.99, L:350.56, longPeri:248.20, node:171.62, period:1593.2, size:0.20, selfRot:0.007, tilt:0 },
    Eros:    { a:1.458, e:0.2226, i:10.83, L:304.54, longPeri:178.77, node:304.52, period:643.0, size:0.15, selfRot:0.010, tilt:0 },
    Hebe:    { a:2.425, e:0.2018, i:14.77, L:326.46, longPeri:238.00, node:138.80, period:1266.9, size:0.18, selfRot:0.006, tilt:0 },
    // Outer Solar System
    Jupiter: { a:5.203, e:0.0484, i:1.303, L:34.40, longPeri:13.13, node:100.55, period:4332.59, size:2.20, selfRot:0.025, tilt:3.13 },
    Saturn:  { a:9.537, e:0.0541, i:2.484, L:49.94, longPeri:92.43, node:113.71, period:10759.22, size:1.80, selfRot:0.022, tilt:26.73, rings:true },
    Uranus:  { a:19.191, e:0.0472, i:0.770, L:313.23, longPeri:170.96, node:74.01, period:30685.4, size:1.60, selfRot:-0.014, tilt:97.77, rings:true },
    Neptune: { a:30.069, e:0.0086, i:1.769, L:304.88, longPeri:44.97, node:131.78, period:60190.00, size:1.40, selfRot:0.014, tilt:28.32 },
    // Trans-Neptunian Objects
    Pluto:   { a:39.482, e:0.2488, i:17.16, L:238.92, longPeri:224.06, node:110.30, period:90560.0, size:0.30, selfRot:0.003, tilt:122.53 },
    Eris:    { a:96.0, e:0.4417, i:44.19, L:151.43, longPeri:276.96, node:151.43, period:557600.0, size:0.27, selfRot:0.004, tilt:0 },
    Haumea:  { a:43.335, e:0.1897, i:28.22, L:239.00, longPeri:239.00, node:238.90, period:103310.0, size:0.23, selfRot:0.005, tilt:0 },
    Makemake: { a:45.791, e:0.1591, i:29.01, L:166.00, longPeri:166.00, node:79.88, period:112085.0, size:0.21, selfRot:0.004, tilt:0 },
    Planet9: { a:400.0, e:0.25, i:15.0, L:0, longPeri:150, node:90, period:3650000, size:1.2, selfRot:0.01, tilt:45 }
};

const SATELLITES = {
    // Moon is tidally locked, inclination 0 to ensure frequent perfect eclipses
    Moon:     { parent:'Earth', period:27.322, L0:218.32, i:0.0, a_display:2.5, size:0.22, selfRot:0.005, tilt:1.54, tidallyLocked: true },
    Phobos:   { parent:'Mars',    period:0.319,  L0:92.0,  i:1.08,  a_display:1.5, size:0.10, selfRot:0.012, tilt:0 },
    Deimos:   { parent:'Mars',    period:1.262,  L0:296.0, i:1.79,  a_display:2.4, size:0.07, selfRot:0.008, tilt:0 },
    Io:       { parent:'Jupiter', period:1.769,  L0:84.46, i:0.04,  a_display:6.0, size:0.30, selfRot:0.012, tilt:0 },
    Europa:   { parent:'Jupiter', period:3.551,  L0:219.11,i:0.47,  a_display:8.5, size:0.25, selfRot:0.010, tilt:0 },
    Ganymede: { parent:'Jupiter', period:7.155,  L0:63.55, i:0.19,  a_display:11.5, size:0.38, selfRot:0.008, tilt:0 },
    Callisto: { parent:'Jupiter', period:16.689, L0:298.85,i:0.28,  a_display:15.0, size:0.34, selfRot:0.006, tilt:0 },
    Charon:   { parent:'Pluto',   period:6.387,  L0:0.0,   i:0.0,   a_display:3.0, size:0.15, selfRot:0.003, tilt:0, tidallyLocked: true },
};

function solveKepler(M, e) {
    let E = M;
    for (let i=0; i<100; i++) {
        const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
        E += dE;
        if (Math.abs(dE) < 1e-9) break;
    }
    return E;
}

function getCartesianAU(data, days) {
    const n = 360 / data.period;
    const M0 = ((data.L - data.longPeri) % 360 + 360) % 360;
    const Mdeg = ((M0 + n * days) % 360 + 360) % 360;
    const E = solveKepler(Mdeg * D2R, data.e);
    
    const xo = data.a * (Math.cos(E) - data.e);
    const yo = data.a * Math.sqrt(1 - data.e*data.e) * Math.sin(E);
    
    const iR = data.i * D2R, nR = data.node * D2R;
    const wR = (data.longPeri - data.node) * D2R;
    const cN = Math.cos(nR), sN = Math.sin(nR);
    const cI = Math.cos(iR), sI = Math.sin(iR);
    const cW = Math.cos(wR), sW = Math.sin(wR);
    
    return new THREE.Vector3(
        (cN*cW - sN*sW*cI)*xo + (-cN*sW - sN*cW*cI)*yo,
        (sW*sI)*xo + (cW*sI)*yo,
        (sN*cW + cN*sW*cI)*xo + (-sN*sW + cN*cW*cI)*yo
    );
}

function scaleAU(v) {
    const d = v.length();
    if (d < 1e-9) return v.clone();
    return v.clone().multiplyScalar(Math.pow(d, 0.58) * DIST_SCALE / d);
}

function getSatelliteOffset(sat, days) {
    const n = 360 / sat.period;
    const M = ((sat.L0 + n * days) % 360) * D2R;
    const x_orb = sat.a_display * Math.cos(M);
    const y_orb = sat.a_display * Math.sin(M);
    const iR = sat.i * D2R;
    return new THREE.Vector3(x_orb, y_orb * Math.sin(iR), y_orb * Math.cos(iR));
}

// ═══════════════════════════════════════════════════════════════
// BUILD SCENE (Hierarchy Groups + Visible Axis)
// ═══════════════════════════════════════════════════════════════

const planetOrbitLines = [];
// Pre-compute planet names lookup to avoid repeated Object.keys() calls
const PLANET_NAMES = Object.keys(KEPLER);

function buildPlanetOrbit(data) {
    const pts = [];
    for (let k=0; k<=256; k++) {
        const E = (k/256)*Math.PI*2;
        const xo = data.a * (Math.cos(E) - data.e);
        const yo = data.a * Math.sqrt(1 - data.e*data.e) * Math.sin(E);
        const iR = data.i*D2R, nR = data.node*D2R, wR = (data.longPeri-data.node)*D2R;
        const cN = Math.cos(nR), sN = Math.sin(nR), cI = Math.cos(iR), sI = Math.sin(iR), cW = Math.cos(wR), sW = Math.sin(wR);
        pts.push(scaleAU(new THREE.Vector3(
            (cN*cW - sN*sW*cI)*xo + (-cN*sW - sN*cW*cI)*yo,
            (sW*sI)*xo + (cW*sI)*yo,
            (sN*cW + cN*sW*cI)*xo + (-sN*sW + cN*cW*cI)*yo
        )));
    }
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x557799, transparent: true, opacity: 0.45 })
    );
    scene.add(line);
    planetOrbitLines.push(line);
}
for (let name in KEPLER) buildPlanetOrbit(KEPLER[name]);

// ═══════════════════════════════════════════════════════════════
// CREATE ASTEROID BELT VISUALIZATION
// ═══════════════════════════════════════════════════════════════
let asteroidBelt = null;
(function createAsteroidBelt() {
    const innerRadius = scaleAU(new THREE.Vector3(2.2, 0, 0)).length();  // ~2.2 AU
    const outerRadius = scaleAU(new THREE.Vector3(3.2, 0, 0)).length();  // ~3.2 AU
    const asteroidCount = 2000;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(asteroidCount * 3);
    
    for (let i = 0; i < asteroidCount; i++) {
        // Random orbital parameters for asteroid-like distribution
        const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
        const theta = Math.random() * Math.PI * 2;
        const incline = (Math.random() - 0.5) * 0.3;  // Small inclination variation
        
        positions[i * 3] = radius * Math.cos(theta);
        positions[i * 3 + 1] = radius * incline * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.sin(theta);
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0x8b7355,
        size: 0.3,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true
    });
    
    const asteroidBelt = new THREE.Points(geometry, material);
    scene.add(asteroidBelt);
})();

// Create planetary Groups (Handles position and tilt) containing Meshes (handles day rotation)
const planets = {};
for (let name in KEPLER) {
    const data = KEPLER[name];
    const group = new THREE.Group();
    group.rotation.z = (data.tilt || 0) * D2R; // Apply axial tilt

    // Visible Axis Line
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -data.size * 1.6, 0),
        new THREE.Vector3(0, data.size * 1.6, 0)
    ]);
    const axisMat = new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.4});
    group.add(new THREE.Line(axisGeo, axisMat));

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), makeMaterial(name));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    
    if (data.rings) {
        const innerRadius = data.size * 1.4;
        const outerRadius = data.size * 2.3;
        // Use 256 phi segments to eliminate visible banding artifacts when lit
        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 256, 256);
        
        // Compute smooth vertex normals to avoid discontinuities between segments
        ringGeo.computeVertexNormals();
        ringGeo.normalizeNormals();
        
        const ringMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
            normalMap: null, // Disable normal mapping to avoid adding more detail complexity
            flatShading: false  // Enable smooth shading
        });
        loadTexture(name + 'Ring', tex => { 
            if(tex) { 
                ringMat.map = tex;
                
                // Override the fragment mapping shader to calculate perfect mathematically smooth circles
                ringMat.onBeforeCompile = function (shader) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <map_fragment>',
                        `
                        #ifdef USE_MAP
                            // vUv is interpolated linearly over the [-R, R] bounding box
                            float rNorm = length(vUv * 2.0 - 1.0);
                            float rRatio = ${ (innerRadius / outerRadius).toFixed(5) };
                            float radialU = clamp((rNorm - rRatio) / (1.0 - rRatio), 0.0, 1.0);
                            
                            // Use interpolated V coordinate for vertical texture variation
                            float texV = vUv.y;
                            
                            vec4 texelColor = texture2D(map, vec2(radialU, texV));
                            texelColor = mapTexelToLinear(texelColor);
                            diffuseColor *= texelColor;
                            
                            // Auto-extract an alpha channel to make the black ring gaps totally transparent 
                            float brightness = max(texelColor.r, max(texelColor.g, texelColor.b));
                            diffuseColor.a *= smoothstep(0.04, 0.15, brightness);
                        #endif
                        `
                    );
                };
                ringMat.needsUpdate = true; 
            } 
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI/2;
        ring.receiveShadow = true;
        ring.castShadow = true;
        group.add(ring);
    }
    
    scene.add(group);
    planets[name] = { group, mesh, selfRot: data.selfRot };
    
    // For Eros, Eris, Haumea, Makemake try to load GLB model asynchronously
    if (name === 'Pallas' || name === 'Juno' || name === 'Hebe' || name === 'Eros' || name === 'Eris' || name === 'Haumea' || name === 'Makemake') {
        (function(planetName, planetEntry) {
            loadGLBModel(planetName, (glbScene) => {
                if (glbScene) {
                    // Clone the loaded scene
                    const modelClone = glbScene.clone();
                    
                    // Scale model to match expected size
                    const bbox = new THREE.Box3().setFromObject(modelClone);
                    const size = bbox.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = (data.size * 2) / maxDim;
                    modelClone.scale.multiplyScalar(scale);
                    
                    // Set shadow properties for all meshes in the model
                    modelClone.traverse((node) => {
                        if (node.isMesh) {
                            node.castShadow = true;
                            node.receiveShadow = true;
                        }
                    });
                    
                    // Remove old sphere and add GLB model
                    planetEntry.group.remove(planetEntry.mesh);
                    planetEntry.group.add(modelClone);
                    planetEntry.mesh = modelClone;
                     planetEntry.glb_loaded = true;
                     console.log('[OK] Loaded GLB model for ' + planetName);
                     try { if (typeof rebuildCelestialMeshes === 'function') rebuildCelestialMeshes(); } catch(e) { console.warn('rebuildCelestialMeshes failed', e); }
                 } else {
                     console.warn('[WARN] GLB load failed for ' + planetName + ', using sphere');
                 }
            });
        })(name, planets[name]);
    }
}

// Sun: create a group so we can apply axial tilt and show an axis, and rotate sun correctly
const sunData = { size: 5.2, tilt: 7.25, period: 25.0 }; // tilt degrees, rotation period in days
const sunGroup = new THREE.Group();
sunGroup.rotation.z = sunData.tilt * D2R;

// Visible axis for Sun
const sunAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -sunData.size * 2.0, 0),
    new THREE.Vector3(0, sunData.size * 2.0, 0)
]);
const sunAxisMat = new THREE.LineBasicMaterial({ color: 0xffdd77, transparent: true, opacity: 0.7 });
sunGroup.add(new THREE.Line(sunAxisGeo, sunAxisMat));

const sunInner = new THREE.Mesh(new THREE.SphereGeometry(sunData.size, 64, 64), makeMaterial('Sun', true));
sunInner.castShadow = false; // Sun emits light, doesn't receive
sunInner.receiveShadow = false;
sunGroup.add(sunInner);
scene.add(sunGroup);

// Keep existing variable name used elsewhere as the Sun reference (group works for getWorldPosition)
const sunMesh = sunGroup;

// Create Satellites Groups
const satBodies = {};
const moonOrbitObjs = [];
for (let name in SATELLITES) {
    const sat = SATELLITES[name];
    const group = new THREE.Group();
    group.rotation.z = (sat.tilt || 0) * D2R;

    // Minor visible axis for moons
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -sat.size * 1.5, 0),
        new THREE.Vector3(0, sat.size * 1.5, 0)
    ]);
    group.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({color: 0xffffff, transparent:true, opacity:0.3})));

    // Start with placeholder sphere for all moons
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(sat.size, 48, 48), makeMaterial(name));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `sphere_${name}`; // Tag for later removal
    group.add(mesh);
    
    scene.add(group);
    satBodies[name] = { group, mesh, sat };
    
    // For Phobos,Deimos, Eros try to load GLB model asynchronously
    if (name === 'Phobos' || name === 'Deimos') {
        (function(moonName, satEntry) {
            loadGLBModel(moonName, (glbScene) => {
                if (glbScene) {
                    // Clone the loaded scene
                    const modelClone = glbScene.clone();
                    
                    // Scale model to match expected moon size
                    const bbox = new THREE.Box3().setFromObject(modelClone);
                    const size = bbox.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = (satEntry.sat.size * 2) / maxDim;
                    modelClone.scale.multiplyScalar(scale);
                    
                    // Set shadow properties for all meshes in the model
                    modelClone.traverse((node) => {
                        if (node.isMesh) {
                            node.castShadow = true;
                            node.receiveShadow = true;
                        }
                    });
                    
                    // Remove sphere and add GLB model
                    const sphereMesh = satEntry.group.getObjectByName(`sphere_${moonName}`);
                    if (sphereMesh) satEntry.group.remove(sphereMesh);
                    satEntry.group.add(modelClone);
                    satEntry.mesh = modelClone;
                    satEntry.glb_loaded = true;
                    console.log('[OK] Loaded GLB model for ' + moonName);
                    try { if (typeof rebuildCelestialMeshes === 'function') rebuildCelestialMeshes(); } catch(e) { console.warn('rebuildCelestialMeshes failed', e); }
                 } else {
                     console.warn('[WARN] GLB load failed for ' + moonName + ', using sphere');
                 }
            });
        })(name, satBodies[name]);
    }
    
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0x668899, transparent:true, opacity:0.4}));
    scene.add(line);
    moonOrbitObjs.push({ line, sat });
}

function updateMoonOrbitRing(line, sat, parentPos) {
    const pts = [], iR = sat.i * D2R;
    for (let k=0; k<=128; k++) {
        const a = (k/128)*Math.PI*2;
        pts.push(new THREE.Vector3(
            parentPos.x + Math.cos(a)*sat.a_display,
            parentPos.y + Math.sin(a)*Math.sin(iR)*sat.a_display,
            parentPos.z + Math.sin(a)*Math.cos(iR)*sat.a_display
        ));
    }
    line.geometry.setFromPoints(pts);
    line.geometry.computeBoundingSphere(); // Prevents line from disappearing (frustum culling) when camera moves far away from the origin
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION STATE & UI
// ═══════════════════════════════════════════════════════════════
/*  The simulation time is tracked in "simDays" which represents the
    number of days since the J2000 epoch (January 1, 2000, 12:00 TT).
    This allows for easy calculation of planetary positions based on 
    their orbital periods and mean longitudes at the epoch. 
    The UI allows users to set the simulation date, which updates 
    simDays accordingly. The animation loop will then use simDays 
    to compute the current positions of planets and moons in each frame.
    The focusTarget variable tracks which celestial body is currently 
    the focus of the camera. When the user changes the focus selection, 
    currentTargetObj is reset to null, which triggers the camera to 
    re-lock onto the new target in the next animation frame. 
    This ensures smooth transitions when switching 
    focus between different planets and moons.
 */
 
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
let simDays = (Date.now() - J2000) / 86400000;
let lastTime = performance.now();
let currentTargetObj = null; // Track target switching
let currentFocusedSystem = null; // Track system to push to Layer 1 for HD soft shadows!

function setSystemLayer(planetName, layer) {
    if(!planets[planetName]) return;
    planets[planetName].group.traverse(obj => obj.layers.set(layer));
    for(let moonName in SATELLITES) {
        if(SATELLITES[moonName].parent === planetName) {
            satBodies[moonName].group.traverse(obj => obj.layers.set(layer));
        }
    }
}

const dateInput = document.getElementById('datePicker');
const dateDisplay = document.getElementById('date-display');
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speed-val');
const focusSelect = document.getElementById('focusSelect');
const orbitToggle = document.getElementById('toggleOrbits');
const moonOrbToggle = document.getElementById('toggleMoonOrbits');
const cameraLightToggle = document.getElementById('toggleCameraLight');
const systemFilter = document.getElementById('systemFilter');
const anaglyphToggle = document.getElementById('toggleAnaglyph');
const texturesToggle = document.getElementById('toggleTextures');
const uiContainer = document.getElementById('ui-container');

// Explicitly reset UI inputs on reload to prevent cached browser states from desyncing visually
dateInput.value = new Date().toISOString().split('T')[0];
speedSlider.value = "0.1";
orbitToggle.checked = true;
moonOrbToggle.checked = true;
cameraLightToggle.checked = true;
// Ensure anaglyph stereo is off on fresh load (browsers may preserve checkbox state across reloads)
if (anaglyphToggle) anaglyphToggle.checked = false;
if (texturesToggle) texturesToggle.checked = true;
systemFilter.value = 'all';
focusSelect.value = 'free';
controls.zoomSpeed = 4.0; // Fast zoom for free roam by default

// Minimize control panel when not hovering (keep heading, date and instructions visible)
(function setupUiAutoMinimize() {
    // Don't auto-minimize on touch devices where hover isn't meaningful
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    if (!uiContainer || isTouch) return;

    let hideTimeout = null;
    const HIDE_DELAY = 1400; // ms

    const minimize = () => uiContainer.classList.add('minimized');
    const expand = () => uiContainer.classList.remove('minimized');

    uiContainer.addEventListener('mouseenter', () => {
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        expand();
    });
    uiContainer.addEventListener('mouseleave', () => {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(minimize, HIDE_DELAY);
    });

    // Also expand when any child receives focus (keyboard navigation)
    uiContainer.addEventListener('focusin', () => { if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; } expand(); });
    uiContainer.addEventListener('focusout', () => { if (hideTimeout) clearTimeout(hideTimeout); hideTimeout = setTimeout(minimize, HIDE_DELAY); });

    // Start minimized so it unobtrusively sits while the user explores the scene
    minimize();
})();

dateInput.addEventListener('change', () => {
    simDays = (new Date(dateInput.value + 'T12:00:00Z').getTime() - J2000) / 86400000;
});

speedSlider.addEventListener('input', () => { speedVal.textContent = parseFloat(speedSlider.value).toFixed(1) + ' days/s'; });
orbitToggle.addEventListener('change', () => { planetOrbitLines.forEach(l => l.visible = orbitToggle.checked); });
moonOrbToggle.addEventListener('change', () => { moonOrbitObjs.forEach(o => o.line.visible = moonOrbToggle.checked); });
cameraLightToggle.addEventListener('change', () => {
    cameraLight.visible = cameraLightToggle.checked;
    cameraDirLight.visible = cameraLightToggle.checked;
});

// Toggle textures on and off
if (texturesToggle) {
    texturesToggle.addEventListener('change', () => {
        useTextures = texturesToggle.checked;
        reapplyAllMaterials();
    });
}

function applySystemFilter(filter) {
    const innerPlanets = ['Mercury', 'Venus', 'Earth', 'Mars'];
    const asteroidBelt = ['Ceres', 'Vesta', 'Pallas', 'Juno', 'Hebe', 'Eros'];
    const outerPlanets = ['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Eris', 'Haumea', 'Makemake', 'Planet9'];
    const innerMoons = ['Moon', 'Phobos', 'Deimos'];
    const outerMoons = ['Io', 'Europa', 'Ganymede', 'Callisto', 'Charon'];
   
    const showInner = (filter === 'all' || filter === 'inner');
    const showOuter = (filter === 'all' || filter === 'outer');
    const showAsteroid = (filter === 'all');
    
    for (let name in planets) {
        planets[name].group.visible = (innerPlanets.includes(name) && showInner) || (asteroidBelt.includes(name) && showAsteroid) || (outerPlanets.includes(name) && showOuter);
    }
    planetOrbitLines.forEach((line, idx) => {
        const planetName = PLANET_NAMES[idx];
        line.visible = orbitToggle.checked && ((innerPlanets.includes(planetName) && showInner) || (asteroidBelt.includes(planetName) && showAsteroid) || (outerPlanets.includes(planetName) && showOuter));
    });
    for (let name in satBodies) {
        satBodies[name].group.visible = (innerMoons.includes(name) && showInner) || (outerMoons.includes(name) && showOuter);
    }
    moonOrbitObjs.forEach(obj => {
        const name = Object.keys(SATELLITES).find(k => SATELLITES[k] === obj.sat);
        obj.line.visible = moonOrbToggle.checked && ((innerMoons.includes(name) && showInner) || (outerMoons.includes(name) && showOuter));
    });
}
systemFilter.addEventListener('change', e => applySystemFilter(e.target.value));
applySystemFilter('all');

// Focus logic reset on change
let focusTarget = 'free';
focusSelect.addEventListener('change', e => { 
    focusTarget = e.target.value; 
    currentTargetObj = null; // trigger re-lock
    
    // Increase zoom speed dramatically when in free roam to navigate the entire system
    if (focusTarget === 'free') {
        controls.zoomSpeed = 4.0;
        controls.enablePan = true;
        // Reset zoom to initial state immediately when switching to free roam
        controls.minDistance = INITIAL_MIN_DISTANCE;
        controls.maxDistance = INITIAL_MAX_DISTANCE;
        controls.update(); // Force immediate update
        controls._resetToFree = false; // Ensure full reset on next frame
    } else {
        // Fine zoom control required for examining individual planets closely
        controls.zoomSpeed = 0.8;
        controls.enablePan = false;
    }
});

// Ensure a sensible default minimum zoom distance (so camera can't go through objects)
const INITIAL_MIN_DISTANCE = 10;
const INITIAL_MAX_DISTANCE = 4000;
controls.minDistance = INITIAL_MIN_DISTANCE;
controls.maxDistance = INITIAL_MAX_DISTANCE;

// ═══════════════════════════════════════════════════════════════
// WIKIPEDIA INFOBOX FETCHING
// ═══════════════════════════════════════════════════════════════

// Map celestial object names to Wikipedia article titles
const wikipediaPages = {
    'Sun': 'Sun',
    'Mercury': 'Mercury_(planet)',
    'Venus': 'Venus',
    'Earth': 'Earth',
    'Moon': 'Moon',
    'Mars': 'Mars',
    'Phobos': 'Phobos_(moon)',
    'Deimos': 'Deimos_(moon)',
    'Ceres': 'Ceres_(dwarf_planet)',
    'Vesta': 'Vesta_(asteroid)',
    'Pallas': 'Pallas_(asteroid)',
    'Juno': 'Juno_(asteroid)',
    'Hebe': 'Hebe_(asteroid)',
    'Eros': 'Eros_(asteroid)',
    'Jupiter': 'Jupiter',
    'Io': 'Io_(moon)',
    'Europa': 'Europa_(moon)',
    'Ganymede': 'Ganymede',
    'Callisto': 'Callisto_(moon)',
    'Saturn': 'Saturn',
    'Uranus': 'Uranus',
    'Neptune': 'Neptune',
    'Pluto': 'Pluto',
    'Charon': 'Charon_(moon)',
    'Eris': 'Eris_(dwarf_planet)',
    'Haumea': 'Haumea',
    'Makemake': 'Makemake_(dwarf_planet)',
    'Planet9': 'Planet9'
};

// Fallback data for all celestial objects, used when Wikipedia is unavailable
const fallbackInfoboxData = {
    'Sun': {
        'Type': 'G-type main-sequence star',
        'Mass': '1.989 × 10³⁰ kg',
        'Radius': '696,000 km',
        'Luminosity': '3.828 × 10²⁶ W',
        'Surface Temperature': '5,778 K',
        'Age': '4.603 billion years',
        'Orbital Velocity': '220 km/s',
        'Composition': 'Hydrogen (73%), Helium (25%)',
        'Metallicity': 'Z ≈ 0.0134'
    },
    'Mercury': {
        'Type': 'Terrestrial planet',
        'Mass': '3.3011 × 10²³ kg',
        'Radius': '2,439.7 km',
        'Orbital Period': '87.969 days',
        'Average Temperature': '167 K',
        'Surface Pressure': '~ 0 Pa (negligible)',
        'Distance from Sun': '57.909 million km',
        'Eccentricity': '0.2056',
        'Inclination': '7.005°'
    },
    'Venus': {
        'Type': 'Terrestrial planet',
        'Mass': '4.8675 × 10²⁴ kg',
        'Radius': '6,051.8 km',
        'Orbital Period': '224.701 days',
        'Surface Temperature': '735 K',
        'Surface Pressure': '92.1 bar',
        'Atmosphere': 'CO₂ with H₂SO₄ clouds',
        'Rotation Period': '243.025 days (retrograde)',
        'Axial Tilt': '177.36°'
    },
    'Earth': {
        'Type': 'Terrestrial planet',
        'Mass': '5.9722 × 10²⁴ kg',
        'Radius': '6,371 km',
        'Orbital Period': '365.25 days',
        'Average Temperature': '288 K',
        'Surface Pressure': '101.325 kPa',
        'Atmosphere': 'N₂ (78%), O₂ (21%)',
        'Water Coverage': '71%',
        'Natural Satellites': '1 (Moon)'
    },
    'Mars': {
        'Type': 'Terrestrial planet',
        'Mass': '6.4171 × 10²³ kg',
        'Radius': '3,389.5 km',
        'Orbital Period': '686.971 days',
        'Average Temperature': '210 K',
        'Surface Pressure': '600 Pa',
        'Atmosphere': 'CO₂ (95.3%)',
        'Natural Satellites': '2 (Phobos, Deimos)',
        'Color': 'Reddish (iron oxide)'
    },
    'Ceres': {
        'Classification': 'Dwarf planet',
        'Mass': '9.38392 × 10²⁰ kg',
        'Radius': '469.7 km',
        'Orbital Period': '4.60 years',
        'Discovery': '1 January 1801',
        'Discoverer': 'Giuseppe Piazzi',
        'Surface Type': 'Rocky, icy',
        'Average Temperature': '173 K',
        'Spectral Class': 'C-type'
    },
    'Jupiter': {
        'Type': 'Gas Giant',
        'Mass': '1.8982 × 10²⁷ kg',
        'Radius': '69,911 km',
        'Orbital Period': '11.86 years',
        'Rotation Period': '9.93 hours',
        'Great Red Spot': 'Giant storm system',
        'Magnetic Field': 'Very strong',
        'Natural Satellites': '95 known moons',
        'Composition': 'Hydrogen, Helium'
    },
    'Saturn': {
        'Type': 'Gas Giant',
        'Mass': '5.6834 × 10²⁶ kg',
        'Radius': '58,232 km',
        'Orbital Period': '29.46 years',
        'Rotation Period': '10.76 hours',
        'Ring System': 'Prominent rings (8 main)',
        'Natural Satellites': '146 known moons',
        'Density': '0.687 g/cm³ (lowest)',
        'Composition': 'Hydrogen, Helium'
    },
    'Uranus': {
        'Type': 'Ice Giant',
        'Mass': '8.6810 × 10²⁵ kg',
        'Radius': '25,559 km',
        'Orbital Period': '84.01 years',
        'Axial Tilt': '97.77° (sideways)',
        'Rotation Period': '17.24 hours',
        'Temperature': '59 K',
        'Natural Satellites': '28 known moons',
        'Color': 'Cyan (methane atmosphere)'
    },
    'Neptune': {
        'Type': 'Ice Giant',
        'Mass': '1.02413 × 10²⁶ kg',
        'Radius': '24,622 km',
        'Orbital Period': '164.79 years',
        'Rotation Period': '16.11 hours',
        'Wind Speed': 'Up to 2,100 km/h',
        'Temperature': '55 K',
        'Natural Satellites': '16 known moons',
        'Composition': 'Hydrogen, Helium, Methane'
    },
    'Pluto': {
        'Type': 'Dwarf planet (Plutino)',
        'Mass': '1.309 × 10²² kg',
        'Radius': '1,188 km',
        'Orbital Period': '248.09 years',
        'Rotation Period': '6.39 days (retrograde)',
        'Discovery': '18 February 1930',
        'Discoverer': 'Clyde Tombaugh',
        'Natural Satellites': '5 moons',
        'Notable Feature': 'Heart-shaped region'
    },
    'Moon': {
        'Type': 'Natural satellite of Earth',
        'Mass': '7.342 × 10²² kg',
        'Radius': '1,737.4 km',
        'Orbital Period': '27.32 days',
        'Average Distance': '384,400 km',
        'Surface Temperature': '-173°C to 127°C',
        'Gravity': '1.62 m/s²',
        'Age': '4.51 billion years',
        'Composition': 'Silicate rock'
    },
    'Phobos': {
        'Type': 'Irregular moon of Mars',
        'Mass': '1.0659 × 10¹⁶ kg',
        'Dimensions': '26.8 × 22.4 × 18.4 km',
        'Orbital Period': '7.66 hours',
        'Discovery': '18 August 1877',
        'Discoverer': 'Asaph Hall',
        'Composition': 'Carbonaceous rock',
        'Notable Feature': 'Stickney crater',
        'Rotation': 'Synchronous (tidally locked)'
    },
    'Deimos': {
        'Type': 'Irregular moon of Mars',
        'Mass': '1.4762 × 10¹⁵ kg',
        'Dimensions': '15 × 12 × 11 km',
        'Orbital Period': '30.3 hours',
        'Discovery': '12 August 1877',
        'Discoverer': 'Asaph Hall',
        'Composition': 'Carbonaceous rock',
        'Rotation': 'Synchronous',
        'Surface Features': 'Heavily cratered'
    },
    'Io': {
        'Type': 'Galilean moon of Jupiter',
        'Mass': '8.9319 × 10²² kg',
        'Radius': '1,821.6 km',
        'Orbital Period': '1.769 days',
        'Discovery': '7 January 1610',
        'Discoverer': 'Galileo Galilei',
        'Notable Feature': '400+ active volcanoes',
        'Color': 'Yellow/orange (sulfur)',
        'Composition': 'Silicate rock, sulfur'
    },
    'Europa': {
        'Type': 'Galilean moon of Jupiter',
        'Mass': '4.8020 × 10²² kg',
        'Radius': '1,560.7 km',
        'Orbital Period': '3.551 days',
        'Discovery': '7 January 1610',
        'Discoverer': 'Galileo Galilei',
        'Surface': 'Water ice',
        'Subsurface Ocean': 'Possible liquid water',
        'Potential': 'Possible life existence'
    },
    'Ganymede': {
        'Type': 'Galilean moon of Jupiter',
        'Mass': '1.4819 × 10²³ kg',
        'Radius': '2,634.1 km',
        'Orbital Period': '7.155 days',
        'Discovery': '7 January 1610',
        'Discoverer': 'Galileo Galilei',
        'Notable Feature': 'Largest moon in solar system',
        'Magnetic Field': 'Yes (unique for moons)',
        'Composition': 'Rock and ice'
    },
    'Callisto': {
        'Type': 'Galilean moon of Jupiter',
        'Mass': '1.0759 × 10²³ kg',
        'Radius': '2,410.3 km',
        'Orbital Period': '16.69 days',
        'Discovery': '7 January 1610',
        'Discoverer': 'Galileo Galilei',
        'Surface': 'Heavily cratered',
        'Composition': 'Rock and ice',
        'Subsurface Ocean': 'Possible'
    },
    'Charon': {
        'Type': 'Moon of Pluto',
        'Mass': '1.586 × 10²¹ kg',
        'Radius': '603.5 km',
        'Orbital Period': '6.387 days',
        'Discovery': '22 June 1978',
        'Discoverer': 'James W. Christy',
        'Notable Feature': 'Binary system with Pluto',
        'Composition': 'Water ice, nitrogen ice',
        'Size Ratio': 'Half the size of Pluto'
    },
    'Vesta': {
        'Type': 'V-type asteroid',
        'Mass': '2.5904 × 10²⁰ kg',
        'Dimensions': '578 × 560 × 458 km',
        'Discovery': '29 March 1807',
        'Discoverer': 'Heinrich Olbers',
        'Orbital Period': '3.629 years',
        'Composition': 'Basaltic rock',
        'Notable Feature': 'Rheasilvia crater',
        'Brightness': 'Brightest asteroid in night sky'
    },
    'Pallas': {
        'Type': 'F-type asteroid',
        'Mass': '2.11 × 10²⁰ kg',
        'Dimensions': '582 × 556 × 500 km',
        'Discovery': '28 March 1802',
        'Discoverer': 'Heinrich Wilhelm Olbers',
        'Orbital Period': '4.62 years',
        'Composition': 'Carbonaceous',
        'Inclination': '34.84° (highest)',
        'Notable Feature': 'Highly inclined orbit'
    },
    'Juno': {
        'Type': 'F/G-type asteroid',
        'Mass': '1.94 × 10²⁰ kg',
        'Dimensions': '350 × 290 × 280 km',
        'Discovery': '1 September 1804',
        'Discoverer': 'Karl Harding',
        'Orbital Period': '4.36 years',
        'Composition': 'Carbonaceous',
        'Spectral Type': 'F/G-type'
    },
    'Hebe': {
        'Type': 'Main-belt asteroid',
        'Mass': '1.19 × 10²⁰ kg',
        'Diameter': '225 km',
        'Discovery': '1 July 1847',
        'Discoverer': 'John Russell Hind',
        'Orbital Period': '3.49 years',
        'Composition': 'Ordinary chondrite',
        'Notable Feature': 'Parent body of meteorites'
    },
    'Eros': {
        'Type': 'S-type near-Earth asteroid',
        'Mass': '6.687 × 10¹⁵ kg',
        'Dimensions': '34 × 11 × 11 km',
        'Discovery': '13 August 1898',
        'Discoverer': 'Carl Gustav Witt',
        'Orbital Period': '1.761 years',
        'Shape': 'Peanut-shaped (irregular)',
        'Composition': 'Silicate and metal',
        'Notable Feature': 'First asteroid visited by spacecraft'
    },
    'Pluto': {
        'Type': 'Dwarf planet (Plutino)',
        'Mass': '1.309 × 10²² kg',
        'Radius': '1,188 km',
        'Orbital Period': '248.09 years',
        'Rotation Period': '6.39 days (retrograde)',
        'Discovery': '18 February 1930',
        'Discoverer': 'Clyde Tombaugh',
        'Natural Satellites': '5 moons',
        'Notable Feature': 'Heart-shaped region'
    },
    'Charon': {
        'Type': 'Moon of Pluto',
        'Mass': '1.586 × 10²¹ kg',
        'Radius': '603.5 km',
        'Orbital Period': '6.387 days',
        'Discovery': '22 June 1978',
        'Discoverer': 'James W. Christy',
        'Notable Feature': 'Binary system with Pluto',
        'Composition': 'Water ice, nitrogen ice',
        'Size Ratio': 'Half the size of Pluto'
    },
    'Eris': {
        'Type': 'Dwarf planet',
        'Classification': 'Plutino (trans-Neptunian)',
        'Mass': '1.66 × 10²² kg',
        'Radius': '1,163 km',
        'Orbital Period': '557 years',
        'Discovery': '5 January 2005',
        'Discoverers': 'Mike Brown, Chad Trujillo, David Rabinowitz',
        'Distance from Sun': '~96 AU',
        'Notable Feature': 'Most massive dwarf planet'
    },
    'Haumea': {
        'Type': 'Dwarf planet',
        'Classification': 'Trans-Neptunian object',
        'Mass': '4.006 × 10²¹ kg',
        'Dimensions': '2,332 × 1,155 km (ellipsoid)',
        'Orbital Period': '283.4 years',
        'Discovery': '6 December 2004',
        'Discoverers': 'Mike Brown, David Rabinowitz, Chad Trujillo',
        'Rotation': 'Very rapid (3.9 hours)',
        'Notable Feature': 'Extremely elongated shape'
    },
    'Makemake': {
        'Type': 'Dwarf planet',
        'Classification': 'Plutino (trans-Neptunian)',
        'Mass': '3.1 × 10²¹ kg',
        'Radius': '~738 km',
        'Orbital Period': '309.1 years',
        'Discovery': '31 March 2005',
        'Discoverers': 'Mike Brown, Chad Trujillo, David Rabinowitz',
        'Distance from Sun': '~45.5 AU',
        'Notable Feature': 'Large bright methane patches'
    },
    'Planet9': {
        'Type': 'Hypothetical trans-Neptunian planet',
        'Classification': 'Super-Earth or Mini-Neptune',
        'Estimated Mass': '5–10 Earth masses',
        'Orbital Period': '~10,000 years',
        'Semi-major Axis': '~400–800 AU',
        'Eccentricity': '0.25–0.50',
        'Discovered': 'Theorized in 2016',
        'Discoverers': 'Konstantin Batygin & Mike Brown',
        'Status': 'Unconfirmed (theoretical)',
        'Evidence': 'Unusual orbital clustering of TNOs',
        'Also Known As': 'Planet X'
    }
};

function fetchWikipediaInfobox(objectName) {
     const wikipediaTitle = wikipediaPages[objectName];
     if (!wikipediaTitle) {
         // Return fallback data if no Wikipedia mapping
         return Promise.resolve(fallbackInfoboxData[objectName] || null);
     }
     
     try {
         // Attempt to fetch from Wikipedia with timeout
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
         
         return fetch(
             `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(wikipediaTitle)}`,
             { signal: controller.signal }
         ).then(response => {
             clearTimeout(timeoutId);
             
             if (!response.ok) {
                 console.warn('Wikipedia returned status ' + response.status + ' for ' + objectName);
                 return fallbackInfoboxData[objectName] || null;
             }
             
             return response.text().then(html => {
                 // Parse the infobox from HTML
                 const parser = new DOMParser();
                 const doc = parser.parseFromString(html, 'text/html');
                 
                 // Look for infobox table with class "infobox"
                 const infobox = doc.querySelector('table.infobox');
                 if (!infobox) {
                     console.warn('No infobox found for ' + objectName + ', using fallback');
                     return fallbackInfoboxData[objectName] || null;
                 }
                 
                 const rows = infobox.querySelectorAll('tr');
                 const data = {};
                 
                 rows.forEach(row => {
                     try {
                         const cells = row.querySelectorAll('td, th');
                         if (cells.length >= 2) {
                             // Clone cells to get a clean copy for text extraction
                             const labelCell = cells[0].cloneNode(true);
                             const valueCell = cells[1].cloneNode(true);
                             
                             // Remove all style and script tags from cloned content
                             labelCell.querySelectorAll('style, script, sup.reference').forEach(el => el.remove());
                             valueCell.querySelectorAll('style, script, sup.reference').forEach(el => el.remove());
                             
                             // Extract visible text only (innerText shows rendered text, not CSS)
                             let label = labelCell.innerText.trim();
                             let value = valueCell.innerText.trim();
                             
                             // Clean up text with combined regex for better performance
                             const cleanText = (str) => str
                                 .replace(/\[\d+\]|\.[\w-]+\s*{[^}]*}/g, '') // Remove references and CSS in one pass
                                 .replace(/\s+/g, ' ')
                                 .trim();
                             
                             label = cleanText(label);
                             value = cleanText(value);
                             
                             // Single toLowerCase call for efficiency
                             const lowerLabel = label.toLowerCase();
                             const lowerValue = value.toLowerCase();
                             
                             // Skip empty values, image/file references, and CSS definitions
                             if (label && value && 
                                 label.length > 0 && 
                                 value.length > 0 && 
                                 value.length < 500 &&
                                 !lowerLabel.includes('image') &&
                                 !lowerLabel.includes('file') &&
                                 !lowerLabel.includes('.mw-') &&
                                 !lowerLabel.includes('plainlist') &&
                                 !lowerValue.startsWith('file:') &&
                                 !value.includes('{') &&
                                 !value.includes('}')) {
                                 
                                 data[label] = value;
                             }
                         }
                     } catch (e) {
                         // Skip rows that cause parsing errors
                         console.debug('Error parsing infobox row for ' + objectName + ':', e);
                     }
                 });
                 
                 // Return Wikipedia data if we got some, otherwise fallback
                 const dataLength = Object.keys(data).length;
                 if (dataLength > 0) {
                     console.log('[OK] Successfully fetched ' + dataLength + ' fields from Wikipedia for ' + objectName);
                     return data;
                 } else {
                     console.warn('Parsed infobox but got no useful data for ' + objectName + ', using fallback');
                     return fallbackInfoboxData[objectName] || null;
                 }
             });
         }).catch(error => {
             console.warn('Could not fetch Wikipedia data for ' + objectName + ':', error.message);
             // Return fallback data on any error
             return fallbackInfoboxData[objectName] || null;
         });
     } catch (error) {
         console.warn('Could not fetch Wikipedia data for ' + objectName + ':', error.message);
         // Return fallback data on any error
         return Promise.resolve(fallbackInfoboxData[objectName] || null);
     }
}

const focusLabel = document.getElementById('focus-label');
const infoboxContainer = document.getElementById('infobox-container');
const infoboxTitleText = document.getElementById('infobox-title-text');
const infoboxContent = document.getElementById('infobox-content');
const infoboxClose = document.getElementById('infobox-close');
const infoboxMinimize = document.getElementById('infobox-minimize');

function displayInfobox(objectName) {
     infoboxContent.innerHTML = '<div class="infobox-loading">[Loading...] Fetching data from Wikipedia...</div>';
    infoboxContainer.style.display = 'block';
    infoboxContainer.classList.remove('minimized');
    
    // Convert internal names to display names for user-friendly output
    let displayName = objectName;
    if (objectName === 'Planet9') displayName = 'Planet Nine';
    
    // Ttitle with object name and Wikipedia link
    const wikipediaTitle = wikipediaPages[objectName];
    const wikipediaURL = wikipediaTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikipediaTitle)}` : '#';
     const linkElement = wikipediaTitle ? 
         `<a href="${wikipediaURL}" target="_blank" style="color: #f1c40f; text-decoration: none; cursor: pointer;">${displayName} 🔗 </a>` :
         displayName;
    infoboxTitleText.innerHTML = linkElement;
    
     fetchWikipediaInfobox(objectName).then(data => {
         if (data && Object.keys(data).length > 0) {
             let htmlRows = [];
             let count = 0;
            
             // Show all data points retrieved - use array join for performance
             for (let key in data) {
                 // Sanitize key and value to prevent HTML injection
                 const safeKey = String(key).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                 const safeValue = String(data[key]).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                 
                 htmlRows.push(`<div class="infobox-row">
                     <div class="infobox-label">${safeKey}:</div>
                     <div class="infobox-value">${safeValue}</div>
                 </div>`);
                 count++;
             }
             
             infoboxContent.innerHTML = htmlRows.join('');
             console.log('[OK] Displayed ' + count + ' infobox fields for ' + objectName);
         } else {
             const source = fallbackInfoboxData[objectName] ? 'fallback' : 'unavailable';
             const message = source === 'fallback' ? 
                 '[WARNING] Using basic information (Wikipedia unavailable)' : 
                 '[ERROR] No infobox data available for this object';
             infoboxContent.innerHTML = `<div class="infobox-error">${message}</div>`;
         }
     }).catch(err => {
         console.error('Error displaying infobox:', err);
         infoboxContent.innerHTML = '<div class="infobox-error">[ERROR] Error loading data</div>';
     });
}

// Event listeners for infobox controls
infoboxClose.addEventListener('click', () => {
    infoboxContainer.style.display = 'none';
});

infoboxMinimize.addEventListener('click', () => {
    infoboxContainer.classList.toggle('minimized');
    // Update minimize button text
    infoboxMinimize.textContent = infoboxContainer.classList.contains('minimized') ? '+' : '−';
});

// Auto minimize infobox when not hovering (independent of control panel)
(function setupInfoboxAutoMinimize() {
    // Don't auto-minimize on touch devices where hover isn't meaningful
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    if (!infoboxContainer || isTouch) return;

    let hideTimeout = null;
    const HIDE_DELAY = 1400; // ms

    const minimize = () => infoboxContainer.classList.add('minimized');
    const expand = () => infoboxContainer.classList.remove('minimized');

    infoboxContainer.addEventListener('mouseenter', () => {
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        expand();
    });
    infoboxContainer.addEventListener('mouseleave', () => {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(minimize, HIDE_DELAY);
    });

    // Also expand when any child receives focus (keyboard navigation)
    infoboxContainer.addEventListener('focusin', () => { if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; } expand(); });
    infoboxContainer.addEventListener('focusout', () => { if (hideTimeout) clearTimeout(hideTimeout); hideTimeout = setTimeout(minimize, HIDE_DELAY); });

    // Start minimized so it unobtrusively sits while the user explores the scene
    minimize();
})();

// Update infobox when focus changes
focusSelect.addEventListener('change', e => {
    if (e.target.value !== 'free') {
        displayInfobox(e.target.value);
    } else {
        infoboxContainer.style.display = 'none';
    }
});

// ═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════

// Setup raycasting for hover labels
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const hoverLabel = document.getElementById('hover-label');

// Raycasting: collect mesh targets for hover labels. Using individual meshes
// avoids any dependency on layer masks that are toggled for focused systems.
const celestialMeshes = [];
const objectToNameMap = {};

function rebuildCelestialMeshes() {
    celestialMeshes.length = 0;
    for (let k in objectToNameMap) delete objectToNameMap[k];

    // Sun meshes
    sunMesh.traverse(node => { if (node.isMesh) { celestialMeshes.push(node); objectToNameMap[node.uuid] = 'Sun'; } });

    // Planets
    for (let name in planets) {
        planets[name].group.traverse(node => { if (node.isMesh) { celestialMeshes.push(node); objectToNameMap[node.uuid] = name; } });
    }

    // Satellites
    for (let name in satBodies) {
        satBodies[name].group.traverse(node => { if (node.isMesh) { celestialMeshes.push(node); objectToNameMap[node.uuid] = name; } });
    }
}

// Build initial mesh list. Later when GLB models load we call rebuildCelestialMeshes().
rebuildCelestialMeshes();

document.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Temporarily set raycaster to see all layers for hover detection
    const originalLayers = raycaster.layers.mask;
    raycaster.layers.enableAll();
    
    const intersects = raycaster.intersectObjects(celestialMeshes, true);
    
    // Restore raycaster layer filter
    raycaster.layers.mask = originalLayers;
    
    let hoveredLabel = null;
    if (intersects.length > 0) {
        for (let intersection of intersects) {
            const hit = intersection.object;
            if (objectToNameMap[hit.uuid]) { hoveredLabel = objectToNameMap[hit.uuid]; break; }
            let cur = hit.parent;
            while (cur) { if (objectToNameMap[cur.uuid]) { hoveredLabel = objectToNameMap[cur.uuid]; break; } cur = cur.parent; }
            if (hoveredLabel) break;
        }
    }

    if (hoveredLabel) {
        const displayLabel = (hoveredLabel === 'Planet9') ? 'Planet Nine' : hoveredLabel;
        hoverLabel.textContent = displayLabel;
        hoverLabel.style.display = 'block';
        hoverLabel.style.left = (event.clientX + 15) + 'px';
        hoverLabel.style.top = (event.clientY - 20) + 'px';
    } else {
        hoverLabel.style.display = 'none';
    }
});

function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const deltaSec = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    
    const speedFactor = parseFloat(speedSlider.value);
    simDays += speedFactor * deltaSec;
    
    // Update planets
    for (let name in KEPLER) {
        const p = planets[name];
        p.group.position.copy(scaleAU(getCartesianAU(KEPLER[name], simDays)));
        p.mesh.rotation.y += p.selfRot * deltaSec * 30; 
    }

    // Update Sun rotation so it reflects simulation time (accurate axial rotation)
    if (typeof sunInner !== 'undefined' && sunInner) {
        // Compute rotation angle from simulation days and Sun's rotation period
        const sunAngle = (simDays % sunData.period) * (2 * Math.PI / sunData.period);
        sunInner.rotation.y = sunAngle;
    }
    
    // Update satellites & Tidal locking
    for (let name in SATELLITES) {
         const { group, mesh, sat } = satBodies[name];
         const parentPos = planets[sat.parent].group.position;
         const offset = getSatelliteOffset(sat, simDays);
         
         group.position.set(parentPos.x + offset.x, parentPos.y + offset.y, parentPos.z + offset.z);
         
         if (sat.tidallyLocked) {
             // To remain tidally locked, the satellite's local -Z axis (center of texture)
             // should point towards the parent body. Since the group is already translated 
             // to the satellite's position, we just rotate the mesh to look back at the origin (-offset)
             mesh.rotation.y = Math.atan2(offset.x, offset.z);
             mesh.rotation.z = 0; // Ensure Z rotation is zeroed for mesh
         } else {
             mesh.rotation.y += sat.selfRot * deltaSec * 30;
             mesh.rotation.z = 0; // Keep mesh Z rotation at zero
         }
     }
    
    if (moonOrbToggle.checked) {
        moonOrbitObjs.forEach(({ line, sat }) => {
            if (line.visible) updateMoonOrbitRing(line, sat, planets[sat.parent].group.position);
        });
    }
    
    const dispDate = new Date(J2000 + simDays * 86400000);
    dateDisplay.textContent = ' 📅 ' + dispDate.toDateString();
    if (document.activeElement !== dateInput) dateInput.value = dispDate.toISOString().split('T')[0];
    
    // GEO-STATIONARY FOCUS TRACKING (Moves camera with target)
    if (focusTarget !== 'free') {
        let targetObj = null;
        let newSystem = null; // Found system logic root
        if (focusTarget === 'Sun') { targetObj = sunMesh; }
        else if (planets[focusTarget]) { targetObj = planets[focusTarget].group; newSystem = focusTarget; }
        else if (satBodies[focusTarget]) { targetObj = satBodies[focusTarget].group; newSystem = satBodies[focusTarget].sat.parent; }
        
        // Pluck the focused system off the standard lighting map and into Layer 1 (HD Sun shadow layer)
        if (newSystem !== currentFocusedSystem) {
            if (currentFocusedSystem) setSystemLayer(currentFocusedSystem, 0); // Restore Old
            if (newSystem) setSystemLayer(newSystem, 1); // Promote New!
            currentFocusedSystem = newSystem;
        }
        
        if (targetObj) {
            // Update world position EVERY frame so camera properly tracks moving bodies
            targetObj.getWorldPosition(_cachedWorldPos);
            const wp = _cachedWorldPos;
           
            // Track PCF Light direction precisely over planet system radius, condensing shadow resolution!
            if(currentFocusedSystem) {
                const sysPos = planets[currentFocusedSystem].group.position;
                const maxShadowDist = Math.max(sysPos.length(), 0.1); 
                eclipseLight.target.position.copy(sysPos);
                
                // Only update shadow camera when system changes (not every frame)
                if (newSystem !== currentFocusedSystem || !currentTargetObj) {
                    const sysRadius = 25; // Large enough for Jupiter's vast moons
                    eclipseLight.shadow.camera.left = -sysRadius;
                    eclipseLight.shadow.camera.right = sysRadius;
                    eclipseLight.shadow.camera.top = sysRadius;
                    eclipseLight.shadow.camera.bottom = -sysRadius;
                    eclipseLight.shadow.camera.near = Math.max(0.1, maxShadowDist - sysRadius);
                    eclipseLight.shadow.camera.far = maxShadowDist + sysRadius;
                    eclipseLight.shadow.camera.updateProjectionMatrix();
                }
            }
            
            if (currentTargetObj !== targetObj) {
                // Snapping to new target
                controls.target.copy(wp);
                
                let targetSize = 5.2; // Sun
                if (planets[focusTarget]) targetSize = KEPLER[focusTarget].size;
                else if (satBodies[focusTarget]) targetSize = SATELLITES[focusTarget].size;
                
                // Calculate distance so object fills screen (30% padding)
                const fovRad = THREE.MathUtils.degToRad(camera.fov / 2);
                const fillScreenDist = targetSize / Math.sin(fovRad);
                const optimalDist = fillScreenDist * 1.3;
                
                const currentOffset = camera.position.clone().sub(wp);
                if (currentOffset.length() > 0.1) {
                    currentOffset.normalize().multiplyScalar(optimalDist);
                    camera.position.copy(wp.clone().add(currentOffset));
                } else {
                    camera.position.copy(wp.clone().add(new THREE.Vector3(0, optimalDist * 0.3, optimalDist)));
                }
                // set zoom/clamp limits based on the target size to prevent camera penetrating the surface
                const minAllowed = Math.max(0.5, fillScreenDist * 1.05);
                controls.minDistance = minAllowed;
                // allow zooming out far to see moon orbits
                controls.maxDistance = Math.max(1000, optimalDist * 100);
                
                currentTargetObj = targetObj;
                // mark that we're in focused mode so free-roam reset will happen only on transition back
                controls._resetToFree = false;
                targetObj.userData.lastPos = wp.clone();
            } else {
                // Following existing target frame by frame
                const delta = wp.clone().sub(targetObj.userData.lastPos);
                camera.position.add(delta); // offset camera by exact amount planet moved
                controls.target.copy(wp);
                targetObj.userData.lastPos.copy(wp);
            }
        }
    } else {
        currentTargetObj = null;
        if (currentFocusedSystem) {
            setSystemLayer(currentFocusedSystem, 0);
            currentFocusedSystem = null;
        }

        // ALWAYS enforce initial zoom limits while in free roam
        controls.minDistance = INITIAL_MIN_DISTANCE;
        controls.maxDistance = INITIAL_MAX_DISTANCE;

        // reset camera & control limits once when switching back to free-roam
        if (!controls._resetToFree) {
            // also restore the camera far plane so distant objects are rendered
            camera.far = 12000;
            camera.updateProjectionMatrix();

            // mark reset performed
            controls._resetToFree = true;
        }
    }
    
    controls.update();

    // Clamp camera distance so it never goes inside the focused object
    try {
        const toTarget = camera.position.clone().sub(controls.target);
        const dist = toTarget.length();
        const minD = (typeof controls.minDistance === 'number') ? controls.minDistance : 0.5;
        if (dist < minD && dist > 1e-6) {
            toTarget.normalize().multiplyScalar(minD);
            camera.position.copy(controls.target.clone().add(toTarget));
        }
    } catch (e) {
        // ignore
    }

    // Continually sync camera focal length so Anaglyph 3D eyes don't cross over when zooming closely
    camera.focus = Math.max(camera.position.distanceTo(controls.target), 1.0);

    // Render using Anaglyph effect when enabled and available
    if (anaglyphToggle && anaglyphToggle.checked && anaglyphEffect) {
        anaglyphEffect.render(scene, camera);
    } else {
        renderer.render(scene, camera);
    }
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (anaglyphEffect) anaglyphEffect.setSize(window.innerWidth, window.innerHeight);
});

speedVal.textContent = speedSlider.value + ' days/s';
