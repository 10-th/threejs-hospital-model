import './styles.css';
import * as THREE from 'three';
import { WebGPURenderer, MeshBasicNodeMaterial, RenderPipeline } from 'three/webgpu';
import {
  color as tslColor,
  float as tslFloat,
  hue,
  linearDepth,
  renderOutput,
  saturation,
  texture,
  uniform,
  vec4,
  viewportLinearDepth,
  viewportSharedTexture,
} from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { hashBlur } from 'three/examples/jsm/tsl/display/hashBlur.js';

const MODEL_URL = new URL('../model/华山.glb', import.meta.url).href;
const TARGET_SIZE = 22;
const EDGE_THRESHOLD = 14;
const MAX_DEVICE_PIXEL_RATIO = 2;
const OUTLIER_DIMENSION_LIMIT = 100000;
const OUTLIER_WORLD_DIMENSION_LIMIT = 90;
const SCENE_MSAA_SAMPLES = 4; // 离屏场景 MSAA 采样数，越高边缘越平滑但越耗性能
const CAMERA_FXAA_ENABLED = true; // 相机滤镜最终 FXAA 抗锯齿开关
const DEVICE_BACKDROP_BLUR = 0.15;
const DEVICE_BACKDROP_BLUR_REPEATS = 96;
const CAMERA_HUE = 0.1; // 相机滤镜色调，单位是弧度，0 表示不偏色
const CAMERA_SATURATION = 1; // 相机滤镜饱和度，1 为原始饱和度
const CAMERA_BRIGHTNESS = 1; // 相机滤镜亮度，1 为原始亮度
const CAMERA_BLOOM_STRENGTH = 0.05; // 相机滤镜泛光强度，0 为关闭泛光
const CAMERA_BLOOM_RADIUS = 0.35; // 相机滤镜泛光扩散范围
const CAMERA_BLOOM_THRESHOLD = 0.35; // 相机滤镜泛光亮度阈值
const BACKGROUND_COLOR_HEX = '#000000'; // 场景背景色
const DEVICE_COLOR_HEX = '#5ea4ff'; // 设备本体、设备轮廓线、设备发光层
const EDGE_COLOR_HEX = '#1147CF'; // 普通墙体轮廓线
const LAB_EDGE_COLOR_HEX = '#84BBFF'; // 实验室墙体轮廓线
const OUTER_EDGE_COLOR_HEX = '#092F86'; // 外墙轮廓线
const GLOW_EDGE_COLOR_HEX = '#235BE0'; // 普通墙体弱发光轮廓线
const LAB_BLOOM_EDGE_COLOR_HEX = '#5A97FF'; // 实验室墙体发光轮廓线
const OUTER_BLOOM_EDGE_COLOR_HEX = '#0B31A0'; // 外墙发光轮廓线
const BLOOM_EDGE_COLOR_HEX = '#174FD0'; // 普通墙体发光轮廓线
const LAB_WALL_COLOR_HEX = '#467dff'; // 实验室墙体面材质
const WALL_COLOR_HEX = '#061A62'; // 普通墙体面材质
const OUTER_WALL_COLOR_HEX = '#061F6F'; // 外墙面材质
const FLOOR_COLOR_HEX = '#06122F'; // 地板面材质
const AMBIENT_LIGHT_COLOR_HEX = '#2C6DFF'; // 环境半球光天空色
const KEY_LIGHT_COLOR_HEX = '#89B7FF'; // 主方向光
const RIM_LIGHT_COLOR_HEX = '#1E67FF'; // 轮廓方向光
const ACCENT_LIGHT_COLOR_HEX = '#2F74FF'; // 局部点光

