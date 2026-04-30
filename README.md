# AI Backend Template - 安装与启动手册

本项目是一个企业级 Node.js 微服务模板，预置了 Express、Mongoose、Redis、BullMQ 等核心依赖，支持多环境配置与数据隔离。

## 1. 环境准备

在开始之前，请确保你的开发环境已安装以下软件：
- **Node.js**: 建议 v20.x 及以上版本
- **Docker**: 用于快速拉起本地数据库与缓存服务

## 2. 依赖安装

在项目根目录（或 `ai-backend-template` 目录）下运行以下命令安装 NPM 包：

```bash
cd ai-backend-template
npm install
```

## 3. 基础设施启动 (Docker)

项目依赖 MongoDB (4.0) 和 Redis (6380 端口)。你可以使用以下指令快速启动：

### 3.1 启动 MongoDB
```bash
docker run -d --name mongo4 -p 27017:27017 mongo:4.0
```

### 3.2 启动 Redis
注意：项目默认连接本地 6380 端口。
```bash
docker run -d --name local_redis -p 6380:6379 redis:latest
```

*如果你已有 `docker-compose.yml`，也可以直接运行 `docker-compose up -d`。*

## 4. 配置文件说明

配置文件位于 `config/` 目录下，遵循 `Base + Override` 逻辑：
- `static-config.json`: 静态基础配置（如 MongoDB URI）。
- `realtime-config.json`: 动态实时配置（如 Redis、Cron 任务）。
- `*-local.json` / `*-dev.json`: 环境特定覆盖。

## 5. 启动服务

### 5.1 本地开发模式 (Local)
连接 `ai-backend-local` 数据库，日志级别较低。
```bash
npm run local
```

### 5.2 开发调试模式 (Dev)
连接 `ai-backend-dev` 数据库，适用于团队协作联调环境。
```bash
npm run dev
```

### 5.3 生产模式 (Prod)
正式运行环境。
```bash
npm run start
```

## 6. 验证与联调

服务启动后，默认监听端口为 **17019**。

- **健康检查**：访问 `http://127.0.0.1:17019/`。
- **接口文档**：参考各个 `src/apps/*/doc/openapi.json` 文件，可直接导入 **APIFox** 进行接口联调。
- **微服务标识**：
  - 用户服务: `/api/users`
  - 核心服务: `/api/core`
  - 订单服务: `/api/orders`

---
git 操作
#  启用符号链接支持
git config core.symlinks true

#  重新拉取
git fetch origin
git reset --hard origin/main

# 创立后端分支
*祝开发愉快！*
