# GLB 新场景效果复刻任务流程

本文档用于在接入新的 GLB 模型时，按固定流程复刻当前场景的 WebGPU 蓝图风格渲染效果。目标是让新模型最终呈现和当前模型一致的视觉语言：黑色背景、蓝色透明墙体、高亮设备、设备 backdrop 模糊、设备发光、清晰轮廓线、实时交互。

文档中的 `[模型文件路径]`、`[主逻辑文件]`、`[页面入口文件]`、`[样式文件]` 为通用占位。接入新项目或新模型时，替换为实际路径。

## 1. 最终效果目标

新场景完成后应满足以下效果：

- 背景为纯黑或接近纯黑。
- 建筑墙体为深蓝透明材质，主要通过轮廓线表现结构。
- 实验室 / 重点区域墙体比普通墙体更亮，线条更明显。
- 外墙更暗，用于压住外围轮廓。
- 地板为暗蓝低透明材质，不抢设备主体。
- 设备为浅蓝高亮材质，带轻微透明和 backdrop 模糊。
- 设备有独立表面发光层。
- 设备轮廓线最亮。
- 墙体不遮挡设备轮廓线。
- 设备之间仍保持正常遮挡。
- 最终画面经过轻微色调、泛光、MSAA、FXAA 处理。
- 交互为实时模式，不使用路径追踪累积采样。

## 2. 接入新模型前检查

### 2.1 GLB 导出要求

从建模软件导出 GLB 前，先确认：

| 检查项 | 要求 |
| --- | --- |
| 文件格式 | `.glb` |
| 单位 | 模型比例合理，避免极端尺寸 |
| 原点 | 建议模型主体接近世界原点 |
| 墙体 | 墙体、外墙、重点区域墙体材质需要能区分 |
| 地板 | 地板材质需要能单独识别 |
| 设备 | 设备材质需要能单独识别 |
| 无关对象 | 删除文字、标注、辅助线、导出残留对象 |
| 相机 | 可以导出，但当前流程默认不用 GLB 相机 |

### 2.2 推荐材质命名

为了让脚本自动识别模型角色，新 GLB 推荐按下面方式命名材质：

| 模型类型 | 推荐材质名关键字 | 识别后的角色 |
| --- | --- | --- |
| 重点区域墙体 | `实验室墙壁材质` | `lab-wall` |
| 外墙 / 楼体 | `楼体材质` | `outer-wall` |
| 普通墙体 | `墙壁材质` | `wall` |
| 地板 / 楼板 | `楼层地板` | `floor` |
| 设备 / 机柜 / 桌椅 / 中心细节 | `设备材质` | `detail` |

如果新模型不能使用这些名称，需要在 `[主逻辑文件]` 的 `assignBlueprintMaterials()` 中补充新的关键字映射。

## 3. 新场景实现任务清单

按下面顺序执行，不建议跳步。

### Step 1：放入模型文件

把新 GLB 放到项目模型目录，并更新模型入口：

```js
const MODEL_URL = new URL('[模型文件路径]', import.meta.url).href;
```

完成标准：

- 浏览器能正常请求到 GLB。
- 控制台没有 404。
- `GLTFLoader` 能正常加载完成。

### Step 2：初始化 WebGPU 实时渲染

保持 WebGPU 渲染器配置：

```js
renderer = new WebGPURenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
```

并确认只使用 WebGPU：

```js
if (renderer.backend?.isWebGPUBackend !== true) {
  throw new Error('The renderer did not initialize with a WebGPU backend.');
}
```

完成标准：

- 页面能用 WebGPU 打开。
- 设备 backdrop 模糊生效。
- 场景交互不卡顿，不等待采样累积。

### Step 3：加载 GLB

加载模型：

```js
const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
const model = gltf.scene;
```

说明：

- 当前流程使用 `gltf.scene` 里的模型。
- 如果 GLB 导出了相机，默认不会使用。
- 如果必须使用 GLB 相机，需要额外读取 `gltf.cameras` 或相机节点。

