# Homenvis 生产部署指南

把 **家见·Homenvis** 部署到服务器、与已有网站并存上线的完整流程。本文档基于一次成功部署的实际记录整理。

## 背景

- 服务器：Linux，已运行 Nginx（master + worker）。
- 本项目要上线到独立域名 `homenvis.allinsim.com`。
- 技术栈：Next.js 16（Turbopack）/ React 19，强依赖 WebGPU（非 HTTPS / 非 localhost 下浏览器会禁用 WebGPU、降级 CPU，性能极差）—— **因此 HTTPS 是硬需求**。

## 整体架构

```
浏览器
  ├─ xxx.com           ──┐
  └─ homenvis.allinsim.com ──┤  Nginx (80/443)
                             │   ├─ server{ server_name xxx.com          → proxy_pass 127.0.0.1:原端口 }
                             │   └─ server{ server_name homenvis.allinsim.com → proxy_pass 127.0.0.1:3000   }
                             ▼
                       各自应用进程（pm2 守护）
```

两个域名 DNS 都指向同一台服务器公网 IP，Nginx 按 `server_name` 区分流，互不影响。3000 端口只在本机 `127.0.0.1` 监听，不对外暴露。

---

## 一、项目内的部署文件

仓库中已包含两个部署用文件：

- `ecosystem.config.js` —— pm2 进程守护配置（开机自启）。
- `deploy/nginx-homenvis.conf` —— Nginx 反代配置（域名 `homenvis.allinsim.com`）。
- `package.json` 的 `start` 脚本绑定为 `127.0.0.1:3000`，仅本机 Nginx 访问。

---

## 二、服务器装环境（首次）

