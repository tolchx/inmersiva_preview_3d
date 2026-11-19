import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const ROOM_CONFIG = { width: 24.45, depth: 8, height: 6 };
const DEMO_VIDEO_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const PIXELMAP_BASE_URL = "pixelmap/";
const WALL_FALLBACK_SOURCES = {
    corrientes: `${PIXELMAP_BASE_URL}Corrientes.png`,
    sarmiento: `${PIXELMAP_BASE_URL}Sarmiento.png`,
    piso: `${PIXELMAP_BASE_URL}Piso.png`,
    alem: `${PIXELMAP_BASE_URL}Alem.png`,
    bouchard: `${PIXELMAP_BASE_URL}Bouchard.png`
};

const wallFallbackImages = {};
let wallFallbackImagesPromise = null;

const DEFAULT_WALLS = {
    'corrientes': { index: 5, label: 'Corrientes', repX: 1, repY: 1, rot: 0, mirrorS: false, mirrorT: false, flipX: true, flipY: false },
    'sarmiento':  { index: 4, label: 'Sarmiento', repX: 1, repY: 1, rot: 0, mirrorS: false, mirrorT: false, flipX: true, flipY: false },
    'techo':      { index: 2, label: 'Techo',      repX: 1, repY: 1, rot: 0, mirrorS: false, mirrorT: false, flipX: false, flipY: false },
    'piso':       { index: 3, label: 'Piso',       repX: 1, repY: 1, rot: Math.PI * 1.5, mirrorS: false, mirrorT: false, flipX: true, flipY: false },
    'alem':       { index: 1, label: 'Alem',       repX: 1, repY: 1, rot: 0, mirrorS: false, mirrorT: false, flipX: false, flipY: false },
    'bouchard':   { index: 0, label: 'Bouchard',   repX: 1, repY: 1, rot: 0, mirrorS: false, mirrorT: false, flipX: true, flipY: false }
};

let WALLS = JSON.parse(JSON.stringify(DEFAULT_WALLS));
let camera, scene, renderer;
let orbitControls, fpsControls;
let roomMesh, pasarelaMesh, labelGroup;
let video;
let textures = [];
let wallCanvases = {};
const slotVideos = {};
const wallOverrides = {};
let isFPSMode = false;
let labelsVisible = false;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let recordCanvas;
let recordCanvasCtx;
let recordAnimationId = 0;
let activeRecordMimeType = 'video/webm';
const RECORD_SETTINGS_STORAGE_KEY = 'recSettings';
const DEFAULT_REC_SETTINGS = { codec: 'auto', resolution: 'auto', aspect: 'source' };
let recSettings = { ...DEFAULT_REC_SETTINGS };
let syncedAudio = null;
let syncedAudioUrl = null;
let syncState = 'stop';
const SYNC_AUDIO_VOLUME_KEY = 'syncAudioVolume';
let syncAudioVolume = 1;
const PREVIEW_MODE_KEY = 'previewMode';
let previewMode = 'grid';
const PERF_MODE_KEY = 'perfMode';
let perfModeSetting = 'auto'; // 'auto' | 'fluid' | 'high'
let effectiveFluidMode = false;
const wallRenderState = {};

let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();

let isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 900;
let joystickActive = false;
let joyStart = {x:0, y:0};
let joyMove = {x:0, y:0};
let touchLookPrev = {x:0, y:0};

let cameraGroup;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let hand1, hand2;
let raycaster, marker;
let intersection = null;

function preloadWallFallbackImages() {
    if (wallFallbackImagesPromise) return wallFallbackImagesPromise;
    const entries = Object.entries(WALL_FALLBACK_SOURCES);
    wallFallbackImagesPromise = Promise.all(entries.map(([wallKey, src]) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ wallKey, img, ok: true });
            img.onerror = () => resolve({ wallKey, img: null, ok: false });
            img.src = src;
        });
    })).then((results) => {
        results.forEach(r => { if (r.ok) wallFallbackImages[r.wallKey] = r.img; });
        return wallFallbackImages;
    });
    return wallFallbackImagesPromise;
}

function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const imgAspect = iw / ih;
    const dstAspect = dw / dh;
    let sx = 0, sy = 0, sw = iw, sh = ih;
    if (imgAspect > dstAspect) {
        sw = ih * dstAspect;
        sx = (iw - sw) / 2;
    } else {
        sh = iw / dstAspect;
        sy = (ih - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawImageContain(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.min(dw / iw, dh / ih);
    const tw = iw * scale;
    const th = ih * scale;
    const tx = dx + (dw - tw) / 2;
    const ty = dy + (dh - th) / 2;
    ctx.drawImage(img, tx, ty, tw, th);
}

function init() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 15, 25);
    camera.rotation.order = 'YXZ';

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    cameraGroup = new THREE.Group();
    scene.add(cameraGroup);
    cameraGroup.add(camera);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    labelGroup = new THREE.Group();
    labelGroup.visible = false;
    scene.add(labelGroup);

    createImmersiveRoom();
    setupControls();
    setupVRControls();

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    const gridOverlay = document.getElementById('grid-overlay');
    const gridClose = document.getElementById('grid-close');
    if (gridClose) gridClose.addEventListener('click', window.hideGrid);
    if (gridOverlay) {
        gridOverlay.addEventListener('click', (e) => {
            if (e.target === gridOverlay) window.hideGrid();
        });
    }

    const gridEditorClose = document.getElementById('grid-editor-close');
    const gridUrlApply = document.getElementById('grid-url-apply');
    const gridRestore = document.getElementById('grid-restore');
    const gridFileInput = document.getElementById('grid-file-input');
    if (gridEditorClose) gridEditorClose.addEventListener('click', window.hideGridEditor);
    if (gridUrlApply) gridUrlApply.addEventListener('click', window.applyGridUrl);
    if (gridRestore) gridRestore.addEventListener('click', window.restoreGridWall);
    if (gridFileInput) {
        gridFileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            window.applyGridFile(file);
            e.target.value = '';
        });
    }

    document.getElementById('btn-toggle-labels').addEventListener('click', toggleLabels);
    document.getElementById('btn-record').addEventListener('click', toggleRecording);
    const btnRecordUser = document.getElementById('btn-record-user');
    if (btnRecordUser) btnRecordUser.addEventListener('click', toggleRecording);

    safeLoadRecSettings();
    initRecSettingsUI();
    const btnRecSettingsUser = document.getElementById('btn-rec-settings-user');
    const btnRecSettingsAdmin = document.getElementById('btn-rec-settings-admin');
    if (btnRecSettingsUser) btnRecSettingsUser.addEventListener('click', showRecSettings);
    if (btnRecSettingsAdmin) btnRecSettingsAdmin.addEventListener('click', showRecSettings);
    const recOverlay = document.getElementById('rec-settings-overlay');
    const recClose = document.getElementById('rec-settings-close');
    const recSave = document.getElementById('rec-settings-save');
    const recReset = document.getElementById('rec-settings-reset');
    if (recClose) recClose.addEventListener('click', hideRecSettings);
    if (recOverlay) {
        recOverlay.addEventListener('click', (e) => {
            if (e.target === recOverlay) hideRecSettings();
        });
    }
    if (recSave) recSave.addEventListener('click', saveRecSettingsFromUI);
    if (recReset) recReset.addEventListener('click', resetRecSettingsUI);

    const btnSyncPlay = document.getElementById('btn-sync-play');
    const btnSyncPause = document.getElementById('btn-sync-pause');
    const btnSyncStop = document.getElementById('btn-sync-stop');
    if (btnSyncPlay) btnSyncPlay.addEventListener('click', syncPlay);
    if (btnSyncPause) btnSyncPause.addEventListener('click', syncPause);
    if (btnSyncStop) btnSyncStop.addEventListener('click', syncStop);

    const audioUpload = document.getElementById('audio-upload');
    if (audioUpload) {
        audioUpload.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            loadSyncedAudioFromFile(file);
            e.target.value = '';
        });
    }
    const audioVolumeSlider = document.getElementById('audio-volume-slider');
    try {
        const saved = parseFloat(localStorage.getItem(SYNC_AUDIO_VOLUME_KEY) || '1');
        if (Number.isFinite(saved)) syncAudioVolume = Math.max(0, Math.min(1, saved));
    } catch {}
    if (audioVolumeSlider) {
        audioVolumeSlider.value = String(syncAudioVolume);
        audioVolumeSlider.addEventListener('input', (e) => {
            const next = parseFloat(e.target.value);
            if (!Number.isFinite(next)) return;
            syncAudioVolume = Math.max(0, Math.min(1, next));
            if (syncedAudio) syncedAudio.volume = syncAudioVolume;
            try { localStorage.setItem(SYNC_AUDIO_VOLUME_KEY, String(syncAudioVolume)); } catch {}
        });
    }

    const btnPreviewMode = document.getElementById('btn-preview-mode');
    if (btnPreviewMode) btnPreviewMode.addEventListener('click', togglePreviewMode);
    try {
        const savedMode = (localStorage.getItem(PREVIEW_MODE_KEY) || '').toLowerCase();
        if (savedMode === 'demo' || savedMode === 'grid') previewMode = savedMode;
    } catch {}
    applyPreviewMode(previewMode);
    updateSyncButtonsVisual();

    const volSlider = document.getElementById('volume-slider');
    video.volume = 0.3;
    volSlider.addEventListener('input', (e) => { 
        video.volume = e.target.value; 
        if (video.volume > 0) video.muted = false;
    });

    const loader = document.getElementById('loader');
    const showReady = () => {
        document.getElementById('canvas-container').style.opacity = 1;
        loader.style.display = 'none';
    };

    const hasInitialVideo = !!(video.getAttribute('src') && video.getAttribute('src').trim().length);
    preloadWallFallbackImages().finally(() => {
        if (!hasInitialVideo) showReady();
    });

    if (!hasInitialVideo) return;

    const errorHandler = () => {
        if (!video.error) return;
        if (video.error.code === 1) return;

        console.error("Video Error Code:", video.error.code);
        console.error("Video Error Details:", video.error.message || "Sin detalles");

        let msg = "ERROR: VIDEO NO DISPONIBLE";
        if(video.error.code === 4) msg = "BLOQUEO DE SEGURIDAD (CORS) O NO ENCONTRADO";
        
        loader.innerHTML = `
            <div class='error-msg'>
                <strong style="font-size:16px">${msg}</strong><br><br>
                El servidor bloqueó el acceso o el archivo no existe.<br><br>
                <button id="btn-fallback" class="btn-fallback">CARGAR VIDEO DEMO</button>
            </div>`;
        
        const fallbackBtn = document.getElementById('btn-fallback');
        if(fallbackBtn) {
            fallbackBtn.addEventListener('click', () => {
                loadNativeVideo(DEMO_VIDEO_URL);
            });
        }
    };
    video.addEventListener('error', errorHandler);

    setTimeout(() => {
        video.muted = true; 
        const playPromise = video.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                showReady();
                console.log("Reproduciendo correctamente.");
            }).catch(error => {
                if (error.name === 'AbortError') return;

                console.warn("Autoplay:", error);
                if(!video.error) {
                    loader.innerText = "TOCA PARA INICIAR";
                    document.body.addEventListener('click', () => {
                        video.play().then(() => {
                            showReady();
                        });
                    }, { once: true });
                }
            });
        }
    }, 500);
}

