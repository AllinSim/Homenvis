// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Commercial
//
// Homenvis — LBM-based indoor airflow simulation.
// Copyright (c) 2026 Haocheng Wen / AllinSim. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public
// License along with this program.  If not, see
// <https://www.gnu.org/licenses/>.
//
// Commercial licenses are available. Contact AllinSim for details.

/**
 * pm2 进程守护配置 —— 让 Next.js 生产服务常驻并开机自启。
 *
 * 用法：
 *   pm2 start ecosystem.config.js
 *   pm2 save          # 保存当前进程列表
 *   pm2 startup       # 生成开机自启脚本（按提示执行它给的那条命令）
 *
 * 常用：
 *   pm2 status / pm2 logs homenvis / pm2 restart homenvis / pm2 delete homenvis
 *
 * 说明：
 *  - 走 npm run start（即 next start），生产模式，绑 127.0.0.1:3000，
 *    仅本机 Nginx 反代访问，不对外暴露端口。
 *  - 不要用 npm run dev（dev 带自签证书 --experimental-https，仅本地开发用）。
 */
module.exports = {
  apps: [
    {
      name: 'homenvis',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