const BACKGROUND_COLOR = new THREE.Color(BACKGROUND_COLOR_HEX);
const DEVICE_COLOR = new THREE.Color(DEVICE_COLOR_HEX);
const EDGE_COLOR = new THREE.Color(EDGE_COLOR_HEX);
const LAB_EDGE_COLOR = new THREE.Color(LAB_EDGE_COLOR_HEX);
const OUTER_EDGE_COLOR = new THREE.Color(OUTER_EDGE_COLOR_HEX);
const GLOW_EDGE_COLOR = new THREE.Color(GLOW_EDGE_COLOR_HEX);
const LAB_BLOOM_EDGE_COLOR = new THREE.Color(LAB_BLOOM_EDGE_COLOR_HEX);
const OUTER_BLOOM_EDGE_COLOR = new THREE.Color(OUTER_BLOOM_EDGE_COLOR_HEX);
const BLOOM_EDGE_COLOR = new THREE.Color(BLOOM_EDGE_COLOR_HEX);
const LAB_WALL_COLOR = new THREE.Color(LAB_WALL_COLOR_HEX);
const WALL_COLOR = new THREE.Color(WALL_COLOR_HEX);
const OUTER_WALL_COLOR = new THREE.Color(OUTER_WALL_COLOR_HEX);
const FLOOR_COLOR = new THREE.Color(FLOOR_COLOR_HEX);
const AMBIENT_LIGHT_COLOR = new THREE.Color(AMBIENT_LIGHT_COLOR_HEX);
const KEY_LIGHT_COLOR = new THREE.Color(KEY_LIGHT_COLOR_HEX);
const RIM_LIGHT_COLOR = new THREE.Color(RIM_LIGHT_COLOR_HEX);
const ACCENT_LIGHT_COLOR = new THREE.Color(ACCENT_LIGHT_COLOR_HEX);

const canvas = document.querySelector('#scene');
const samplesEl = document.querySelector('#samples');
const loadingEl = document.querySelector('#loading');

let renderer;
let sceneRenderTarget;
let renderPipeline;
let controls;
let cameraHueUniform;
let cameraSaturationUniform;
let cameraBrightnessUniform;
let cameraBloomStrengthUniform;

const scene = new THREE.Scene();
const deviceDepthScene = new THREE.Scene();
const deviceGlowScene = new THREE.Scene();
const deviceOutlineScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 180);
camera.position.set(14, 12, 18);