function forEachSyncedMedia(fn) {
    fn(video);
    Object.values(slotVideos).forEach(v => fn(v));
    Object.values(wallOverrides).forEach(ov => { if (ov?.kind === 'video') fn(ov.media); });
}

function updateSyncButtonsVisual() {
    const playBtn = document.getElementById('btn-sync-play');
    const pauseBtn = document.getElementById('btn-sync-pause');
    const stopBtn = document.getElementById('btn-sync-stop');
    const audioBtn = document.getElementById('btn-audio-upload');
    if (playBtn) playBtn.classList.toggle('active', syncState === 'play');
    if (pauseBtn) pauseBtn.classList.toggle('active', syncState === 'pause');
    if (stopBtn) stopBtn.classList.toggle('active', syncState === 'stop');
    if (audioBtn) audioBtn.classList.toggle('active-audio', !!syncedAudio && !!syncedAudio.src);
}

function invalidateWallCache() {
    Object.keys(wallRenderState).forEach((k) => { delete wallRenderState[k]; });
}

function getAllActiveVideos() {
    const list = [];
    const seen = new Set();
    forEachSyncedMedia((m) => {
        if (m && m instanceof HTMLVideoElement && m.src && !seen.has(m)) {
            seen.add(m);
            list.push(m);
        }
    });
    return list;
}

function seekVideoFast(v, targetTime) {
    return new Promise((resolve) => {
        if (!v || v.readyState < 1) { resolve(); return; }
        if (Math.abs((v.currentTime || 0) - targetTime) < 0.03) { resolve(); return; }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            v.removeEventListener('seeked', finish);
            resolve();
        };
        v.addEventListener('seeked', finish, { once: true });
        try { v.currentTime = targetTime; } catch { finish(); }
        setTimeout(finish, 350);
    });
}

window.launchAllVideosSynced = async function(fromZero = true) {
    const videos = getAllActiveVideos();
    const targetTime = fromZero ? 0 : (video?.src ? (video.currentTime || 0) : (videos[0]?.currentTime || 0));

    videos.forEach((v) => { try { v.pause(); } catch {} });
    if (syncedAudio) { try { syncedAudio.pause(); } catch {} }

    await Promise.all(videos.map((v) => seekVideoFast(v, targetTime)));
    if (syncedAudio && syncedAudio.src) {
        try { syncedAudio.currentTime = targetTime; } catch {}
    }

    syncState = 'play';
    if (previewMode !== 'demo' && videos.length > 0) {
        applyPreviewMode('demo');
    }

    videos.forEach((v) => {
        try {
            const p = v.play();
            if (p?.catch) p.catch(() => {});
        } catch {}
    });
    if (syncedAudio && syncedAudio.src) {
        try {
            const p = syncedAudio.play();
            if (p?.catch) p.catch(() => {});
        } catch {}
    }

    invalidateWallCache();
    renderWallCanvases(true);
    updateSyncButtonsVisual();
};

function syncPlay() {
    window.launchAllVideosSynced(false);
}

