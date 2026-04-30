# AI Backend Template

基于 Node.js 的后端项目模板，遵循统一的 AI 后端开发规范。集成了多环境配置、AES-256-GCM 敏感数据加解密、Mongoose 自动加解密插件等核心功能。

## 🚀 快速启动

### 1. 安装依赖
```bash
npm install
```

### 2. 运行服务 (直接模式)
```bash
# 本地运行 (NODE_ENV=local)
npm run local

# 开发模式运行 (NODE_ENV=development)
npm run dev
```

---

## 🛠 PM2 进程管理

为了保障服务的稳定性与多环境隔离，推荐使用 PM2 进行进程管理。

### 1. 启动命令
项目已预置不同环境的配置文件，通过以下命令可快速启动：

| 运行环境 | 快捷脚本 (推荐) | 原始命令 | 特性 |
| :--- | :--- | :--- | :--- |
| **本地 (Local)** | `npm run pm2:local` | `pm2 start pm2-start-local.json` | 单实例，开启 `watch` (修改代码自动重启) |
| **开发 (Dev)** | `npm run pm2:dev` | `pm2 start pm2-start-dev.json` | 单实例，开启 `watch` |
| **生产 (Prod)** | `npm run pm2:prod` | `pm2 start pm2-start.json --env production` | **Cluster 集群模式 (Max 实例)**，关闭 watch |

### 2. 日志与监控
| 操作类型 | 命令指令 | 说明 |
| :--- | :--- | :--- |
| **查看服务列表** | `pm2 l` | 查看所有服务名称、ID、CPU、内存及状态 |
| **实时查看日志** | `pm2 logs` | 查看当前所有服务的控制台合并输出 |
| **查看特定日志** | `pm2 logs [id/name]` | 例如：`pm2 logs 0` 或 `pm2 logs ai-backend-api-local` |
| **图形化监控** | `pm2 monit` | 进入交互式仪表盘，监控进程资源消耗 |
| **停止/重启/删除** | `pm2 stop/restart/delete [target]` | 对指定 ID、Name 或 `all` 进行操作 |

---

## 📂 核心目录说明
- `config/`: 物理隔离的配置文件目录（静态配置 + 运行时配置）。
- `src/apps/`: 模块化业务逻辑（Micro-services 架构）。
- `src/lib/`: 通用工具库。
    - `crypto.js`: AES-256-GCM 标准加解密。
    - `mongoose-crypto-plugin.js`: 数据库字段透明加密插件。
- `src/routes/`: 统一路由网关与自动注册机制。
- `doc/`: 详细的开发规范与运维部署文档。

---

## 🔐 敏感信息加密说明
项目内置了 **AES-256-GCM** 加密支持。
- **配置密钥**：在各子应用的 `config.json` 中定义 `crypto.key`。
- **自动加解密**：在 Mongoose Model 中集成 `mongoose-crypto-plugin`，只需指定需要加密的字段即可，业务层读写完全透明。