完成标准：

- `model` 存在。
- 模型进入后续清理和材质流程。

### Step 4：清理异常对象

执行：

```js
removeOversizedOutliers(model);
```

当前清理规则：

```js
const OUTLIER_DIMENSION_LIMIT = 100000;
const OUTLIER_WORLD_DIMENSION_LIMIT = 90;
```

会移除名称包含以下关键字的对象：

```txt
笔画
行数
```

设备保护逻辑：

```js
const isScaledEquipment = materialNames.some((name) => name.includes('设备材质'));
```

完成标准：

- 无关文字、标注、异常大对象被移除。
- 设备没有被误删。
- 模型整体包围盒没有被异常对象撑大。

如果新模型有设备缺失：

1. 检查该对象原始材质名是否包含设备关键字。
2. 检查是否被异常尺寸逻辑删除。
3. 必要时给该类模型增加保护关键字。

### Step 5：模型归一化

执行：

```js
normalizeModel(model);
```

当前目标尺寸：

```js
const TARGET_SIZE = 22;
```

归一化会完成：

- 居中。
- 缩放到统一尺寸。
- 底部落到 `Y = 0`。

完成标准：

- 新模型在画面中大小接近当前场景。
- 相机适配后主体不会过小或过大。
- 地板或底部结构没有悬空。

### Step 6：分类模型角色

执行：

```js
assignBlueprintMaterials(model);
```

角色分类结果：

| 角色 | 对应模型 | 最终视觉 |
| --- | --- | --- |
| `lab-wall` | 重点区域墙体 | 较亮透明蓝墙体，线条更亮 |
| `wall` | 普通墙体 | 深蓝透明墙体 |
| `outer-wall` | 外墙 / 楼体 | 更暗的外围结构 |
| `floor` | 地板 / 楼板 | 暗蓝低透明平面 |
| `detail` | 设备 / 中心细节 | 浅蓝高亮、模糊、发光、亮轮廓 |

完成标准：

- 墙体没有被识别成设备。
- 设备没有被识别成墙体。
- 地板没有被识别成普通墙体。
- 重点区域墙体能和普通墙体区分。

调试方法：

```js
console.log(child.name, materialNames, child.userData.blueprintRole);
```

确认每类模型的 `blueprintRole` 是否正确。

### Step 7：应用颜色基线

保持当前颜色基线：

| 常量 | 基线值 | 用途 |
| --- | --- | --- |
| `BACKGROUND_COLOR_HEX` | `#000000` | 背景 |
| `DEVICE_COLOR_HEX` | `#5ea4ff` | 设备本体、设备轮廓、设备发光 |
| `EDGE_COLOR_HEX` | `#1147CF` | 普通墙体轮廓线 |
| `LAB_EDGE_COLOR_HEX` | `#84BBFF` | 重点区域墙体轮廓线 |
| `OUTER_EDGE_COLOR_HEX` | `#092F86` | 外墙轮廓线 |
| `GLOW_EDGE_COLOR_HEX` | `#235BE0` | 普通墙体弱发光线 |
| `LAB_BLOOM_EDGE_COLOR_HEX` | `#5A97FF` | 重点区域墙体发光线 |
| `OUTER_BLOOM_EDGE_COLOR_HEX` | `#0B31A0` | 外墙发光线 |
| `BLOOM_EDGE_COLOR_HEX` | `#174FD0` | 普通墙体发光线 |
| `LAB_WALL_COLOR_HEX` | `#467dff` | 重点区域墙体面 |
| `WALL_COLOR_HEX` | `#061A62` | 普通墙体面 |
| `OUTER_WALL_COLOR_HEX` | `#061F6F` | 外墙面 |
| `FLOOR_COLOR_HEX` | `#06122F` | 地板面 |
| `AMBIENT_LIGHT_COLOR_HEX` | `#2C6DFF` | 环境半球光 |
| `KEY_LIGHT_COLOR_HEX` | `#89B7FF` | 主方向光 |
| `RIM_LIGHT_COLOR_HEX` | `#1E67FF` | 轮廓方向光 |
| `ACCENT_LIGHT_COLOR_HEX` | `#2F74FF` | 局部点光 |