function applyPerformanceResolution(isFluid) {
    effectiveFluidMode = !!isFluid;
    const scale = effectiveFluidMode ? 0.5 : 1;
    Object.keys(wallCanvases).forEach((idx) => {
        const wc = wallCanvases[idx];
        if (!wc || !wc.baseWidth || !wc.baseHeight) return;
        const targetW = Math.max(256, Math.round(wc.baseWidth * scale));
        const targetH = Math.max(128, Math.round(wc.baseHeight * scale));
        if (wc.canvas.width !== targetW || wc.canvas.height !== targetH) {
            wc.canvas.width = targetW;
            wc.canvas.height = targetH;
        }
        const tex = textures[Number(idx)];
        if (tex) {
            tex.anisotropy = effectiveFluidMode ? 2 : Math.min(8, renderer.capabilities.getMaxAnisotropy());
            tex.needsUpdate = true;
        }
    });
    if (renderer) {
        const targetPR = effectiveFluidMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
        if (renderer.getPixelRatio() !== targetPR) {
            renderer.setPixelRatio(targetPR);
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }
    invalidateWallCache();
    renderWallCanvases(true);
}

function evaluateAutoPerformanceMode() {
    const label = document.getElementById('perf-mode-label');
    const btn = document.getElementById('btn-perf-mode');
    if (perfModeSetting === 'fluid') {
        if (label) label.textContent = 'Activo';
        if (btn) btn.classList.add('active');
        applyPerformanceResolution(true);
        return;
    }
    if (perfModeSetting === 'high') {
        if (label) label.textContent = 'Alta Calidad';
        if (btn) btn.classList.remove('active');
        applyPerformanceResolution(false);
        return;
    }
    const activeVids = getAllActiveVideos();
    const hasHeavy = activeVids.length >= 2 || activeVids.some((v) => (v.videoWidth || 0) >= 2560);
    if (label) label.textContent = hasHeavy ? 'Auto (Fluido)' : 'Auto';
    if (btn) btn.classList.toggle('active', hasHeavy);
    applyPerformanceResolution(hasHeavy);
}

window.togglePerformanceMode = function() {
    if (perfModeSetting === 'auto') perfModeSetting = 'fluid';
    else if (perfModeSetting === 'fluid') perfModeSetting = 'high';
    else perfModeSetting = 'auto';
    try { localStorage.setItem(PERF_MODE_KEY, perfModeSetting); } catch {}
    evaluateAutoPerformanceMode();
};

function syncPause() {
    syncState = 'pause';
    forEachSyncedMedia((m) => {
        if (!m || !(m instanceof HTMLVideoElement)) return;
        try { m.pause(); } catch {}
    });
    if (syncedAudio) {
        try { syncedAudio.pause(); } catch {}
    }
    updateSyncButtonsVisual();
}

function syncStop() {
    syncState = 'stop';
    forEachSyncedMedia((m) => {
        if (!m || !(m instanceof HTMLVideoElement)) return;
        try { m.pause(); m.currentTime = 0; } catch {}
    });
    if (syncedAudio) {
        try { syncedAudio.pause(); syncedAudio.currentTime = 0; } catch {}
    }
    updateSyncButtonsVisual();
}

function updatePreviewModeButton() {
    const btn = document.getElementById('btn-preview-mode');
    const label = document.getElementById('preview-mode-label');
    if (btn) btn.classList.toggle('active', previewMode === 'demo');
    if (label) label.textContent = (previewMode === 'demo') ? 'Grilla' : 'Demo';
}

function togglePreviewMode() {
    applyPreviewMode(previewMode === 'demo' ? 'grid' : 'demo');
}

function applyPreviewMode(nextMode) {
    previewMode = (nextMode === 'demo') ? 'demo' : 'grid';
    try { localStorage.setItem(PREVIEW_MODE_KEY, previewMode); } catch {}
    updatePreviewModeButton();
    renderWallCanvases();
    refreshGrid();
}

function loadSyncedAudioFromFile(file) {
    try {
        const name = (file?.name || '').toLowerCase();
        const type = (file?.type || '').toLowerCase();
        const looksLikeAudio = type.startsWith('audio/') || /\.(wav|wave|mp3|ogg|m4a|aac|flac)$/.test(name);
        if (!looksLikeAudio) {
            alert("Formato de audio no soportado. Usá WAV, MP3, OGG, M4A, AAC o FLAC.");
            return;
        }

        if (syncedAudioUrl) URL.revokeObjectURL(syncedAudioUrl);
        const url = URL.createObjectURL(file);
        syncedAudioUrl = url;
        if (!syncedAudio) {
            syncedAudio = document.createElement('audio');
            syncedAudio.preload = 'auto';
            syncedAudio.crossOrigin = 'anonymous';
        }
        syncedAudio.volume = syncAudioVolume;
        syncedAudio.src = url;
        syncedAudio.load();

        syncedAudio.oncanplaythrough = () => {
            console.log("Audio sincronizado cargado:", file.name);
            updateSyncButtonsVisual();
        };
        syncedAudio.onerror = () => {
            alert("No se pudo cargar el audio. Probá con otro archivo WAV/MP3.");
            updateSyncButtonsVisual();
        };
    } catch {
        alert("Error al cargar el audio.");
        updateSyncButtonsVisual();
    }
}

window.loadNativeVideo = function(url) {
    video.src = url;
    video.muted = false;

    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerHTML = "CARGANDO VIDEO...";
    
    video.play().then(() => { 
        console.log("Carga exitosa: " + url);
        loader.style.display = 'none';
    }).catch(e => { 
        if (e.name === 'AbortError') {
            console.log("Carga anterior cancelada (Normal al cambiar rapido).");
            return; 
        }
        
        console.error("Error reproduciendo:", e);
        if (e.name === "NotAllowedError") {
             loader.innerHTML = "TOCA PARA INICIAR";
             document.body.addEventListener('click', () => { video.play(); }, { once: true });
        }
    });
};

function initMobileControls() {
    const joyArea = document.getElementById('joystick-area');
    const joyKnob = document.getElementById('joystick-knob');
    const lookArea = document.getElementById('look-area');

    joyArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        joystickActive = true;
        const touch = e.touches[0];
        const rect = joyArea.getBoundingClientRect();
        joyStart.x = rect.left + rect.width / 2;
        joyStart.y = rect.top + rect.height / 2;
        updateJoystick(touch.clientX, touch.clientY);
    });

    joyArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if(!joystickActive) return;
        const touch = e.touches[0];
        updateJoystick(touch.clientX, touch.clientY);
    });

    const endJoystick = (e) => {
        e.preventDefault();
        joystickActive = false;
        joyMove = {x:0, y:0};
        joyKnob.style.transform = `translate(0px, 0px)`;
    };
    joyArea.addEventListener('touchend', endJoystick);
    joyArea.addEventListener('touchcancel', endJoystick);

    function updateJoystick(clientX, clientY) {
        const maxDist = 35; 
        let dx = clientX - joyStart.x;
        let dy = clientY - joyStart.y;
        const distance = Math.min(Math.sqrt(dx*dx + dy*dy), maxDist);
        const angle = Math.atan2(dy, dx);
        
        const vizX = Math.cos(angle) * distance;
        const vizY = Math.sin(angle) * distance;
        joyKnob.style.transform = `translate(${vizX}px, ${vizY}px)`;

        joyMove.x = vizX / maxDist;
        joyMove.y = vizY / maxDist;
    }

    lookArea.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.touches.length; i++) {
            const t = e.touches[i];
            if (t.clientX > window.innerWidth / 2) {
                touchLookPrev.x = t.clientX;
                touchLookPrev.y = t.clientY;
                break; 
            }
        }
    });

    lookArea.addEventListener('touchmove', (e) => {
        e.preventDefault(); 
        if (!isFPSMode) return;
        
        let targetTouch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].clientX > window.innerWidth / 2) {
                targetTouch = e.touches[i];
                break;
            }
        }
        
        if (targetTouch) {
            const dx = targetTouch.clientX - touchLookPrev.x;
            const dy = targetTouch.clientY - touchLookPrev.y;
            const sensitivity = 0.003; 
            camera.rotation.y -= dx * sensitivity;
            camera.rotation.x -= dy * sensitivity;
            camera.rotation.x = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, camera.rotation.x));
            touchLookPrev.x = targetTouch.clientX;
            touchLookPrev.y = targetTouch.clientY;
        }
    });
}

function createImmersiveRoom() {
    video = document.getElementById('video');
    
    const wallKeyByIndex = {};
    Object.keys(DEFAULT_WALLS).forEach((key) => {
        wallKeyByIndex[DEFAULT_WALLS[key].index] = key;
    });

    const materials = [];
    for (let i = 0; i < 6; i++) {
        if (i === 2) {
           const material = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
           materials.push(material);
           textures.push(null);
        } else {
           const canvas = document.createElement('canvas');
           const wallKey = wallKeyByIndex[i];
           if (wallKey === 'piso') {
               canvas.width = 2048;
               canvas.height = 672;
           } else if (wallKey === 'bouchard' || wallKey === 'alem') {
               canvas.width = 2048;
               canvas.height = 494;
           } else if (wallKey === 'corrientes' || wallKey === 'sarmiento') {
               canvas.width = 2048;
               canvas.height = 1504;
           } else {
               canvas.width = 1536;
               canvas.height = 1024;
           }
           
           const baseWidth = canvas.width;
           const baseHeight = canvas.height;
           const ctx = canvas.getContext('2d', { alpha: false });
           const texture = new THREE.CanvasTexture(canvas);
           texture.colorSpace = THREE.SRGBColorSpace;
           texture.minFilter = THREE.LinearFilter;
           texture.magFilter = THREE.LinearFilter;
           texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
           texture.wrapS = THREE.RepeatWrapping;
           texture.wrapT = THREE.RepeatWrapping;
           texture.center.set(0.5, 0.5);
           textures.push(texture);
           wallCanvases[i] = { canvas, ctx, baseWidth, baseHeight };
           materials.push(new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide }));
        }
    }
    const geometry = new THREE.BoxGeometry(ROOM_CONFIG.depth, ROOM_CONFIG.height, ROOM_CONFIG.width);
    roomMesh = new THREE.Mesh(geometry, materials);
    roomMesh.position.y = ROOM_CONFIG.height / 2;
    scene.add(roomMesh);

    const pasarelaGeo = new THREE.BoxGeometry(2, 0.5, 15.73);
    const pasarelaMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    pasarelaMesh = new THREE.Mesh(pasarelaGeo, pasarelaMat);
    pasarelaMesh.position.y = 0.25;
    pasarelaMesh.visible = false; 
    scene.add(pasarelaMesh);

    addWallLabel("BOUCHARD", 0, 4, -10);
    addWallLabel("ALEM", 0, 4, 10);
    addWallLabel("SARMIENTO", -3.5, 4, 0, Math.PI/2);
    addWallLabel("CORRIENTES", 3.5, 4, 0, -Math.PI/2);

    Object.keys(WALLS).forEach(key => updateWallTexture(key));
}

