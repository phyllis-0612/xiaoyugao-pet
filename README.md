# 小鱼糕桌宠 Xiaoyugao Pet

鱼仔与奶盖的小猫鱼，住在 SillyTavern 页面里。她会呼吸、眨眼、吐出会上浮消散的泡泡，也会跟随聊天状态点头、蹦跳、犯迷糊、睡觉和挥爪。

## 功能

- 透明悬浮桌宠，支持鼠标和手机触摸拖动，自动保存位置
- 点击、Enter 或空格摸摸小鱼糕
- 自然呼吸与约每 4.7 秒一次的眨眼
- 嘴边持续生成动态泡泡：上浮、摇摆、缩放并淡出
- 自动响应 SillyTavern 的发送、思考、流式回复完成、停止和切换聊天事件
- 八种状态：`idle`、`listening`、`thinking`、`happy`、`confused`、`petting`、`sleeping`、`wave`
- 设置面板可调整显示、大小、透明度、气泡和减少动态效果
- 适配 iPhone 安全视口、触摸拖动和屏幕旋转
- 不调用模型，不读取或发送聊天正文，不额外消耗 token

## 安装

1. 解压下载包。
2. 确认最外层目录中直接包含 `xiaoyugao-pet/manifest.json`。
3. 将整个 `xiaoyugao-pet` 文件夹放进：

   ```text
   SillyTavern/data/<你的用户目录>/extensions/
   ```

4. 重启 SillyTavern，或刷新酒馆页面。
5. 打开“扩展”设置，展开“小鱼糕桌宠”调整大小、透明度和动作。

## 操作

- 点小鱼糕：摸摸她
- 拖小鱼糕：移动位置，松手后自动保存
- 设置 → 扩展 → 小鱼糕桌宠：预览八种状态或重置位置
- 直接打开 `preview.html`：在不启动酒馆时检查动作

## 给其他扩展联动

```js
window.dispatchEvent(new CustomEvent('xiaoyugao:react', {
    detail: { state: 'happy', message: '找到啦！', duration: 1800 },
}));
```

也可以使用 `window.XiaoyugaoPet.react('sleeping', '困嘟嘟…', 3000)`。

## 主要文件

- `index.js`：酒馆事件、拖动、设置和状态机
- `pet-renderer.js`：透明皮肤播放器、动作和动态泡泡
- `assets/xiaoyugao-base-v1.png`：睁眼透明主皮肤
- `assets/xiaoyugao-closed-eyes-v1.png`：闭眼透明皮肤
- `preview.html`：独立动作预览页

## 性能与隐私

- 聊天页最高约 24 FPS，设置预览约 12 FPS；开启“减少动态效果”后进一步降频
- 页面进入后台时暂停实际绘制
- 流式事件仅触发动作，不读取 token 文本
- 没有网络请求、追踪、遥测或第三方依赖

## License

[MIT](LICENSE)
