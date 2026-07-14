# 浮力耦合（Boussinesq 自然对流）说明

本文档说明 RoomSim 中 LBM 浮力项的实现方式、参数推导与单位换算，供后续修改参考。

---

## 1. 物理模型

采用 **Boussinesq 近似**：密度变化只在重力项中保留，动量方程其余部分视为常密度。

体力（作用在 +z 竖直方向，z 向上为正）：

```
F = (0, 0,  ρ · g_lat · (T − T_ref))     // 热格(T>T_ref)上升, 冷格下沉
```

其中 `T` 是**无量纲温度**（∈[0,1]，由物理温度归一化得到），`T_ref` 是无量纲参考温度（室温）。

## 2. 数值方法：Guo 体力格式

在碰撞步（`COLLIDE_SHADER` / CPU `step_n`）中实现二阶精度的 Guo body-force 方案：

- **宏观速度含半力**：
  ```
  u = (Σ eᵢ fᵢ + F/2) / ρ
  ```
- **碰撞增加源项**：
  ```
  Sᵢ = (1 − ω/2) · wᵢ · [ 3(eᵢ−u)·F / cs² + 9(eᵢ·u)(eᵢ·F) / cs⁴ ]
  fᵢ_post = fᵢ + ω(feqᵢ − fᵢ) + Sᵢ
  ```

> 入口格（CELL_INLET）速度被强制指定，浮力对入口无效（物理正确）。
> `g_lat = 0` 时浮力完全关闭，向后兼容。

## 3. 关键参数

| 参数 | 含义 | 来源 |
|---|---|---|
| `g_lat` | 格子重力加速度系数（乘无量纲 T−T_ref 得格子力） | 物理换算，**不可手调** |
| `T_ref` | 无量纲参考温度（室温归一化值） | `(initialTemp − T_min)/(T_max − T_min)` |
| `dt_phys` | 每步物理时间（s） | 两个稳定性约束的较严者 |
| `u_scale` | 物理速度/格子速度 (m/s per lattice unit) | `dx / dt_phys` |
| `β` | 热膨胀系数 | `1 / (T_room + 273.15)` K⁻¹（理想气体） |
| `ΔT_span` | 无量纲 T∈[0,1] 对应的物理温区 | `T_max − T_min`（色标范围，默认 20K） |
| `ΔT_max` | 房间内**实际**最大温差 \|T_source − T_room\| | 运行时从 items 提取 |

## 4. 单位换算（核心）

```
物理浮力加速度:  a = g · β · ΔT_phys
格子重力系数:    g_lat = g · β · ΔT_span · dt_phys² / dx
```

- `g_lat` 乘的是**无量纲** (T − T_ref)，所以要用 `ΔT_span`（无量纲温区对应的物理 K 数）。
- `dt_phys` 一旦确定，`g_lat` 即唯一确定——**没有任何可调旋钮**。

## 5. dt_phys 的确定：两个约束取较严者

`dt_phys = dx / u_scale`，越小则 `u_scale` 越大。受两个独立物理稳定性约束：

**(A) 强制对流约束** —— 入口格速不超限：
```
U_in_max / u_scale ≤ U_LAT_CAP (0.1)
→ dt ≤ dx · U_LAT_CAP / U_in_max
```

**(B) 浮力稳定性约束** —— 满温差浮力终速不超 cs 的安全比例：
```
√(g_lat · (ΔT_max/ΔT_span) · Nz) ≤ U_BUOY_MAX (0.4·cs)
即 √(g·β·ΔT_max·dt²·Nz/dx) ≤ U_BUOY_MAX
→ dt ≤ U_BUOY_MAX · √(dx / (g·β·ΔT_max·Nz))
```

**取两者较小值**：`dt_phys = min(dt_forced, dt_buoy)`

### 为什么必须取较严者（历史教训）

早期版本曾让浮力约束**单独**决定 `dt_phys`，结果 `u_scale` 被锁死（与入口速度无关）。后果：
- 入口设 2 m/s 时，格速 `2/u_scale > 0.15` 被**静默截断**到 0.15，实际入口只有 ~0.9 m/s；
- 浮力仍是 ~0.76 m/s，与入口相当 → 冷气仍快速下沉；
- **调大入口风速压不动浮力**。