function initUI() {
    const container = document.getElementById('wall-settings-container');
    const fileInput = document.getElementById('video-upload');

    Object.keys(WALLS).forEach((key) => {
        if(key === 'techo') return;
        const wall = WALLS[key];
        const div = document.createElement('div');
        div.className = `wall-controls ${key === 'piso' ? 'active' : ''}`;
        div.id = `ctrl-${key}`;
        
        let rotValue = wall.rot;
        if (rotValue > Math.PI * 1.8) rotValue = 0;
        
        div.innerHTML = `
            <div class="control-row"><label>Repetición X</label><input type="number" id="repX-${key}" value="${wall.repX}" step="1" onchange="uiChangeWall('${key}')"></div>
            <div class="control-row"><label>Repetición Y</label><input type="number" id="repY-${key}" value="${wall.repY}" step="1" onchange="uiChangeWall('${key}')"></div>
            <div class="control-row"><label>Rotación</label>
                <select id="rot-${key}" onchange="uiChangeWall('${key}')">
                    <option value="0" ${Math.abs(rotValue - 0) < 0.1 ? 'selected' : ''}>0°</option>
                    <option value="${Math.PI / 2}" ${Math.abs(rotValue - Math.PI/2) < 0.1 ? 'selected' : ''}>90°</option>
                    <option value="${Math.PI}" ${Math.abs(rotValue - Math.PI) < 0.1 ? 'selected' : ''}>180°</option>
                    <option value="${Math.PI * 1.5}" ${Math.abs(rotValue - Math.PI*1.5) < 0.1 ? 'selected' : ''}>270°</option>
                    <option value="4.71238898038469" ${Math.abs(rotValue - 4.712) < 0.1 ? 'selected' : ''}>270° (Exact)</option>
                </select>
            </div>
            <div class="control-row"><label>Mirror X</label><input type="checkbox" id="mirrorS-${key}" ${wall.mirrorS ? 'checked' : ''} onchange="uiChangeWall('${key}')"></div>
            <div class="control-row"><label>Mirror Y</label><input type="checkbox" id="mirrorT-${key}" ${wall.mirrorT ? 'checked' : ''} onchange="uiChangeWall('${key}')"></div>
            <div class="control-row"><label>Flip X</label><input type="checkbox" id="flipX-${key}" ${wall.flipX ? 'checked' : ''} onchange="uiChangeWall('${key}')"></div>
            <div class="control-row"><label>Flip Y</label><input type="checkbox" id="flipY-${key}" ${wall.flipY ? 'checked' : ''} onchange="uiChangeWall('${key}')"></div>
            <div id="slots-${key}"></div>
        `;
        container.appendChild(div);
        if (typeof window.updateWallSlotsUI === 'function') window.updateWallSlotsUI(key);
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (video._objectUrl) URL.revokeObjectURL(video._objectUrl);
        const url = URL.createObjectURL(file);
        video._objectUrl = url;
        video.preload = 'auto';
        video.playsInline = true;
        video.disablePictureInPicture = true;
        video.src = url;
        video.muted = false;
        video.load();
        video.addEventListener('loadedmetadata', () => {
            evaluateAutoPerformanceMode();
        }, { once: true });
        video.addEventListener('loadeddata', () => {
            invalidateWallCache();
            if (previewMode !== 'demo') applyPreviewMode('demo');
            else renderWallCanvases(true);
        }, { once: true });
        if (previewMode !== 'demo') applyPreviewMode('demo');
        const p = video.play();
        if (p?.catch) p.catch(() => {});
    });
}

window.updateWallSlotsUI = function(wallKey) {
    const w = WALLS[wallKey];
    const container = document.getElementById(`slots-${wallKey}`);
    if (!container) return;
    container.innerHTML = '';
    
    const cols = Math.ceil(Math.max(1, w.repX));
    const rows = Math.ceil(Math.max(1, w.repY));
    const total = cols * rows;
    
    let html = `<h3 style="margin-top:20px; border-top: 1px solid rgba(255,255,255,0.1); padding-top:15px; color:#ddd; font-size:12px; margin-bottom:8px;">Cargar Videos Individuales <span style="font-weight:bold; color:#006eff;">(${total} SLOTS)</span></h3>`;
    html += `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;">`;
    for (let ry = 0; ry < rows; ry++) {
        for (let rx = 0; rx < cols; rx++) {
            let vidId = `${wallKey}_${rx}_${ry}`;
            const existingVid = slotVideos[vidId];
            const btnText = existingVid?._fileName ? `✓ ${existingVid._fileName.slice(0, 14)}` : 'Seleccionar';
            html += `
                <div style="flex: 1 1 calc(50% - 8px); min-width: 80px; background: #2a2a2a; border-radius: 8px; border: 1px solid #444; padding: 12px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: inset 0 2px 4px rgba(0,0,0,0.15);">
                    <span style="font-size:11px; color:#ccc; font-weight:700; margin-bottom: 8px; letter-spacing:0.5px;">(X${rx+1} Y${ry+1})</span>
                    <label id="label-${vidId}" for="upload-${vidId}" class="panel-btn" style="width:100%; font-size:13px; padding:10px 6px; margin:0; background:linear-gradient(180deg,#2f8dff 0%,#006eff 100%); border-radius:10px; border:1px solid rgba(255,255,255,0.16); cursor:pointer; font-weight:800; letter-spacing:0.5px; box-shadow:0 6px 16px rgba(0,110,255,0.35); display:flex; align-items:center; justify-content:center; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onmouseover="this.style.filter='brightness(1.08)';this.style.transform='translateY(-1px)'" onmouseout="this.style.filter='none';this.style.transform='none'">${btnText}</label>
                    <input type="file" id="upload-${vidId}" accept="video/*,.mp4,.webm,.mov,.m4v,video/quicktime" style="display:none;" onchange="window.handleSlotUpload('${wallKey}', ${rx}, ${ry}, this)">
                </div>
            `;
        }
    }
    html += `</div>`;
    container.innerHTML = html;
};

window.handleSlotUpload = function(wallKey, rx, ry, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    let vidId = `${wallKey}_${rx}_${ry}`;
    if (!slotVideos[vidId]) {
        const newVid = document.createElement('video');
        newVid.loop = true;
        newVid.muted = true;
        newVid.playsInline = true;
        newVid.preload = 'auto';
        newVid.disablePictureInPicture = true;
        slotVideos[vidId] = newVid;
    }
    const vid = slotVideos[vidId];
    if (vid._objectUrl) URL.revokeObjectURL(vid._objectUrl);
    vid._objectUrl = url;
    vid._fileName = file.name;
    vid.src = url;
    vid.load();
    vid.addEventListener('loadedmetadata', () => {
        evaluateAutoPerformanceMode();
    }, { once: true });
    vid.addEventListener('loadeddata', () => {
        invalidateWallCache();
        if (previewMode !== 'demo') applyPreviewMode('demo');
        else renderWallCanvases(true);
    }, { once: true });
    vid.addEventListener('error', () => {
        alert(`No se pudo cargar el video "${file.name}". Si es .mov en ProRes/HEVC, convertilo a .mp4 o .mov con codec H.264.`);
    }, { once: true });

    const lbl = document.getElementById(`label-${vidId}`);
    if (lbl) lbl.textContent = `✓ ${file.name.slice(0, 14)}`;

    if (previewMode !== 'demo') applyPreviewMode('demo');
    const p = vid.play();
    if (p?.catch) p.catch(() => {});
};

window.toggleAdminPanel = function() { document.getElementById('control-panel').classList.toggle('panel-hidden'); };

window.toggleUserToolbar = function() {
    const tb = document.getElementById('user-toolbar');
    const btn = document.getElementById('mobile-menu-btn');
    
    tb.classList.toggle('minimized');
    btn.classList.toggle('menu-open');
    
    if (tb.classList.contains('minimized')) {
         btn.innerHTML = `<svg class="icon" style="width:24px; height:24px;" viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`;
    } else {
         btn.innerHTML = `<svg class="icon" style="width:24px; height:24px;" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`; 
    }
};

let gridRefreshId = 0;

function setGridStatusLoading(message) {
    const el = document.getElementById('grid-status');
    if (!el) return;
    el.classList.remove('grid-status-error');
    el.innerHTML = `<div class="grid-spinner"></div><div>${message}</div>`;
}

function setGridStatusError(message) {
    const el = document.getElementById('grid-status');
    if (!el) return;
    el.classList.add('grid-status-error');
    el.textContent = message;
}

function setGridStatusIdle(message) {
    const el = document.getElementById('grid-status');
    if (!el) return;
    el.classList.remove('grid-status-error');
    el.textContent = message;
}

