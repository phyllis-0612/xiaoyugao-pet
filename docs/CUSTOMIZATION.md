# 小鱼糕形象替换与二改指南

这份说明面向想保留控制器、替换形象或继续增加动作的人。运行时不需要构建工具，仓库中的图片可以直接由 SillyTavern 加载。

## 当前素材

所有坐姿透明层共用 `assets/layers.json` 记录的 1254 × 1254 源画布与坐标系：

| 文件 | 用途 |
| --- | --- |
| `xiaoyugao-base-v1.png` | 分层失败时的完整睁眼降级图 |
| `xiaoyugao-closed-eyes-v1.png` | 完整闭眼降级图 |
| `xiaoyugao-body-open-v1.png` | 去掉活动尾巴与耳鳍后的睁眼身体 |
| `xiaoyugao-body-closed-v1.png` | 同位置闭眼身体 |
| `xiaoyugao-tail-v1.png` | 独立尾巴 |
| `xiaoyugao-ear-left-v1.png` | 左侧耳鳍 |
| `xiaoyugao-ear-right-v1.png` | 右侧耳鳍 |
| `xiaoyugao-lying-open-v1.webp` | 趴姿睁眼 |
| `xiaoyugao-lying-closed-v1.webp` | 趴姿闭眼 |

图层必须保持相同画布尺寸和原点，不要裁成各自的最小边界，否则锚点会漂移。

## 锚点

`assets/layers.json` 保留了便于二改工具读取的坐标记录，当前值为：

| 图层 | 锚点 |
| --- | --- |
| 尾巴 | `(820, 1034)` |
| 左耳鳍 | `(276, 250)` |
| 右耳鳍 | `(779, 250)` |

修改角色比例后，应同时更新 `assets/layers.json` 和 `pet-renderer.js` 中的 `LAYER_PIVOTS`。更稳妥的后续做法，是让渲染器直接读取 JSON；目前保留代码内常量，以避免初始化时再增加一次异步请求。

## 替换步骤

1. 先导出一张完整睁眼图和完整闭眼图，背景必须透明。
2. 在同尺寸画布中拆出身体、尾巴、左右耳鳍，确认每层叠加后与完整图逐像素对齐。
3. 在尾根与耳根选择实际旋转点，更新锚点坐标。
4. 另行准备趴姿的睁眼／闭眼图；如果暂时没有，可在渲染器中停用 `lying` 形态。
5. 打开 `preview.html` 检查九种状态、左右游动、闭眼覆盖和分层接缝。
6. 运行回归测试后再提交。

## 可调整入口

- `pet-renderer.js` 的 `layerAngles()`：尾巴和耳鳍的速度、幅度、偏置。
- `drawPaintedSkin()`：整只小鱼糕在各状态下的位移、旋转和缩放。
- `getSwimStrideLength()`：游动时尾巴节奏与屏幕位移的换算。
- `index.js` 的自动游动常量：等待间隔、距离与持续时间。
- `companion.js` 的 `SCENES`：默认台词和设置面板中的场景列表。
- `style.css` 的 `172px` / `145px`：桌面与移动端默认占位。

## 验证

在仓库根目录执行：

```text
node --check index.js
node --check companion.js
node --check pet-renderer.js
node tools/test-companion.mjs
node tools/test-companion-controller.mjs
node tools/test-renderer.mjs
```

测试不安装第三方依赖，也不会读取真实聊天或调用模型。