const edgeMaterial = new THREE.LineBasicMaterial({
  color: EDGE_COLOR,
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const labEdgeMaterial = new THREE.LineBasicMaterial({
  color: LAB_EDGE_COLOR,
  transparent: true,
  opacity: 0.36,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const outerEdgeMaterial = new THREE.LineBasicMaterial({
  color: OUTER_EDGE_COLOR,
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const fineEdgeMaterial = new THREE.LineBasicMaterial({
  color: DEVICE_COLOR,
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const glowEdgeMaterial = new THREE.LineBasicMaterial({
  color: GLOW_EDGE_COLOR,
  transparent: true,
  opacity: 0.007,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const deviceGlowEdgeMaterial = new THREE.LineBasicMaterial({
  color: DEVICE_COLOR,
  transparent: true,
  opacity: 0.05,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const labBloomEdgeMaterial = new THREE.LineBasicMaterial({
  color: LAB_BLOOM_EDGE_COLOR,
  transparent: true,
  opacity: 0.11,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const outerBloomEdgeMaterial = new THREE.LineBasicMaterial({
  color: OUTER_BLOOM_EDGE_COLOR,
  transparent: true,
  opacity: 0.08,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const bloomEdgeMaterial = new THREE.LineBasicMaterial({
  color: BLOOM_EDGE_COLOR,
  transparent: true,
  opacity: 0.045,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});

const labWallMaterial = new THREE.MeshBasicMaterial({
  name: 'blueprint lab wall fill',
  color: LAB_WALL_COLOR,
  transparent: true,
  opacity: 0.05,
  side: THREE.DoubleSide,
  depthWrite: true,
});

const wallMaterial = new THREE.MeshBasicMaterial({
  name: 'blueprint wall fill',
  color: WALL_COLOR,
  transparent: true,
  opacity: 0.08,
  side: THREE.DoubleSide,
  depthWrite: true,
});

const outerWallMaterial = new THREE.MeshBasicMaterial({
  name: 'blueprint outer wall fill',
  color: OUTER_WALL_COLOR,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  depthWrite: true,
});

let detailMaterial;

const deviceDepthMaterial = new THREE.MeshBasicMaterial({
  name: 'device outline depth mask',
  colorWrite: false,
  depthTest: true,
  depthWrite: true,
  side: THREE.DoubleSide,
});

const deviceSurfaceGlowMaterial = new THREE.MeshBasicMaterial({
  name: 'device surface glow',
  color: DEVICE_COLOR,
  transparent: true,
  opacity: 0.2,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const floorMaterial = new THREE.MeshBasicMaterial({
  name: 'ink blue floor',
  color: FLOOR_COLOR,
  transparent: true,
  opacity: 0.13,
  side: THREE.DoubleSide,
  depthWrite: true,
});

scene.background = BACKGROUND_COLOR;

const ambientLight = new THREE.HemisphereLight(AMBIENT_LIGHT_COLOR, BACKGROUND_COLOR, 0.55);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, 1.05);
keyLight.position.set(-8, 12, 9);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(RIM_LIGHT_COLOR, 1.25);
rimLight.position.set(10, 7, -9);
scene.add(rimLight);

const accentLight = new THREE.PointLight(ACCENT_LIGHT_COLOR, 12, 46, 1.6);
accentLight.position.set(12, 6, 9);
scene.add(accentLight);

const loadedRoot = new THREE.Group();
scene.add(loadedRoot);

init();

async function init() {
  try {
    setLoading('Loading model');
    await setupRenderer();

    const gltf = await new GLTFLoader().loadAsync(MODEL_URL, (event) => {
      if (event.total > 0) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setLoading(`${percent}%`);
      }
    });

    const model = gltf.scene;
    removeOversizedOutliers(model);
    normalizeModel(model);
    assignBlueprintMaterials(model);
    buildEdgeOverlay(model);
    loadedRoot.add(model);

    fitCameraToModel(model);
    onResize();

    await waitForFrame();

    setLoading('');
    document.querySelector('.hud')?.classList.add('is-ready');
    renderer.setAnimationLoop(animate);
  } catch (error) {
    console.error(error);
    setLoading('Load failed');
  }
}

function removeOversizedOutliers(root) {
  const removals = [];
  root.updateWorldMatrix(true, true);

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const displayName = `${child.name || ''} ${child.geometry.name || ''}`;
    if (displayName.includes('笔画') || displayName.includes('行数')) {
      removals.push(child);
      return;
    }

    child.geometry.computeBoundingBox();
    const materialNames = getMaterialNames(child);
    const isScaledEquipment = materialNames.some((name) => name.includes('设备材质'));
    const box = child.geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const maxLocalDimension = Math.max(size.x, size.y, size.z);
    const worldBox = new THREE.Box3().setFromObject(child);
    const worldSize = worldBox.getSize(new THREE.Vector3());
    const maxWorldDimension = Math.max(worldSize.x, worldSize.y, worldSize.z);

    if (
      (maxLocalDimension > OUTLIER_DIMENSION_LIMIT && !isScaledEquipment) ||
      maxWorldDimension > OUTLIER_WORLD_DIMENSION_LIMIT
    ) {
      removals.push(child);
    }
  });

  for (const mesh of removals) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
}

async function setupRenderer() {
  if (!navigator.gpu?.requestAdapter) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new Error('No WebGPU adapter is available.');
  }

  renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  await renderer.init();

  if (renderer.backend?.isWebGPUBackend !== true) {
    renderer.dispose();
    renderer = null;
    throw new Error('The renderer did not initialize with a WebGPU backend.');
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.84;
  renderer.setClearColor(BACKGROUND_COLOR, 1);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.minDistance = 7;
  controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.49;

  detailMaterial = createDetailMaterial();
  setupCameraFilter();
}

function setupCameraFilter() {
  sceneRenderTarget = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,
    samples: SCENE_MSAA_SAMPLES,
    type: THREE.HalfFloatType,
  });
  sceneRenderTarget.texture.name = 'camera filter source';

  cameraHueUniform = uniform(CAMERA_HUE);
  cameraSaturationUniform = uniform(CAMERA_SATURATION);
  cameraBrightnessUniform = uniform(CAMERA_BRIGHTNESS);
  cameraBloomStrengthUniform = uniform(CAMERA_BLOOM_STRENGTH);

  const sceneColor = texture(sceneRenderTarget.texture);
  const filteredRgb = saturation(
    hue(sceneColor.rgb, cameraHueUniform),
    cameraSaturationUniform,
  ).mul(cameraBrightnessUniform);
  const filteredColor = vec4(filteredRgb, sceneColor.a);
  const bloomColor = bloom(
    filteredColor,
    cameraBloomStrengthUniform,
    CAMERA_BLOOM_RADIUS,
    CAMERA_BLOOM_THRESHOLD,
  );

  renderPipeline = new RenderPipeline(renderer);
  const cameraFilteredOutput = renderOutput(
    filteredColor.add(bloomColor),
    renderer.toneMapping,
    renderer.outputColorSpace,
  );
  renderPipeline.outputColorTransform = false;
  renderPipeline.outputNode = CAMERA_FXAA_ENABLED
    ? fxaa(cameraFilteredOutput)
    : cameraFilteredOutput;

  window.setCameraFilter = ({
    hue: hueValue,
    saturation: saturationValue,
    brightness: brightnessValue,
    bloomStrength,
  } = {}) => {
    if (hueValue !== undefined) cameraHueUniform.value = hueValue;
    if (saturationValue !== undefined) cameraSaturationUniform.value = saturationValue;
    if (brightnessValue !== undefined) cameraBrightnessUniform.value = brightnessValue;
    if (bloomStrength !== undefined) cameraBloomStrengthUniform.value = bloomStrength;
  };
}

function createDetailMaterial() {
  const depthDistance = viewportLinearDepth.distance(linearDepth());
  const depthAlphaNode = depthDistance.oneMinus().smoothstep(0.9, 2).mul(10).saturate();
  const depthBlurred = hashBlur(
    viewportSharedTexture(),
    depthDistance.smoothstep(0, 0.6).mul(40).clamp().mul(DEVICE_BACKDROP_BLUR),
    { repeats: DEVICE_BACKDROP_BLUR_REPEATS },
  );

  const material = new MeshBasicNodeMaterial({
    name: 'device backdrop area',
    color: DEVICE_COLOR,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  material.backdropNode = depthBlurred.add(
    depthAlphaNode.mix(tslColor(DEVICE_COLOR.getHex()).mul(0.3), tslFloat(0)),
  );
  return material;
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const largestSide = Math.max(size.x, size.y, size.z);
  const scale = TARGET_SIZE / largestSide;

  model.position.sub(center);
  model.scale.setScalar(scale);
  model.updateWorldMatrix(true, true);

  const fittedBox = new THREE.Box3().setFromObject(model);
  model.position.y -= fittedBox.min.y;
  model.updateWorldMatrix(true, true);
}

function assignBlueprintMaterials(root) {
  const sceneBox = new THREE.Box3().setFromObject(root);
  const sceneSize = sceneBox.getSize(new THREE.Vector3());

  root.traverse((child) => {
    if (!child.isMesh) return;

    const materialNames = getMaterialNames(child);
    child.castShadow = true;
    child.receiveShadow = true;
    child.geometry.computeBoundingBox();
    if (!child.geometry.attributes.normal) {
      child.geometry.computeVertexNormals();
    }

    const meshBox = new THREE.Box3().setFromObject(child);
    const meshSize = meshBox.getSize(new THREE.Vector3());
    const footprint = Math.max(meshSize.x, meshSize.z);
    const isLowSlab =
      meshSize.y < Math.max(sceneSize.y * 0.035, 0.08) &&
      footprint > Math.max(sceneSize.x, sceneSize.z) * 0.14;
    const longestSide = Math.max(meshSize.x, meshSize.y, meshSize.z);
    const isDetail = longestSide < sceneSize.length() * 0.055;
    const isOuterWall =
      !isLowSlab &&
      meshSize.y > sceneSize.y * 0.32 &&
      footprint > Math.max(sceneSize.x, sceneSize.z) * 0.38;
    const isLabWall = materialNames.some((name) => name.includes('实验室墙壁材质'));
    const isNamedWall = materialNames.some((name) => name.includes('4楼_墙壁材质'));
    const isNamedOuterWall = materialNames.some((name) => name.includes('4楼_楼体材质'));
    const isNamedFloor = materialNames.some((name) => name.includes('楼层地板'));
    const isNamedEquipment = materialNames.some((name) => name.includes('设备材质'));

    child.userData.blueprintRole = isLabWall
      ? 'lab-wall'
      : isNamedOuterWall || isOuterWall
        ? 'outer-wall'
        : isNamedWall
          ? 'wall'
          : isNamedFloor || isLowSlab
            ? 'floor'
            : isNamedEquipment || isDetail
              ? 'detail'
              : 'wall';

    if (child.userData.blueprintRole === 'detail') {
      child.renderOrder = 2;
    }

    child.material = child.userData.blueprintRole === 'floor'
      ? floorMaterial
      : child.userData.blueprintRole === 'detail'
        ? detailMaterial
        : child.userData.blueprintRole === 'lab-wall'
          ? labWallMaterial
          : child.userData.blueprintRole === 'outer-wall'
          ? outerWallMaterial
          : wallMaterial;
  });
}

function getMaterialNames(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.filter(Boolean).map((material) => material.name || '');
}

function buildEdgeOverlay(root) {
  root.updateWorldMatrix(true, true);

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const edges = new THREE.EdgesGeometry(child.geometry, EDGE_THRESHOLD);
    const isDetail = child.userData.blueprintRole === 'detail';
    const isLabWall = child.userData.blueprintRole === 'lab-wall';
    const isOuterWall = child.userData.blueprintRole === 'outer-wall';
    const line = new THREE.LineSegments(
      edges,
      isDetail
        ? fineEdgeMaterial
        : isLabWall
          ? labEdgeMaterial
          : isOuterWall
            ? outerEdgeMaterial
            : edgeMaterial,
    );
    line.matrixAutoUpdate = false;
    line.matrix.copy(child.matrixWorld);

    const glowLine = new THREE.LineSegments(
      edges.clone(),
      isDetail ? deviceGlowEdgeMaterial : glowEdgeMaterial,
    );
    glowLine.matrixAutoUpdate = false;
    glowLine.matrix.copy(child.matrixWorld);
    glowLine.scale.setScalar(1.002);

    const lineRenderOrder = isDetail ? 3 : 1;
    line.renderOrder = lineRenderOrder;
    glowLine.renderOrder = lineRenderOrder;

    if (isDetail) {
      deviceOutlineScene.add(line);
      deviceOutlineScene.add(glowLine);

      const depthMesh = new THREE.Mesh(child.geometry, deviceDepthMaterial);
      depthMesh.matrixAutoUpdate = false;
      depthMesh.matrix.copy(child.matrixWorld);
      depthMesh.renderOrder = 0;
      deviceDepthScene.add(depthMesh);

      const glowMesh = new THREE.Mesh(child.geometry, deviceSurfaceGlowMaterial);
      glowMesh.matrixAutoUpdate = false;
      glowMesh.matrix.copy(child.matrixWorld);
      glowMesh.renderOrder = 1;
      deviceGlowScene.add(glowMesh);
    } else {
      scene.add(line);
      scene.add(glowLine);
    }

    if (!isDetail) {
      const bloomLine = new THREE.LineSegments(
        edges.clone(),
        isLabWall ? labBloomEdgeMaterial : isOuterWall ? outerBloomEdgeMaterial : bloomEdgeMaterial,
      );
      bloomLine.matrixAutoUpdate = false;
      bloomLine.matrix.copy(child.matrixWorld);
      bloomLine.renderOrder = 1;
      scene.add(bloomLine);
    }
  });
}

function fitCameraToModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5;
  const distance = radius * 1.92;
  const target = center.clone().add(new THREE.Vector3(0, -radius * 0.11, 0));

  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(distance * 0.48, distance * 0.78, distance * 1.02));
  camera.near = Math.max(radius / 160, 0.03);
  camera.far = radius * 8;
  camera.updateProjectionMatrix();
  controls.update();
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  sceneRenderTarget?.setSize(Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  controls.update();
  renderRealtimePreview();
  samplesEl.textContent = 'Realtime';
}

function renderRealtimePreview() {
  renderer.setRenderTarget(sceneRenderTarget);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(deviceDepthScene, camera);
  renderer.render(deviceGlowScene, camera);
  renderer.render(deviceOutlineScene, camera);
  renderer.setRenderTarget(null);
  renderPipeline.render();
  renderer.autoClear = true;
}

function setLoading(value) {
  loadingEl.textContent = value;
  if (value) {
    document.querySelector('.hud')?.classList.remove('is-ready');
  }
}

window.addEventListener('resize', onResize);

function waitForFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