async function refreshGrid() {
    const overlay = document.getElementById('grid-overlay');
    const container = document.getElementById('grid-container');
    if (!overlay || !container) return;

    const thisId = ++gridRefreshId;
    setGridStatusLoading('Cargando imágenes…');
    container.innerHTML = '';

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (thisId !== gridRefreshId) return;

    const wallKeys = ['piso', 'bouchard', 'alem', 'sarmiento', 'corrientes'].filter(k => WALLS[k]);
    let okCount = 0;

    try {
        for (const wallKey of wallKeys) {
            if (thisId !== gridRefreshId) return;
            const wallConf = WALLS[wallKey];
            const wc = wallCanvases[wallConf.index];
            const srcCanvas = wc?.canvas;

            const item = document.createElement('div');
            item.className = 'grid-item';
            item.addEventListener('click', () => window.openGridEditor(wallKey));

            const title = document.createElement('div');
            title.className = 'grid-item-title';
            const titleLabel = wallConf.label || wallKey;
            title.textContent = `${titleLabel} (${Math.ceil(Math.max(1, wallConf.repX))}×${Math.ceil(Math.max(1, wallConf.repY))})`;

            const media = document.createElement('div');
            media.className = 'grid-item-media';

            if (!srcCanvas) {
                const msg = document.createElement('div');
                msg.style.color = '#aaa';
                msg.style.fontSize = '12px';
                msg.textContent = 'Sin textura disponible';
                media.appendChild(msg);
                item.appendChild(title);
                item.appendChild(media);
                container.appendChild(item);
                continue;
            }

            const thumb = document.createElement('canvas');
            const targetW = 512;
            const aspect = srcCanvas.height ? (srcCanvas.width / srcCanvas.height) : 1;
            let targetH = Math.round(targetW / Math.max(0.0001, aspect));
            targetH = Math.max(180, Math.min(420, targetH));
            thumb.width = targetW;
            thumb.height = targetH;

            const ctx = thumb.getContext('2d');
            if (!ctx) throw new Error('No se pudo inicializar canvas 2D');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, thumb.width, thumb.height);
            ctx.drawImage(srcCanvas, 0, 0, thumb.width, thumb.height);

            media.appendChild(thumb);
            item.appendChild(title);
            item.appendChild(media);
            container.appendChild(item);
            okCount++;
        }
    } catch {
        if (thisId !== gridRefreshId) return;
        setGridStatusError('Error cargando la grilla.');
        return;
    }

    if (thisId !== gridRefreshId) return;
    setGridStatusIdle(`Mostrando ${okCount} elementos`);
}

window.hideGrid = function() {
    const overlay = document.getElementById('grid-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    window.hideGridEditor();
};

window.showGrid = function() {
    const overlay = document.getElementById('grid-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    refreshGrid();
};

let gridEditorWallKey = null;

function setWallOverride(wallKey, next) {
    const prev = wallOverrides[wallKey];
    if (prev?.url && prev.isObjectUrl) URL.revokeObjectURL(prev.url);
    wallOverrides[wallKey] = next;
}

function clearWallOverride(wallKey) {
    const prev = wallOverrides[wallKey];
    if (prev?.url && prev.isObjectUrl) URL.revokeObjectURL(prev.url);
    delete wallOverrides[wallKey];
}

function detectUrlKind(url) {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.m4v')) return 'video';
    if (clean.endsWith('.png') || clean.endsWith('.jpg') || clean.endsWith('.jpeg') || clean.endsWith('.webp') || clean.endsWith('.gif')) return 'image';
    return 'image';
}

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Error cargando imagen'));
        img.src = url;
    });
}

function loadVideoFromUrl(url) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.addEventListener('error', () => reject(new Error('Error cargando video')));
        v.addEventListener('canplay', () => resolve(v), { once: true });
        v.src = url;
        const p = v.play();
        if (p?.catch) p.catch(() => {});
    });
}

window.openGridEditor = function(wallKey) {
    gridEditorWallKey = wallKey;
    const editor = document.getElementById('grid-editor');
    const title = document.getElementById('grid-editor-title');
    const urlInput = document.getElementById('grid-url-input');
    if (title) {
        const label = WALLS[wallKey]?.label || wallKey;
        title.textContent = `Editar: ${label}`;
    }
    if (urlInput) urlInput.value = '';
    if (editor) editor.classList.add('active');
    setGridStatusIdle('Click en una pared para editar, o usar archivo/link');
};

window.hideGridEditor = function() {
    gridEditorWallKey = null;
    const editor = document.getElementById('grid-editor');
    if (editor) editor.classList.remove('active');
};

window.applyGridFile = async function(file) {
    if (!gridEditorWallKey) return;
    const wallKey = gridEditorWallKey;
    setGridStatusLoading('Actualizando…');
    try {
        const objectUrl = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
        if (isVideo) {
            const v = document.createElement('video');
            v.loop = true;
            v.muted = true;
            v.playsInline = true;
            v.preload = 'auto';
            v.disablePictureInPicture = true;
            v.src = objectUrl;
            await new Promise((resolve, reject) => {
                v.addEventListener('error', () => reject(new Error('Error cargando video')), { once: true });
                v.addEventListener('canplay', resolve, { once: true });
                const p = v.play();
                if (p?.catch) p.catch(() => {});
            });
            setWallOverride(wallKey, { kind: 'video', media: v, url: objectUrl, isObjectUrl: true });
            evaluateAutoPerformanceMode();
        } else if (isImage) {
            const img = await loadImageFromUrl(objectUrl);
            setWallOverride(wallKey, { kind: 'image', media: img, url: objectUrl, isObjectUrl: true });
        } else {
            throw new Error('Formato no soportado');
        }
        setGridStatusIdle('Actualizado');
        if (previewMode !== 'demo') applyPreviewMode('demo');
        else { renderWallCanvases(); refreshGrid(); }
    } catch {
        setGridStatusError('No se pudo actualizar. Verificá el archivo.');
    }
};

window.applyGridUrl = async function() {
    if (!gridEditorWallKey) return;
    const wallKey = gridEditorWallKey;
    const urlInput = document.getElementById('grid-url-input');
    const url = (urlInput?.value || '').trim();
    if (!url) return;
    setGridStatusLoading('Actualizando…');
    try {
        const kind = detectUrlKind(url);
        if (kind === 'video') {
            const v = await loadVideoFromUrl(url);
            setWallOverride(wallKey, { kind: 'video', media: v, url, isObjectUrl: false });
        } else {
            const img = await loadImageFromUrl(url);
            setWallOverride(wallKey, { kind: 'image', media: img, url, isObjectUrl: false });
        }
        setGridStatusIdle('Actualizado');
        if (previewMode !== 'demo') applyPreviewMode('demo');
        else { renderWallCanvases(); refreshGrid(); }
    } catch {
        setGridStatusError('No se pudo actualizar. Revisá el link o CORS.');
    }
};

window.restoreGridWall = function() {
    if (!gridEditorWallKey) return;
    clearWallOverride(gridEditorWallKey);
    setGridStatusIdle('Restaurado');
    renderWallCanvases();
    refreshGrid();
};

function safeLoadRecSettings() {
    try {
        const raw = localStorage.getItem(RECORD_SETTINGS_STORAGE_KEY);
        if (!raw) { recSettings = { ...DEFAULT_REC_SETTINGS }; return; }
        const parsed = JSON.parse(raw);
        recSettings = {
            codec: typeof parsed.codec === 'string' ? parsed.codec : DEFAULT_REC_SETTINGS.codec,
            resolution: typeof parsed.resolution === 'string' ? parsed.resolution : DEFAULT_REC_SETTINGS.resolution,
            aspect: typeof parsed.aspect === 'string' ? parsed.aspect : DEFAULT_REC_SETTINGS.aspect
        };
    } catch {
        recSettings = { ...DEFAULT_REC_SETTINGS };
    }
}

function getCodecCandidates() {
    return [
        { value: 'auto', label: 'Auto (Recomendado)' },
        { value: 'video/webm;codecs=vp9', label: 'WebM VP9' },
        { value: 'video/webm;codecs=vp8', label: 'WebM VP8' },
        { value: 'video/webm', label: 'WebM' },
        { value: 'video/mp4;codecs=avc1.42E01E', label: 'MP4 H.264' }
    ];
}