完成标准：

- 新场景整体仍是黑底蓝色蓝图风格。
- 设备比墙体更亮。
- 外墙比重点区域墙体更暗。

### Step 8：应用墙体和地板材质

保持当前透明度基线：

| 材质 | 基线透明度 | 用途 |
| --- | --- | --- |
| `labWallMaterial.opacity` | `0.05` | 重点区域墙体 |
| `wallMaterial.opacity` | `0.08` | 普通墙体 |
| `outerWallMaterial.opacity` | `0.12` | 外墙 |
| `floorMaterial.opacity` | `0.13` | 地板 |

完成标准：

- 墙体有透明蓝色体积感。
- 线条仍然是主要结构表现。
- 地板存在但不压过设备。

如果墙体太暗：

1. 先提高对应墙体线条 opacity。
2. 再提高对应墙体面 opacity。
3. 最后调相机亮度或泛光。

### Step 9：应用设备 backdrop 材质

设备材质使用 `MeshBasicNodeMaterial`：

```js
const material = new MeshBasicNodeMaterial({
  name: 'device backdrop area',
  color: DEVICE_COLOR,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthWrite: true,
});
```

设备透明度基线：

```js
opacity: 0.2
```

backdrop 模糊基线：

```js
const DEVICE_BACKDROP_BLUR = 0.15;
const DEVICE_BACKDROP_BLUR_REPEATS = 96;
```

完成标准：

- 设备不是普通透明效果。
- 设备表面能看到背景被轻微模糊。
- 模糊没有明显白色颗粒。
- 设备仍然保留蓝色实体感。

如果设备太透明：

- 提高 `createDetailMaterial()` 中的 `opacity`。

如果设备模糊不明显：

- 提高 `DEVICE_BACKDROP_BLUR`。

如果模糊有颗粒：

- 降低 `DEVICE_BACKDROP_BLUR`。
- 或提高 `DEVICE_BACKDROP_BLUR_REPEATS`。

### Step 10：应用设备发光层

设备发光材质基线：

```js
const deviceSurfaceGlowMaterial = new THREE.MeshBasicMaterial({
  color: DEVICE_COLOR,
  transparent: true,
  opacity: 0.2,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});
```

完成标准：

- 设备整体比墙体明显更亮。
- 发光不糊成一团。
- 设备细节轮廓仍然清楚。

如果设备太亮：

- 降低 `deviceSurfaceGlowMaterial.opacity`。
- 降低 `CAMERA_BLOOM_STRENGTH`。

如果设备不够亮：

- 提高 `deviceSurfaceGlowMaterial.opacity`。
- 适当提高 `fineEdgeMaterial.opacity`。

### Step 11：生成轮廓线

执行：

```js
buildEdgeOverlay(model);
```

边线生成参数：

```js
const EDGE_THRESHOLD = 14;
```

轮廓线基线：

| 材质 | 基线透明度 | 用途 |
| --- | --- | --- |
| `fineEdgeMaterial.opacity` | `1` | 设备主轮廓 |
| `deviceGlowEdgeMaterial.opacity` | `0.05` | 设备弱发光轮廓 |
| `labEdgeMaterial.opacity` | `0.36` | 重点区域墙体主轮廓 |
| `edgeMaterial.opacity` | `0.16` | 普通墙体主轮廓 |
| `outerEdgeMaterial.opacity` | `0.16` | 外墙主轮廓 |
| `labBloomEdgeMaterial.opacity` | `0.11` | 重点区域墙体发光轮廓 |
| `bloomEdgeMaterial.opacity` | `0.045` | 普通墙体发光轮廓 |
| `outerBloomEdgeMaterial.opacity` | `0.08` | 外墙发光轮廓 |

