# 家见 · Homenvis

[English](./README.en.md) | **中文**

<div align="center">
  <img src="/docs/images/project_logo.png" alt="project logo" height="200"/>
</div>

本项目是一个基于格子玻尔兹曼方法（Lattice Boltzmann Method）的室内流动仿真系统，支持通过 WebGPU / CPU 进行三维流体与温度场计算，并提供实时三维可视化。无需安装任何软件，打开网页即可：搭房间 → 摆家具/电器 → 设边界条件 → 一键仿真 → 三维可视化查看结果。全部计算在浏览器本地完成（WebGPU 优先，不支持时自动回退 CPU）。

**这是一款探索先行的实验Demo，旨在挖掘CFD走进日常场景的落地路径与无限潜能。我们满怀信心，未来CFD技术终将打破专业壁垒，融入衣食住行的每一处细节，成为日常生活不可或缺的一部分。**

**尽在仿真，尽向未来。All in simulation, all in future.**

作者：
- [Haocheng Wen](https://github.com/thuwen)

有任何疑问可[邮件联系](mailto:623127794@qq.com) (Haocheng Wen).

在线使用网址：https://homenvis.allinsim.com (必须启用https，否则无法使用WebGPU)

<img src="/docs/images/main_page_zh.png" alt="main page" height="500"/>

---

## ✨ 核心特性

### 仿真引擎
- **WebGPU 加速的 LBM 求解器**：D3Q19 格子玻尔兹曼方法，碰撞步用 GPU compute shader 并行求解，无 GPU 或不支持 WebGPU 时自动回退到 CPU。
- **真实物理过程**：浮力驱动自然对流（温度差）、机械通风、扫风（空调左右摆动）、多热源、太阳辐射热负荷、污染物浓度扩散。
- **可调网格**：根据房间尺寸自动剖分，支持细到上百万格的网格规模。

### 建模
- **可视化房间搭建**：三维场景里直接拖拽摆放墙体、家具、电器、通风口、热源、门窗。
- **丰富的设备库**：内置 **33 款电器**模型，覆盖空调（壁挂/柜机/吸顶）、油烟机（侧吸/下吸）、换气扇、空气净化器、取暖器、热泵、电视等，每款均带正确的出/回风口几何与边界条件，支持旋转与多工作模式。
- **家具库**：内置 **54 款**家具（沙发、桌椅、床、柜、隔断等），部分组合家具按子部件栅格化，桌腿间可透气，更贴近真实流场。
- **门窗开洞**：墙体支持门洞/窗洞，洞口处气流可通过。

### AI 智能设计
- 上传户型图或文字描述，**AI 自动识别并生成房间布局**：墙体、门窗、家具、电器、通风口一站式布置。
- 内置几何修复与校验：AI 输出经鲁棒性修复（窗户自动贴墙薄板化、设备风口对齐、重复热源合并等），保证可仿真。

### 可视化
- **三维体绘制**（Volume Cloud）：速度/温度/压强场的三维云图，可调上下限阈值、透明度、采样密度。
- **多截面切片**：任意轴、任意位置的二维切片场图，支持同时显示多片。
- **颜色图例与色标**，物理单位直接换算显示。
- **粒子/矢量可视化**与设备出回风面高亮。

### 易用性
- **样板间**：内置多个预设工况（住宅 / 办公），一键载入即可仿真，也支持从保存的 JSON 布局导入。
- **中英双语**界面（自定义 i18n）。
- **明暗主题**切换。
- **仿真结果可保存/复现**：布局与结果可导出为 JSON。

---

## 🧰 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Next.js 16（App Router，Turbopack） |
| UI | React 19、TypeScript 5、Tailwind CSS v4 |
| 三维 | Three.js + @react-three/fiber + @react-three/drei |
| 计算 | WebGPU（compute shader）+ CPU 回退 |
| 算法 | D3Q19 格子玻尔兹曼方法（LBM） |
| 国际化 | 自研轻量 i18n（`i18n-dict.ts` + `i18n-context.tsx`） |

---

## 🚀 快速开始（本地开发）

### 环境要求
- **Node.js ≥ 20**（Next 16 要求）
- 支持 WebGPU 的现代浏览器（Chrome 113+ / Edge 113+）用于 GPU 仿真；Firefox/Safari 会自动回退 CPU。

> ⚠️ WebGPU 在非 `localhost` 页面下**要求 HTTPS** 才会启用。本地开发时 `next dev` 默认走 `localhost`，可直接用 GPU；若用 IP 访问需配 HTTPS（见 `dev` 脚本里的 `--experimental-https`）。

### 下载与安装

```bash
git clone https://github.com/AllinSim/Homenvis
cd Homenvis
npm install
```

### 生成自签名证书（HTTPS 开发用）

运行 `npm run dev`（HTTPS 模式）时需要 `cert.pem` 和 `key.pem` 两个证书文件。**这两个文件不包含在仓库中**，请在项目根目录执行以下命令自行生成：

```bash
# 生成有效期为 365 天的自签名证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```

生成后项目目录结构应包含：
```
Homenvis/
├── cert.pem           # 自签名证书（需自行生成，已加入 .gitignore）
├── key.pem            # 私钥（需自行生成，已加入 .gitignore）
└── ...
```

> 自签名证书在浏览器中会显示"不安全"警告，这是正常的，点击"高级"→"继续前往"即可。生产部署请使用 Let's Encrypt 等正规证书。

### 测试运行

以开发模式运行：

```bash
npm run dev
```

默认开发服务（含 HTTPS，便于在局域网用 IP 访问时启用 WebGPU）：

```
https://localhost:3004
```

若仅需 HTTP 本地访问：

```bash
npm run dev:http      # http://localhost:3004
```

### 生产构建

```bash
npm run build
npm run start         # http://localhost:3004
```

---

## 📖 使用方式

1. **搭建房间**：进入首页后默认为空房间。在左侧“建模”面板设置房间尺寸，拖入墙体、家具、电器、门窗。
2. **设置边界条件**：在“边界条件/仿真步”面板配置通风口风速/温度、热源、设备工作模式、扫风等。
3. **运行仿真**：点击顶部“开始仿真”，进度弹窗显示迭代进度。
4. **查看结果**：在三维视图用“显示控制”切换速度/温度/压强场，调节体绘制阈值、透明度、切片位置，三维观察气流与温度分布。
5. **保存/分享**：可将布局与仿真结果导出为 JSON，下次直接导入复现。

> 不想从零搭？点“样板间”一键载入预设场景，直接仿真体验。

<img src="/docs/images/simple_demo.gif" alt="simple demo" height="500"/>

---

## 📁 项目结构

```
Homenvis/
├── src/
│   ├── app/                      # Next.js App Router 页面与路由
│   ├── components/               # React 组件（三维视图、建模/控制面板等）
│   │   ├── FlowViewer3D.tsx      # 三维可视化主视图
│   │   ├── ModelingPanel.tsx     # 建模面板
│   │   ├── SimulationStepPanel.tsx # 仿真步/边界条件面板
│   │   └── ...
│   └── lib/
│       ├── lbm-engine.ts         # LBM 求解器核心（WebGPU/CPU）
│       ├── lbm-shaders.ts        # WGSL compute shader
│       ├── room-layout.ts        # 房间布局模型与边界条件转换
│       ├── device-library.ts     # 电器设备库
│       ├── furniture-library.ts  # 家具库
│       ├── sample-rooms.ts       # 样板间
│       ├── ai-layout-prompt.ts   # AI 智能设计提示词
│       ├── ai-layout-builder.ts  # AI 输出解析与几何修复
│       └── i18n-dict.ts          # 中英词典
├── scripts/
│   └── json-to-sample.mjs        # 把保存的布局 JSON 转成样板间代码
├── deploy/
│   └── nginx-homenvis.conf       # 生产 Nginx 反代配置示例
├── ecosystem.config.js           # pm2 进程守护配置
└── docs/                         # 文档
```

---

## 🖥️ 生产部署

详见 [`docs/deployment.md`](./docs/deployment.md)，简要步骤：

```bash
# 服务器上
npm ci
npm run build
pm2 start ecosystem.config.js     # 常驻 + 开机自启
# 配置 Nginx 反代 + Let's Encrypt HTTPS（WebGPU 必须 HTTPS）
```

> 生产环境务必配 HTTPS，否则用户浏览器无法启用 WebGPU、会降级到 CPU，性能显著下降。

---

## 📚 文档

- [`docs/deployment.md`](./docs/deployment.md) —— 生产部署（Nginx + pm2 + HTTPS）完整指南
- [`docs/BUOYANCY.md`](./docs/BUOYANCY.md) —— 浮力驱动自然对流的实现说明

---

## ⚠️ 浏览器兼容性

| 浏览器 | 仿真模式 | 说明 |
|--------|----------|------|
| Chrome / Edge 113+ | ✅ WebGPU | 推荐，性能最佳 |
| Firefox | ⚠️ CPU 回退 | 部分版本 WebGPU 实验性支持 |
| Safari | ⚠️ CPU 回退 | WebGPU 支持视版本而定 |

建议使用最新版 Chrome / Edge 体验完整 GPU 加速能力。

---

## 🤝 贡献

欢迎提 Issue 和 PR。新增样板间可参考 `scripts/json-to-sample.mjs`，把你在网页上保存的布局 JSON 一键转成代码注册进 `sample-rooms.ts`。

---

## 📄 许可证

本项目采用 AGPLv3 / 商业授权 双许可。

✅ **免费开源使用**： 需遵守 AGPLv3 协议；若对外部署公有 SaaS 服务，修改后的衍生代码必须公开开源；

💰 **可获取商业授权**： 支持闭源私有化部署、品牌贴牌、商业转售。