function initRecSettingsUI() {
    const codecSelect = document.getElementById('rec-codec');
    if (codecSelect) {
        codecSelect.innerHTML = '';
        const candidates = getCodecCandidates();
        for (const c of candidates) {
            const opt = document.createElement('option');
            opt.value = c.value;
            opt.textContent = c.label;
            if (c.value !== 'auto' && typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
                opt.disabled = !MediaRecorder.isTypeSupported(c.value);
            }
            codecSelect.appendChild(opt);
        }
    }
    const resolutionSelect = document.getElementById('rec-resolution');
    const aspectSelect = document.getElementById('rec-aspect');
    if (codecSelect) codecSelect.value = recSettings.codec;
    if (resolutionSelect) resolutionSelect.value = recSettings.resolution;
    if (aspectSelect) aspectSelect.value = recSettings.aspect;

    const update = () => updateRecSettingsStatus();
    if (codecSelect) codecSelect.addEventListener('change', update);
    if (resolutionSelect) resolutionSelect.addEventListener('change', update);
    if (aspectSelect) aspectSelect.addEventListener('change', update);
    updateRecSettingsStatus();
}

function parseAspectValue(value, fallbackAspect) {
    if (value === 'source') return fallbackAspect;
    const parts = value.split(':').map(n => parseFloat(n));
    if (parts.length !== 2) return fallbackAspect;
    const w = parts[0];
    const h = parts[1];
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return fallbackAspect;
    return w / h;
}

function computeRecordOutputSize() {
    const src = renderer?.domElement;
    const srcW = src?.width || window.innerWidth;
    const srcH = src?.height || window.innerHeight;
    const srcAspect = srcW / Math.max(1, srcH);
    const desiredAspect = parseAspectValue(recSettings.aspect, srcAspect);
    if (recSettings.resolution === 'auto' && recSettings.aspect === 'source') {
        return { width: srcW, height: srcH, aspect: desiredAspect };
    }
    const baseW = recSettings.resolution === 'auto' ? srcW : Math.max(2, parseInt(recSettings.resolution, 10) || srcW);
    const outH = Math.max(2, Math.round(baseW / Math.max(0.0001, desiredAspect)));
    return { width: baseW, height: outH, aspect: desiredAspect };
}

function chooseMimeType() {
    const pref = recSettings.codec;
    const isSupported = (t) => typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t);
    if (pref && pref !== 'auto' && isSupported(pref)) return pref;
    const fallbacks = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E'];
    for (const t of fallbacks) { if (isSupported(t)) return t; }
    return '';
}

function updateRecSettingsStatus() {
    const status = document.getElementById('rec-settings-status');
    if (!status) return;
    const { width, height } = computeRecordOutputSize();
    const mime = chooseMimeType() || 'Auto';
    status.textContent = `Salida: ${width}×${height} | Codec: ${mime}`;
}

function showRecSettings() {
    if (isRecording) return;
    const overlay = document.getElementById('rec-settings-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    initRecSettingsUI();
}

function hideRecSettings() {
    const overlay = document.getElementById('rec-settings-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

function saveRecSettingsFromUI() {
    const codecSelect = document.getElementById('rec-codec');
    const resolutionSelect = document.getElementById('rec-resolution');
    const aspectSelect = document.getElementById('rec-aspect');
    recSettings = {
        codec: codecSelect?.value || DEFAULT_REC_SETTINGS.codec,
        resolution: resolutionSelect?.value || DEFAULT_REC_SETTINGS.resolution,
        aspect: aspectSelect?.value || DEFAULT_REC_SETTINGS.aspect
    };
    try { localStorage.setItem(RECORD_SETTINGS_STORAGE_KEY, JSON.stringify(recSettings)); } catch {}
    updateRecSettingsStatus();
    hideRecSettings();
}

function resetRecSettingsUI() {
    recSettings = { ...DEFAULT_REC_SETTINGS };
    try { localStorage.setItem(RECORD_SETTINGS_STORAGE_KEY, JSON.stringify(recSettings)); } catch {}
    initRecSettingsUI();
}

window.switchMainTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.main-tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    const btns = document.querySelectorAll('.main-tab-btn');
    if(tabId === 'tab-media' && btns[0]) btns[0].classList.add('active');
    if(tabId === 'tab-view' && btns[1]) btns[1].classList.add('active');
    if(tabId === 'tab-mapping' && btns[2]) btns[2].classList.add('active');
};

window.openMappingTab = function(wallKey) {
    document.querySelectorAll('.wall-controls').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.mapping-tab-btn').forEach(el => el.classList.remove('active-tab'));
    const target = document.getElementById(`ctrl-${wallKey}`);
    if (target) { target.style.display = 'block'; target.classList.add('active'); }
    document.querySelectorAll('.mapping-tab-btn').forEach(btn => {
        if(btn.textContent.toLowerCase().includes(wallKey.substring(0,3))) btn.classList.add('active-tab');
    });
};

window.uiChangeWall = function(wallKey) {
    const w = WALLS[wallKey];
    w.repX = parseFloat(document.getElementById(`repX-${wallKey}`).value);
    w.repY = parseFloat(document.getElementById(`repY-${wallKey}`).value);
    w.rot = parseFloat(document.getElementById(`rot-${wallKey}`).value);
    w.mirrorS = document.getElementById(`mirrorS-${wallKey}`).checked;
    w.mirrorT = document.getElementById(`mirrorT-${wallKey}`).checked;
    w.flipX = document.getElementById(`flipX-${wallKey}`).checked;
    w.flipY = document.getElementById(`flipY-${wallKey}`).checked;
    updateWallTexture(wallKey);
};

function updateWallTexture(wallKey) {
    const wallConf = WALLS[wallKey];
    if (!textures[wallConf.index]) return; 
    const texture = textures[wallConf.index];
    
    let finalRepX = wallConf.flipX ? -1 : 1;
    let finalRepY = wallConf.flipY ? -1 : 1;
    texture.repeat.set(finalRepX, finalRepY);
    texture.offset.x = (finalRepX - 1) * 0.5;
    texture.offset.y = (finalRepY - 1) * 0.5;
    texture.rotation = wallConf.rot;
    texture.needsUpdate = true;
    
    if (typeof window.updateWallSlotsUI === 'function') {
        window.updateWallSlotsUI(wallKey);
    }
}

window.updatePasarelaMode = function() {
    const mode = document.getElementById('pasarela-mode').value;
    if (mode === 'hidden') { pasarelaMesh.visible = false; } else {
        pasarelaMesh.visible = true;
        if (mode === 'floor') {
            const floorTexture = textures[3];
            pasarelaMesh.material = new THREE.MeshBasicMaterial({ map: floorTexture, side: THREE.FrontSide });
        } else { pasarelaMesh.material = new THREE.MeshLambertMaterial({ color: 0x333333 }); }
    }
};

window.exportConfiguration = function() {
    const pasarelaMode = document.getElementById('pasarela-mode').value;
    const configData = { timestamp: new Date().toISOString(), pasarelaMode: pasarelaMode, walls: WALLS };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(configData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "sala_inmersiva_config.json");
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
};

window.importConfiguration = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const config = JSON.parse(e.target.result);
            if (config.walls) {
                WALLS = config.walls;
                Object.keys(WALLS).forEach(key => {
                    if (key === 'techo') return;
                    const w = WALLS[key];
                    if (w.mirror !== undefined && w.mirrorS === undefined) { w.mirrorS = w.mirror; w.mirrorT = w.mirror; }
                    if (w.flipY === undefined) w.flipY = false;
                    document.getElementById(`repX-${key}`).value = w.repX;
                    document.getElementById(`repY-${key}`).value = w.repY;
                    document.getElementById(`mirrorS-${key}`).checked = w.mirrorS;
                    document.getElementById(`mirrorT-${key}`).checked = w.mirrorT;
                    document.getElementById(`flipX-${key}`).checked = w.flipX;
                    const elFlipY = document.getElementById(`flipY-${key}`); if(elFlipY) elFlipY.checked = w.flipY;
                    const rotSelect = document.getElementById(`rot-${key}`);
                    for(let i=0; i<rotSelect.options.length; i++) { if (Math.abs(parseFloat(rotSelect.options[i].value) - w.rot) < 0.1) { rotSelect.selectedIndex = i; break; } }
                    updateWallTexture(key);
                });
            }
            if (config.pasarelaMode) { document.getElementById('pasarela-mode').value = config.pasarelaMode; window.updatePasarelaMode(); }
            alert("Configuración cargada exitosamente.");
        } catch (err) { console.error(err); alert("Error al leer el archivo JSON."); }
    };
    reader.readAsText(file);
    input.value = ''; 
};