```bash
# Node 20 LTS（Next 16 需要）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
sudo npm i -g pm2

# certbot（申请 Let's Encrypt 证书）
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## 三、上传代码并构建

> **不要上传 `node_modules`**：体积大且可能有平台相关的原生二进制。只传源码 + `package-lock.json`，服务器上 `npm ci` 安装。

只传必要文件：
- `src/`、`public/`（如有）、`ecosystem.config.js`、`deploy/`
- `package.json`、`package-lock.json`
- `next.config.*`、`tsconfig.json`、`postcss.config.*` 等配置

不要传：`node_modules/`、`.next/`、`key.pem`、`cert.pem`（本地 dev 自签证书，生产用 Let's Encrypt）。

```bash
cd /path/to/Homenvis
npm ci          # 按 lock 精确安装依赖
npm run build   # 生产构建（生成 .next）
```

> **构建位置选择**：
> - 推荐在服务器上构建 —— 零平台风险。
> - 服务器内存太小（< 2GB）容易 OOM 时，可在本地（必须同为 `linux x64`）构建后上传 `.next` + 运行时依赖，服务器上执行 `npm ci --omit=dev`，然后**不要** `npm run build`，直接 `pm2 start`。

---

## 四、用 pm2 常驻启动

```bash
pm2 start ecosystem.config.js
pm2 save          # 保存进程列表
pm2 startup       # 按它提示的那条命令执行，实现开机自启
pm2 status        # 看到 homenvis online 即可
```

验证 Next.js 在跑：

```bash
curl -I http://127.0.0.1:3000/
# 应返回 Next.js 响应
```

---

## 五、配置 Nginx 反向代理

### 5.1 把配置放到 Nginx 的加载目录（关键！）

Nginx 只会从以下路径加载配置，**放进项目目录（如 `deploy/`）不会被加载**：

```
include /etc/nginx/conf.d/*.conf;
include /etc/nginx/sites-enabled/*;
```

所以必须拷到这两个目录之一：

```bash
sudo cp deploy/nginx-homenvis.conf /etc/nginx/conf.d/homenvis.conf
```

> 踩坑记录：曾把 `nginx-homenvis.conf` 放在 `Homenvis/deploy/` 下，`nginx -T` 里完全看不到该配置，导致一直不生效。必须放到 `/etc/nginx/conf.d/` 或 `/etc/nginx/sites-enabled/`。

### 5.2 测试并重载

```bash
sudo nginx -t
sudo nginx -s reload
```

### 5.3 确认配置已被加载

```bash
sudo nginx -T 2>/dev/null | grep server_name
```

应能看到 `server_name homenvis.allinsim.com;` 出现。

`deploy/nginx-homenvis.conf` 内容（仅 80，HTTPS 由 certbot 自动改写）：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name homenvis.allinsim.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_buffering     off;
    }
}
```

### 5.4 验证 HTTP 80 已转发

```bash
curl -I http://homenvis.allinsim.com/
# 应返回 Next.js 响应
```

---

## 六、配置 DNS

在域名服务商后台（管理 `allinsim.com` 的地方）添加 A 记录：

```
A    homenvis.allinsim.com    →    服务器公网 IP
```

- 不要加端口（用户访问 `https://homenvis.allinsim.com/`，浏览器默认走 443，Nginx 转 3000 在内部完成）。
- DNS 生效有延迟（几分钟到几十分钟）。在你**本地电脑**（不是服务器）验证：

```bash
nslookup homenvis.allinsim.com
# 返回的 IP 必须是本服务器公网 IP
```

---

## 七、申请 HTTPS 证书（必须）

DNS 解析到本机、且 80 端口能从外网访问后（certbot 走 HTTP-01 验证走 80），申请证书：

```bash
sudo certbot --nginx -d homenvis.allinsim.com
```

按提示：
1. **Enter email address** → 填真实邮箱（用于证书过期提醒），**不要按 `c` 取消**。
2. 同意服务条款 → `Y`。
3. 是否分享邮箱给 EFF → `N`。
4. certbot 自动验证域名 → 改写 Nginx 配置加 443 SSL + 80→443 跳转。

### 交互式嫌麻烦，用一行命令（自动）：

```bash
sudo certbot --nginx -d homenvis.allinsim.com \
  --non-interactive --agree-tos -m 你的邮箱@xxx.com
```

完成后重载并验证：

```bash
sudo nginx -t && sudo nginx -s reload
curl -I https://homenvis.allinsim.com/
# 应返回 HTTP/2 200 + Next.js 标识
```

地址栏出现安全锁 → HTTPS 生效 → WebGPU 可正常启用。

---

## 八、最终验证清单

逐项确认：

```bash
# 1. DNS 解析到正确 IP（本地执行）
nslookup homenvis.allinsim.com

# 2. Nginx 配置已加载
sudo nginx -T 2>/dev/null | grep server_name   # 能看到 homenvis.allinsim.com

# 3. Next.js 进程在跑
pm2 status
curl -I http://127.0.0.1:3000/

# 4. HTTP 80 转发正常
curl -I http://homenvis.allinsim.com/

# 5. HTTPS 443 正常（最有代表性的一条）
curl -I https://homenvis.allinsim.com/          # HTTP/2 200

```

浏览器访问 `https://homenvis.allinsim.com/` 看到 Homenvis 首页且为安全锁 → 全链路完成。

---

## 九、日常运维

更新代码：

```bash
cd /path/to/Homenvis
git pull
npm ci
npm run build
pm2 restart homenvis
```

常用 pm2 命令：

```bash
pm2 status              # 查看状态
pm2 logs homenvis        # 查看日志
pm2 restart homenvis     # 重启
pm2 stop homenvis        # 停止
pm2 delete homenvis      # 删除
```

证书自动续期：certbot 装好后默认会装 systemd timer，可确认：

```bash
sudo systemctl list-timers | grep certbot
# 或手动测试续期流程
sudo certbot renew --dry-run
```

---

## 十、踩坑记录

| 现象 | 原因 | 解决 |
|------|------|------|
| `nginx -T` 看不到 homenvis 配置 | 配置放在项目目录 `deploy/`，Nginx 不读 | 拷到 `/etc/nginx/conf.d/homenvis.conf` |
| `curl https` 连不上 443 | 还没跑 certbot，只有 80 | 跑 `certbot --nginx -d homenvis.allinsim.com` |
| certbot 报需邮箱 | 进了交互式但按 `c` 取消 | 正常填邮箱，或用 `--non-interactive -m 邮箱` |
| 访问新域名显示旧网站内容 | Nginx 落到默认 `server_name _` 兜底 | 确认 homenvis 的 server 块已加载并 reload |
| 502 Bad Gateway | Nginx 正常但 3000 没进程 | `pm2 status` / `pm2 logs homenvis` |
| 域名拼错 `allinsim` ↔ `allsim` | 手误 | 确认实际域名是 `homenvis.allinsim.com` |
| WebGPU 不启用 / 极卡 | 非 HTTPS 或非 localhost | 必须配 HTTPS 证书 |

---

## 十一、要点总结

1. **生产模式**：`next build` + `next start`，不要用 `npm run dev`（带自签证书，仅供本地开发）。
2. **HTTPS 必装**：WebGPU 在非 HTTPS / 非 localhost 下被禁用。Let's Encrypt 证书免费、certbot 自动续期。
3. **同一台服务器多域名共存**：DNS 都指同一 IP，Nginx 按 `server_name` 分流，各自独立 server 块、各自证书、各自本地端口。
4. **内部端口不对外**：Next.js 绑 `127.0.0.1:3000`，防火墙只开 80/443。
5. **配置必须放到 Nginx 加载目录**：`/etc/nginx/conf.d/*.conf` 或 `sites-enabled/`，项目目录里的不会生效。