取较严者后，强入口时 (A) 收紧 → `dt` 变小 → `u_scale` 增大 → 浮力/入口比下降，强制对流主导。这才是正确行为。

## 6. 数值示例（默认房间 Nx=100, Nz=50, dx=0.05m, ΔT_max=24K）

| 入口风速 | 主导约束 | dt_phys | u_scale | 浮力(7K)/入口比 |
|---|---|---|---|---|
| 0.085 m/s | 浮力 (B) | 8.22 ms | 6.08 m/s | 8.9× （浮力主导，物理真实）|
| 0.5 m/s | 浮力 (B) | 8.22 ms | 6.08 m/s | 1.5× |
| 1.0 m/s | 强制对流 (A) | 5.00 ms | 10.0 m/s | 0.76× （气流开始主导）|
| 2.0 m/s | 强制对流 (A) | 2.50 ms | 20.0 m/s | 0.38× （气流明显主导）|
| 5.0 m/s | 强制对流 (A) | 1.00 ms | 50.0 m/s | 0.15× |

物理事实：室内几度温差的自然对流速度（~0.5 m/s）本来就远大于弱空调气流（0.085 m/s）。弱气流下浮力主导是**物理正确**，非 bug。

## 7. 代码位置

| 文件 | 内容 |
|---|---|
| `src/app/page.tsx` (~L100-150) | 参数推导：`dt_phys`、`u_scale`、`g_lat`、`T_ref`，写入 `LBMParams` |
| `src/lib/lbm-engine.ts` `LBMParams` 接口 | 新增 `g_lat`、`T_ref` 字段 |
| `src/lib/lbm-shaders.ts` `PARAMS_STRUCT` | uniform 扩展 `g_lat`(偏移32)、`T_ref`(偏移36) |
| `src/lib/lbm-shaders.ts` `COLLIDE_SHADER` | Boussinesq 力 + Guo 源项；新增 T 绑定(binding 10) |
| `src/lib/lbm-engine.ts` `LBMEngineCPU.step_n` | CPU 版同步实现（FxArr/FyArr/FzArr + Guo 源项）|
| `src/lib/lbm-engine.ts` uniform 写入 | offset 32/36 写 g_lat/T_ref；collide bind group 含 T |
| `src/lib/simulation-store.ts` `PhysicsParams` | 扩展 `g_lat`、`T_ref` |

## 8. 调参与修改指南

### 想增强/减弱整体浮力强度
**不要直接改 `g_lat`**（它是物理确定的）。正确做法是调 `dt_phys` 的约束参数：
- `U_BUOY_MAX`（默认 `0.4·cs`）：调小 → 浮力更弱、dt 更小、更多步。调大有失稳风险（<cs）。
- 注意：弱化浮力的物理正道是**增大入口风速**让 (A) 主导，而非动 `g_lat`。

### 想关掉浮力
设 `g_lat = 0`（或在 `LBMParams` 不传，引擎 fallback 默认 0）。着色器 `if (P.g_lat != 0.0)` 会跳过。

### 想改竖直方向
当前 z 向上。若改坐标约定，需同步改 `Fz` 作用方向（`COLLIDE_SHADER` 与 CPU）。

### 稳定性出问题（NaN/发散）
- 先查 `dt_phys` 是否被某约束算到过小（`u_scale` 过大 → 入口格速虽达标但其他量级失调）。
- 检查 `ΔT_max` 是否被异常源温度（如数据 bug 的 1.0°C）拉大。
- Smagorinsky LES 与 `MAX_LATTICE_SPEED=0.15` 兜底仍保留。

### 已知数据 bug（未修）
`room-layout.ts` `createDefaultRoom` 中窗户热源 `temperature: 1.0` 应为物理温度 °C（UI 新建默认 35）。它会被当成 1°C，使 `ΔT_max` 偏大（24K）。如需修正改为 35 左右。

## 9. 相关文件依赖
- 温度场更新（被动标量 advection-diffusion）：`TEMPERATURE_SHADER` / CPU 第7步，浮力读的就是这个 T。
- 速度场由 LBM 动量方程解出，浮力通过 Guo 源项反馈回动量 → 实现温度↔流动双向耦合（自然对流）。