function toggleLabels() {
    labelsVisible = !labelsVisible;
    labelGroup.visible = labelsVisible;
    const btn = document.getElementById('btn-toggle-labels');
    btn.classList.toggle('active');
    btn.textContent = labelsVisible ? "Nombres Visibles" : "Mostrar Nombres";
}

function toggleRecording() { if (isRecording) stopRecording(); else startRecording(); }

function stopRecordCanvasLoop() {
    if (!recordAnimationId) return;
    cancelAnimationFrame(recordAnimationId);
    recordAnimationId = 0;
}

function ensureRecordCanvas() {
    if (!recordCanvas) {
        recordCanvas = document.createElement('canvas');
        recordCanvasCtx = recordCanvas.getContext('2d');
    }
    const { width, height } = computeRecordOutputSize();
    if (recordCanvas.width !== width) recordCanvas.width = width;
    if (recordCanvas.height !== height) recordCanvas.height = height;
}

function renderToRecordCanvas() {
    if (!recordCanvasCtx) return;
    const src = renderer.domElement;
    recordCanvasCtx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
    recordCanvasCtx.drawImage(src, 0, 0, recordCanvas.width, recordCanvas.height);
    recordAnimationId = requestAnimationFrame(renderToRecordCanvas);
}

function startRecording() {
    if (isRecording) return;
    try {
        ensureRecordCanvas();
    } catch {
        alert("Error preparando la salida de grabación.");
        return;
    }
    stopRecordCanvasLoop();
    renderToRecordCanvas();

    const stream = recordCanvas.captureStream(30);
    const chosen = chooseMimeType();
    const options = chosen ? { mimeType: chosen } : {};
    activeRecordMimeType = options.mimeType || 'video/webm';
    try { mediaRecorder = new MediaRecorder(stream, options); } catch { alert("Error al iniciar grabación."); stopRecordCanvasLoop(); return; }
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => { stopRecordCanvasLoop(); saveRecording(); };
    mediaRecorder.start();
    isRecording = true;
    updateRecordingUI(true);
}

function stopRecording() {
    if (!mediaRecorder) return;
    try { mediaRecorder.stop(); } catch {}
    isRecording = false;
    updateRecordingUI(false);
}

function updateRecordingUI(active) {
    const btnAdmin = document.getElementById('btn-record');
    const textAdmin = document.getElementById('record-text');
    const btnUser = document.getElementById('btn-record-user');
    const indicator = document.getElementById('rec-indicator');
    if (active) {
        btnAdmin.classList.add('recording'); textAdmin.textContent = "Detener Grabación";
        if (btnUser) btnUser.classList.add('recording');
        indicator.style.display = "flex";
    } else {
        btnAdmin.classList.remove('recording'); textAdmin.textContent = "Grabar Cámara (.mp4)";
        if (btnUser) btnUser.classList.remove('recording');
        indicator.style.display = "none";
    }
}

function saveRecording() {
    const mime = activeRecordMimeType || 'video/webm';
    const blob = new Blob(recordedChunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.style.display = 'none'; a.href = url;
    const ext = (mime.includes('mp4')) ? 'mp4' : 'webm';
    a.download = `mapeo_sala_${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.${ext}`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
}

function addWallLabel(text, x, y, z, rotY = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 128;
    ctx.font = "Bold 40px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 80);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(x, y, z);
    sprite.scale.set(8, 2, 1);
    labelGroup.add(sprite);
}

function setupControls() {
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    fpsControls = new PointerLockControls(camera, document.body);
    
    const startFPS = () => {
        camera.position.set(0, 1.6, 0);
        camera.rotation.order = 'YXZ';
        camera.rotation.set(0, 0, 0);
        camera.quaternion.setFromEuler(camera.rotation);
        orbitControls.target.set(0, 1.6, -10);
        orbitControls.update();
        
        if (isMobile) {
            isFPSMode = true;
            orbitControls.enabled = false;
            document.getElementById('mobile-controls-zone').style.display = 'block';
            document.getElementById('mobile-hint').style.display = 'block';
            setTimeout(() => document.getElementById('mobile-hint').style.display = 'none', 4000);
            const tb = document.getElementById('user-toolbar');
            if(!tb.classList.contains('minimized')) {
                window.toggleUserToolbar();
            }
        } else {
            fpsControls.lock();
        }
    };
    
    document.getElementById('btn-fps').addEventListener('click', startFPS);
    document.getElementById('btn-fps-user').addEventListener('click', startFPS);
    
    fpsControls.addEventListener('lock', () => {
        isFPSMode = true;
        orbitControls.enabled = false;
        document.getElementById('instruction-overlay').innerText = "WASD Mover | ESC Salir";
        document.getElementById('control-panel').style.opacity = '0.2';
        document.getElementById('user-toolbar').style.opacity = '0.2';
    });
    fpsControls.addEventListener('unlock', () => {
        if (!isMobile) {
            isFPSMode = false;
            orbitControls.enabled = true;
            document.getElementById('instruction-overlay').innerText = "Click Izq Rotar | Click Der Mover";
            document.getElementById('control-panel').style.opacity = '1';
            document.getElementById('user-toolbar').style.opacity = '1';
        }
    });

    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        if (isMobile && isFPSMode) {
            isFPSMode = false;
            orbitControls.enabled = true;
            document.getElementById('mobile-controls-zone').style.display = 'none';
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(e) {
    if (e.key.toLowerCase() === 'p') window.toggleAdminPanel();
    if (e.key.toLowerCase() === 'o') window.toggleUserToolbar();
    if (e.key === 'Escape') window.hideGrid();
    if (e.key === 'Escape') hideRecSettings();
    switch(e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyD': moveRight = true; break;
    }
}
function onKeyUp(e) {
    switch(e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyD': moveRight = false; break;
    }
}

function setupVRControls() {
    marker = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x006eff, transparent: true, opacity: 0.8 })
    );
    marker.visible = false;
    scene.add(marker);

    raycaster = new THREE.Raycaster();

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    cameraGroup.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    controller2.addEventListener('selectend', onSelectEnd);
    cameraGroup.add(controller2);

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    cameraGroup.add(controllerGrip1);

    hand1 = renderer.xr.getHand(0);
    hand1.add(handModelFactory.createHandModel(hand1, 'mesh'));
    cameraGroup.add(hand1);

    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    cameraGroup.add(controllerGrip2);

    hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2, 'mesh'));
    cameraGroup.add(hand2);

    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const line = new THREE.Line(geometry);
    line.name = 'line';
    line.scale.z = 5;

    controller1.add(line.clone());
    controller2.add(line.clone());
}

function onSelectStart(event) {
    const controller = event.target;
    controller.userData.isSelecting = true;
}

function onSelectEnd(event) {
    const controller = event.target;
    controller.userData.isSelecting = false;
    if (intersection) {
        cameraGroup.position.x = intersection.x - camera.position.x;
        cameraGroup.position.z = intersection.z - camera.position.z;
    }
}