完成标准：

- 设备轮廓最亮。
- 重点区域墙体线条比普通墙体亮。
- 普通墙体和外墙线条不会抢设备主体。
- 线条数量和当前场景接近。

如果线太多：

- 提高 `EDGE_THRESHOLD`。

如果线太少：

- 降低 `EDGE_THRESHOLD`。

### Step 12：设置设备轮廓遮挡

必须保留三个设备辅助场景：

```js
const deviceDepthScene = new THREE.Scene();
const deviceGlowScene = new THREE.Scene();
const deviceOutlineScene = new THREE.Scene();
```

必须保留渲染顺序：

```js
renderer.render(scene, camera);
renderer.clearDepth();
renderer.render(deviceDepthScene, camera);
renderer.render(deviceGlowScene, camera);
renderer.render(deviceOutlineScene, camera);
```

完成标准：

- 墙体不会遮挡设备轮廓线。
- 设备之间仍然互相遮挡。
- 其他墙体、地板、外墙仍按正常深度显示。

如果设备轮廓被墙挡住：

- 检查是否调用了 `renderer.clearDepth()`。
- 检查设备轮廓是否进入 `deviceOutlineScene`。

如果设备之间不遮挡：

- 检查设备深度 mesh 是否进入 `deviceDepthScene`。
- 检查 `deviceDepthMaterial.depthWrite` 是否为 `true`。

### Step 13：设置相机

保持当前自动适配逻辑：

```js
fitCameraToModel(model);
```

说明：

- 新模型默认使用项目相机，不自动使用 GLB 内置相机。
- 相机根据模型包围盒适配。
- 如果只复刻材质效果，不建议改相机。

完成标准：

- 新模型完整出现在画面中。
- 视角和当前蓝图效果接近。
- 主体不会过远、过近或被裁切。

### Step 14：设置相机滤镜和后处理

保持当前基线：

| 参数 | 基线值 | 用途 |
| --- | --- | --- |
| `CAMERA_HUE` | `0.1` | 整体色调 |
| `CAMERA_SATURATION` | `1` | 饱和度 |
| `CAMERA_BRIGHTNESS` | `1` | 亮度 |
| `CAMERA_BLOOM_STRENGTH` | `0.05` | 泛光强度 |
| `CAMERA_BLOOM_RADIUS` | `0.35` | 泛光范围 |
| `CAMERA_BLOOM_THRESHOLD` | `0.35` | 泛光阈值 |

运行时临时调试：

```js
window.setCameraFilter({
  hue: 0.1,
  saturation: 1,
  brightness: 1,
  bloomStrength: 0.05,
});
```

完成标准：

- 画面整体色调和当前场景一致。
- 泛光轻微，不盖住模型细节。
- 设备有亮度，但没有大片过曝。

### Step 15：开启抗锯齿

保持当前抗锯齿基线：

| 参数 | 基线值 |
| --- | --- |
| renderer `antialias` | `true` |
| `SCENE_MSAA_SAMPLES` | `4` |
| `CAMERA_FXAA_ENABLED` | `true` |
| `MAX_DEVICE_PIXEL_RATIO` | `2` |

完成标准：

- 墙体斜线和设备边线锯齿明显减少。
- 交互仍然流畅。
- 没有因为像素比过高导致明显卡顿。

## 4. 最终验收清单

新场景完成后逐项检查：

