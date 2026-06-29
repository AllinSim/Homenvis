# Homenvis

**English** | [中文](./README.md)

This is an indoor flow simulation system based on the Lattice Boltzmann Method (LBM), supporting 3D fluid and temperature field computation via WebGPU / CPU with real-time 3D visualization. No software to install. Open the page and you can: build a room → place furniture/appliances → set boundary conditions → run the simulation → visualize results in 3D. All computation runs locally in the browser (WebGPU first, automatic CPU fallback).

**This is an exploratory experimental demo designed to identify practical implementation pathways and unlock the full potential of CFD for everyday scenarios. We are fully confident that CFD technology will eventually break down professional barriers, permeate every aspect of people’s basic needs including clothing, food, housing and transportation, and become an indispensable part of daily life.**

**All in simulation, all in future.**

Author:
- [Haocheng Wen](https://github.com/thuwen)

Correspondence via [mail](mailto:623127794@qq.com) (Haocheng Wen).

---

## ✨ Key Features

### Simulation Engine
- **WebGPU-accelerated LBM solver**: D3Q19 Lattice Boltzmann Method. The collision step is solved in parallel via GPU compute shaders; automatically falls back to CPU when WebGPU is unavailable.
- **Realistic physics**: buoyancy-driven natural convection (temperature differences), mechanical ventilation, swing (air-conditioner horizontal sweep), multiple heat sources, solar radiation heat load, and pollutant concentration transport.
- **Adjustable grid**: automatically discretized from room dimensions, supporting fine grids up to millions of cells.

### Modeling
- **Visual room building**: drag-and-drop walls, furniture, appliances, vents, heat sources, doors and windows directly in the 3D scene.
- **Rich device library**: **33 built-in appliance** models covering air conditioners (wall-mounted / cabinet / ceiling), range hoods (side-draft / bottom-suction), exhaust fans, air purifiers, heaters, heat pumps, TVs, etc. Each comes with correct outlet/return geometry and boundary conditions, supporting rotation and multiple operating modes.
- **Furniture library**: **54 built-in** furniture items (sofas, tables, chairs, beds, cabinets, partitions, etc.). Composite furniture is rasterized per sub-part so air can pass between table legs, closer to real flow.
- **Door & window openings**: walls support door/window openings through which air can flow.

### AI Smart Design
- Upload a floor plan or describe it in text, and **the AI automatically recognizes and generates the room layout**: walls, doors/windows, furniture, appliances and vents — all in one pass.
- Built-in geometry repair and validation: AI output is robustly repaired (windows are wall-attached thin-plates, device vents aligned, duplicate heat sources merged, etc.) to guarantee it is simulation-ready.

### Visualization
- **3D volume rendering** (Volume Cloud): 3D cloud maps of velocity / temperature / pressure fields, with adjustable upper/lower thresholds, opacity and sampling density.
- **Multi-slice cross-sections**: 2D field slices on any axis at any position; multiple slices can be shown simultaneously.
- **Color legend and scale**, with values converted directly to physical units.
- **Particle/vector visualization** and outlet/return-face highlighting.

### Usability
- **Sample rooms**: multiple preset scenarios (residential / office); load with one click and simulate, or import from a saved JSON layout.
- **Bilingual UI** (Chinese / English) via a custom i18n system.
- **Light/dark theme** toggle.
- **Reproducible results**: layouts and results can be exported as JSON.

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, TypeScript 5, Tailwind CSS v4 |
| 3D | Three.js + @react-three/fiber + @react-three/drei |
| Compute | WebGPU (compute shaders) + CPU fallback |
| Algorithm | D3Q19 Lattice Boltzmann Method (LBM) |
| i18n | Custom lightweight i18n (`i18n-dict.ts` + `i18n-context.tsx`) |

---

## 🚀 Quick Start (Local Development)

### Requirements
- **Node.js ≥ 20** (required by Next 16)
- A modern browser with WebGPU support (Chrome 113+ / Edge 113+) for GPU simulation; Firefox/Safari will automatically fall back to CPU.

> ⚠️ WebGPU requires **HTTPS** on non-`localhost` pages to be enabled. During local development `next dev` runs on `localhost` by default, so GPU works directly; to access via an IP on the LAN, configure HTTPS (see the `--experimental-https` in the `dev` script).

### Install & Run

```bash
git clone https://github.com/AllinSim/Homenvis
cd Homenvis
npm install
npm run dev
```

Default dev server (with HTTPS, useful for enabling WebGPU when accessing via LAN IP):

```
https://localhost:3004
```

For HTTP-only local access:

```bash
npm run dev:http      # http://localhost:3004
```

### Production Build

```bash
npm run build
npm run start         # http://localhost:3004
```

---

## 📖 Usage

1. **Build the room**: the home page opens with an empty room by default. Set the room dimensions in the left "Modeling" panel, then drag in walls, furniture, appliances, doors and windows.
2. **Set boundary conditions**: in the "Boundary Conditions / Simulation Step" panel, configure vent velocity/temperature, heat sources, device operating modes, swing, etc.
3. **Run the simulation**: click "Start Simulation" at the top; a progress modal shows iteration progress.
4. **View results**: in the 3D view, use "Display Controls" to switch between velocity / temperature / pressure fields, adjust volume thresholds, opacity and slice positions, and observe the flow and temperature distribution in 3D.
5. **Save / Share**: export the layout and simulation results as JSON for later import and reproduction.

> Don't want to start from scratch? Load a preset scenario from "Sample Rooms" with one click and simulate right away.

---

## 📁 Project Structure

```
Homenvis/
├── src/
│   ├── app/                      # Next.js App Router pages & routes
│   ├── components/               # React components (3D view, modeling/control panels, ...)
│   │   ├── FlowViewer3D.tsx      # Main 3D visualization view
│   │   ├── ModelingPanel.tsx     # Modeling panel
│   │   ├── SimulationStepPanel.tsx # Simulation step / boundary conditions panel
│   │   └── ...
│   └── lib/
│       ├── lbm-engine.ts         # LBM solver core (WebGPU/CPU)
│       ├── lbm-shaders.ts        # WGSL compute shaders
│       ├── room-layout.ts        # Room layout model & boundary-condition conversion
│       ├── device-library.ts     # Appliance device library
│       ├── furniture-library.ts  # Furniture library
│       ├── sample-rooms.ts       # Sample rooms
│       ├── ai-layout-prompt.ts   # AI smart-design prompt
│       ├── ai-layout-builder.ts  # AI output parsing & geometry repair
│       └── i18n-dict.ts          # zh/en dictionary
├── scripts/
│   └── json-to-sample.mjs        # Convert a saved layout JSON into sample-room code
├── deploy/
│   └── nginx-homenvis.conf       # Example production Nginx reverse-proxy config
├── ecosystem.config.js           # pm2 process-guard config
└── docs/                         # Documentation
```

---

## 🖥️ Production Deployment

See [`docs/deployment.md`](./docs/deployment.md). Quick steps:

```bash
# On the server
npm ci
npm run build
pm2 start ecosystem.config.js     # daemonize + auto-start on boot
# Configure Nginx reverse proxy + Let's Encrypt HTTPS (WebGPU requires HTTPS)
```

> Production must use HTTPS, otherwise users' browsers cannot enable WebGPU and will fall back to CPU, with significantly worse performance.

---

## 📚 Documentation

- [`docs/deployment.md`](./docs/deployment.md) — Full production deployment guide (Nginx + pm2 + HTTPS)
- [`docs/BUOYANCY.md`](./docs/BUOYANCY.md) — Buoyancy-driven natural convection implementation notes

---

## ⚠️ Browser Compatibility

| Browser | Simulation Mode | Notes |
|---------|-----------------|-------|
| Chrome / Edge 113+ | ✅ WebGPU | Recommended, best performance |
| Firefox | ⚠️ CPU fallback | WebGPU support is experimental in some versions |
| Safari | ⚠️ CPU fallback | WebGPU support varies by version |

For the full GPU-accelerated experience, use the latest Chrome / Edge.

---

## 🤝 Contributing

Issues and PRs are welcome. To add a sample room, refer to `scripts/json-to-sample.mjs` — it converts a layout JSON saved from the web UI into code registered in `sample-rooms.ts` with one command.

---

## 📄 License

This project uses AGPLv3 / Commercial Dual License.

✅ **Free open-source use**: comply with AGPLv3, public SaaS deployment requires open-sourcing modified code;

💰 **Commercial License available**: closed-source privatization, white-label, commercial resale allowed.