function handleXRTeleport() {
    intersection = null;
    marker.visible = false;

    const session = renderer.xr.getSession();
    if (!session || !roomMesh) return;

    let activeController = null;
    if (controller1.userData.isSelecting) activeController = controller1;
    else if (controller2.userData.isSelecting) activeController = controller2;

    if (activeController) {
        const matrix = new THREE.Matrix4();
        matrix.identity().extractRotation(activeController.matrixWorld);

        raycaster.ray.origin.setFromMatrixPosition(activeController.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(matrix);

        const objectsToIntersect = pasarelaMesh ? [roomMesh, pasarelaMesh] : [roomMesh];
        const intersects = raycaster.intersectObjects(objectsToIntersect, true);
        if (intersects.length > 0) {
            intersection = intersects[0].point;
            marker.position.copy(intersection);
            marker.position.y += 0.01;
            marker.visible = true;
        }
    }
}

function handleXRGamepad(delta) {
    const session = renderer.xr.getSession();
    if (!session) return;
    
    let moveX = 0;
    let moveZ = 0;

    for (const source of session.inputSources) {
        if (source.gamepad) {
            const axes = source.gamepad.axes;
            if (axes.length >= 4) {
                const ax = axes[2];
                const ay = axes[3];
                
                if (Math.abs(ax) > 0.1 || Math.abs(ay) > 0.1) {
                    if (source.handedness === 'left') {
                        moveX += ax;
                        moveZ += ay;
                    } else if (source.handedness === 'right') {
                        moveX += ax;
                        moveZ += ay;
                    }
                }
            }
        }
    }

    if (moveX !== 0 || moveZ !== 0) {
        const speed = 2.0 * delta;
        
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        camDir.y = 0;
        camDir.normalize();

        const sideDir = new THREE.Vector3();
        sideDir.crossVectors(camera.up, camDir).normalize();
        
        cameraGroup.position.addScaledVector(sideDir, moveX * speed);
        cameraGroup.position.addScaledVector(camDir, -moveZ * speed);

        const buffer = 0.5;
        const limitX = (ROOM_CONFIG.depth / 2) - buffer;
        const limitZ = (ROOM_CONFIG.width / 2) - buffer;

        let worldPos = new THREE.Vector3();
        camera.getWorldPosition(worldPos);
        
        if (worldPos.x < -limitX) cameraGroup.position.x += (-limitX - worldPos.x);
        if (worldPos.x > limitX) cameraGroup.position.x -= (worldPos.x - limitX);
        if (worldPos.z < -limitZ) cameraGroup.position.z += (-limitZ - worldPos.z);
        if (worldPos.z > limitZ) cameraGroup.position.z -= (worldPos.z - limitZ);
    }
}

function renderWallCanvases(force = false) {
    Object.keys(WALLS).forEach(key => {
        const wallConf = WALLS[key];
        if (wallConf.index === 2) return; 
        const wc = wallCanvases[wallConf.index];
        if (!wc) return;
        const { canvas, ctx } = wc;
        const cols = Math.ceil(Math.max(1, wallConf.repX));
        const rows = Math.ceil(Math.max(1, wallConf.repY));
        const cellW = canvas.width / cols;
        const cellH = canvas.height / rows;

        const override = wallOverrides[key];
        const hasOverride = !!override?.media && (override.kind !== 'video' || override.media.readyState >= 2);
        const hasMain = video && video.readyState >= 2;
        const fallbackImg = wallFallbackImages[key];
        const hasFallback = !!fallbackImg;

        const prevState = wallRenderState[key];
        const sig = `${previewMode}|${cols}x${rows}|${wallConf.mirrorS?1:0}|${wallConf.mirrorT?1:0}|${canvas.width}x${canvas.height}|${hasOverride?override.url:''}|${hasMain?video.src:''}|${hasFallback?1:0}`;

        const cellSources = [];
        const videoTimes = [];
        for (let ry = 0; ry < rows; ry++) {
            for (let rx = 0; rx < cols; rx++) {
                const vidId = `${key}_${rx}_${ry}`;
                const slotVid = slotVideos[vidId];
                const hasSlot = slotVid && slotVid.readyState >= 2;
                const source = (previewMode === 'grid')
                    ? (hasFallback ? fallbackImg : null)
                    : (hasSlot ? slotVid : (hasOverride ? override.media : (hasMain ? video : (hasFallback ? fallbackImg : null))));
                cellSources.push(source);
                if (source instanceof HTMLVideoElement) {
                    videoTimes.push(`${vidId}:${source.src}:${source.currentTime.toFixed(4)}:${source.readyState}`);
                }
            }
        }

        const timeKey = videoTimes.join('|');
        if (!force && prevState && prevState.sig === sig && prevState.timeKey === timeKey) {
            return;
        }
        wallRenderState[key] = { sig, timeKey };

        let idx = 0;
        for (let ry = 0; ry < rows; ry++) {
            for (let rx = 0; rx < cols; rx++) {
                const source = cellSources[idx++];
                const destX = rx * cellW;
                const destY = ry * cellH;
                if (source) {
                    ctx.save();
                    let flipCellX = wallConf.mirrorS && (rx % 2 !== 0);
                    let flipCellY = wallConf.mirrorT && (ry % 2 !== 0);
                    
                    ctx.translate(destX + (flipCellX ? cellW : 0), destY + (flipCellY ? cellH : 0));
                    ctx.scale(flipCellX ? -1 : 1, flipCellY ? -1 : 1);
                    const useFill = key === 'piso' || key === 'bouchard' || key === 'alem';
                    if (source instanceof HTMLVideoElement) {
                        ctx.drawImage(source, 0, 0, cellW, cellH);
                    } else {
                        const baseFlipImageX = key === 'bouchard' || key === 'alem';
                        if (baseFlipImageX) {
                            ctx.translate(cellW, 0);
                            ctx.scale(-1, 1);
                        }
                        const useContain = key === 'corrientes' || key === 'sarmiento';
                        if (useContain) {
                            ctx.fillStyle = '#000';
                            ctx.fillRect(0, 0, cellW, cellH);
                            drawImageContain(ctx, source, 0, 0, cellW, cellH);
                        } else if (useFill) {
                            ctx.drawImage(source, 0, 0, cellW, cellH);
                        } else {
                            drawImageCover(ctx, source, 0, 0, cellW, cellH);
                        }
                    }
                    ctx.restore();
                } else {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(destX, destY, cellW, cellH);
                }
            }
        }
        if(textures[wallConf.index]) textures[wallConf.index].needsUpdate = true;
    });
}

function animate() {
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (renderer.xr.isPresenting) {
        handleXRGamepad(delta);
        handleXRTeleport();
    } else {
        if (isFPSMode) {
            velocity.x -= velocity.x * 10.0 * delta;
            velocity.z -= velocity.z * 10.0 * delta;

            if (isMobile) {
                if (Math.abs(joyMove.y) > 0.1 || Math.abs(joyMove.x) > 0.1) {
                    direction.z = joyMove.y;
                    direction.x = joyMove.x;
                    velocity.z -= direction.z * 40.0 * delta;
                    velocity.x -= direction.x * 40.0 * delta;
                }
                
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                camDir.y = 0; camDir.normalize();
                
                const sideDir = new THREE.Vector3();
                sideDir.crossVectors(camera.up, camDir).normalize();

                const fwdStep = camDir.multiplyScalar(-velocity.z * delta);
                const sideStep = sideDir.multiplyScalar(velocity.x * delta);
                
                camera.position.add(fwdStep);
                camera.position.add(sideStep);

            } else if (fpsControls.isLocked) {
                direction.z = Number(moveForward) - Number(moveBackward);
                direction.x = Number(moveRight) - Number(moveLeft);
                direction.normalize();
                if (moveForward || moveBackward) velocity.z -= direction.z * 60.0 * delta;
                if (moveLeft || moveRight) velocity.x -= direction.x * 60.0 * delta;
                fpsControls.moveRight(-velocity.x * delta);
                fpsControls.moveForward(-velocity.z * delta);
            }

            const pos = camera.position;
            const buffer = 0.8; 
            if (pos.x < - (ROOM_CONFIG.depth / 2) + buffer) pos.x = - (ROOM_CONFIG.depth / 2) + buffer;
            if (pos.x > (ROOM_CONFIG.depth / 2) - buffer) pos.x = (ROOM_CONFIG.depth / 2) - buffer;
            if (pos.z < - (ROOM_CONFIG.width / 2) + buffer) pos.z = - (ROOM_CONFIG.width / 2) + buffer;
            if (pos.z > (ROOM_CONFIG.width / 2) - buffer) pos.z = (ROOM_CONFIG.width / 2) - buffer;
            if (pos.y < 0.5) pos.y = 0.5; 
            if (pos.y > ROOM_CONFIG.height - 1) pos.y = ROOM_CONFIG.height - 1;

        } else {
            orbitControls.update();
        }
    }
    prevTime = time;
    renderWallCanvases();
    renderer.render(scene, camera);
}

function getPasarelaPivot() {
    const center = new THREE.Vector3(0, 1.6, 0);
    if (!pasarelaMesh) return center;
    const box = new THREE.Box3().setFromObject(pasarelaMesh);
    if (box.isEmpty()) return center;
    box.getCenter(center);
    center.y = 1.6;
    return center;
}

window.moveCamera = function(view) {
    if(isMobile) {
        isFPSMode = false;
        document.getElementById('mobile-controls-zone').style.display = 'none';
        const tb = document.getElementById('user-toolbar');
        if(tb.classList.contains('minimized')) {
            window.toggleUserToolbar();
        }
    } else {
        fpsControls.unlock();
    }
    orbitControls.enabled = true;
    
    if(view === 'pasarela') {
        const pivot = getPasarelaPivot();
        orbitControls.target.copy(pivot);
        camera.position.set(pivot.x, 2, pivot.z + 8);
        orbitControls.update();
    }
    if(view === 'top') { camera.position.set(0, 35, 0); orbitControls.target.set(0, 0, 0); }
};

init();
initUI();
initMobileControls();
renderer.setAnimationLoop(animate);