| 验收项 | 通过标准 |
| --- | --- |
| WebGPU | 使用 WebGPU backend，非 WebGL fallback |
| 加载 | GLB 正常加载，无 404 |
| 清理 | 无关文字、异常对象不显示 |
| 模型完整 | 设备、墙体、地板没有误删 |
| 尺寸 | 模型居中、落地、大小合理 |
| 分类 | 墙体、地板、设备角色正确 |
| 背景 | 黑色背景 |
| 墙体 | 深蓝透明，线条表现结构 |
| 重点区域 | 比普通墙体更亮 |
| 外墙 | 比重点区域更暗 |
| 设备 | 浅蓝高亮，有模糊和发光 |
| 设备轮廓 | 最亮，墙体不遮挡 |
| 设备遮挡 | 设备之间互相遮挡 |
| 泛光 | 轻微，不糊细节 |
| 锯齿 | 无明显锯齿 |
| 交互 | OrbitControls 实时流畅 |

## 5. 推荐调试顺序

如果新模型效果和当前模型差异较大，按下面顺序调：

1. 确认模型角色分类是否正确。
2. 确认设备有没有被识别为 `detail`。
3. 确认墙体、外墙、地板是否分开。
4. 固定相机，不先改相机。
5. 调墙体透明度和墙体线条。
6. 调重点区域墙体亮度。
7. 调设备透明度、模糊、发光。
8. 调设备轮廓亮度。
9. 调整体滤镜和泛光。
10. 最后调抗锯齿和性能参数。

不要一开始就同时修改相机、颜色、透明度、泛光。否则无法判断差异来自哪一层。

## 6. 常见问题处理

### 新模型整体太小或太大

优先检查：

```js
const TARGET_SIZE = 22;
```

如果只是新模型导出尺寸差异，保持 `TARGET_SIZE` 不变即可。归一化会自动适配。若模型内部存在异常大对象，先处理异常对象清理，不要直接改相机。

### 模型有一部分不显示

优先检查：

- 是否被 `removeOversizedOutliers()` 删除。
- 原始材质名是否没有被识别。
- 该对象是否是设备但没有 `设备材质` 关键字。
- 该对象世界尺寸是否超过 `OUTLIER_WORLD_DIMENSION_LIMIT`。

### 墙体和设备效果混了

说明角色分类有问题。检查：

```js
child.userData.blueprintRole
```

墙体应为 `wall`、`lab-wall` 或 `outer-wall`，设备应为 `detail`。

### 设备没有 backdrop 模糊

检查：

- 浏览器是否启用 WebGPU。
- 设备是否进入 `detail`。
- 设备是否使用 `createDetailMaterial()`。
- `material.backdropNode` 是否存在。
- `DEVICE_BACKDROP_BLUR` 是否过低。

### 设备有白色颗粒

优先调整：

```js
DEVICE_BACKDROP_BLUR
DEVICE_BACKDROP_BLUR_REPEATS
CAMERA_BLOOM_STRENGTH
deviceSurfaceGlowMaterial.opacity
```

推荐先降低模糊半径，再提高采样次数。

### 设备轮廓被墙挡住

检查渲染顺序中是否有：

```js
renderer.clearDepth();
```

并确认设备轮廓加入的是：

```js
deviceOutlineScene
```

### 设备之间没有遮挡

检查设备深度层：

```js
deviceDepthScene
deviceDepthMaterial.depthWrite = true
```

设备深度层必须在设备发光和设备轮廓之前渲染。

### 画面锯齿明显

优先检查：

```js
SCENE_MSAA_SAMPLES
CAMERA_FXAA_ENABLED
MAX_DEVICE_PIXEL_RATIO
```

如果性能允许，可以提高 MSAA 或像素比；如果性能下降明显，保持当前基线。

## 7. 新场景复刻完成标准

当新模型满足以下条件时，可以认为复刻完成：

1. 新模型加载完整，角色分类正确。
2. 墙体、外墙、地板、设备层次明确。
3. 整体黑底蓝图风格和当前场景一致。
4. 设备带浅蓝高亮、backdrop 模糊、发光和高亮轮廓。
5. 墙体不遮挡设备轮廓，设备之间仍互相遮挡。
6. 泛光不过曝，细节不丢失。
7. 抗锯齿后边线足够平滑。
8. OrbitControls 实时交互流畅。
