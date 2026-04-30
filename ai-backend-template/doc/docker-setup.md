# 本地依赖环境搭建与使用指南

本项目在本地开发时重度依赖 **MongoDB** (提供主数据库存储) 和 **Redis** (提供 BullMQ 队列和缓存功能)。为了保持你原生系统的干净不被占用，本项目统一推荐使用 Docker 命令行 (Docker CLI) 的方式独立运行这些底层服务。

---

## 1. 快速启动项目依赖服务

在你的终端中运行下面这些命令，将会在后台启动所需要的环境。

### 启动 MongoDB (版本 4.0.*)

**对于 macOS / Linux 经常使用的 `~` 目录：**
将宿主机的 `27017` 映射到容器，并将数据长期固化到本地：
```bash
docker run -d \
  --name mongo4 \
  -p 27017:27017 \
  -v ~/data/mongo4:/data/db \
  mongo:4.0.28
```

> **⭐ Windows 系统注意事项**
> 在 Windows 命令提示符 (CMD) 或 PowerShell 中，不支持 `~` 代表用户目录。你有两种选择：
> 1. **使用绝对路径**（注意盘符格式）：`-v D:\docker-data\mongo4:/data/db`
> 2. **【推荐】使用 Docker 命名卷**（跨平台全兼容，无视路径）：`-v mongo_data:/data/db`

### 启动 Redis (无密码版, 端口 6380)

> **为什么映射到宿主机的 6380 端口？**
> 本机系统可能已经安装了原生的 `redis-server`，它默认常驻后台监听标准 `6379` 端口甚至带有密码鉴权，很容易导致 Node.js 启动时冲突或报 `NOAUTH`。为了不污染本地系统，我们专门映射到 **`6380`**。

**macOS / Linux 示例：**
```bash
docker run -d \
  --name local_redis \
  -p 6380:6379 \
  -v ~/data/local_redis:/data \
  redis:7.0-alpine
```

> **⭐ Windows 系统注意事项**
> 同样地，如果是在 Windows 下，请将挂载路径 `-v ~/data/local_redis:/data` 改为你实际的绝对路径，例如 `-v D:\docker-data\redis:/data`，或者直接使用跨平台的命名卷：`-v redis_data:/data`。

#### ⚠️ 确保项目配置参数匹配
对于 Redis，请验证对应的环境配置文件 (如 `config/realtime-config-dev.json`) 端口映射也是 6380：
```json
{
  "redis": {
    "host": "127.0.0.1",
    "port": 6380
  },
  "bullmq": {
    "redis": {
      "host": "127.0.0.1",
      "port": 6380
    }
  }
}
```

---

## 2. Docker 日常最高频操作命令大全

你不再需要通过复杂的服务管理工具（如 `brew services` 等）去控制它们，所有操作都用 Docker CLI。

### 第一步：查看服务状态
* **查看目前正在后台运行的容器：**
  ```bash
  docker ps
  ```
  *(如果看到 `mongo4` 和 `local_redis` 的 `STATUS` 为 `Up`，说明运行中)*
* **查看本地所有的容器（包括已经被你停止的容器）：**
  ```bash
  docker ps -a
  ```

### 第二步：容器的生命周期管理 (启停)
之前通过 `docker run -d` 成功创建并运行一次即可。如果你觉得不用了，只需要**停止**它，下次开发**直接启动**：

* **停止某个正在运行的服务**（释放内存与 CPU）：
  ```bash
  docker stop mongo4 local_redis
  ```
* **重新启动已被停止的服务**：
  ```bash
  docker start mongo4 local_redis
  ```
* **立刻重启服务**：
  ```bash
  docker restart mongo4 local_redis
  ```

### 第三步：如果服务出错或想清空重来
* **彻底删除这个容器实例（因为数据卷已挂载到外部，所以不会丢核心数据，除非连数据卷一起删）：**
  ```bash
  docker rm -f mongo4 local_redis
  ```

### 第四步：查看服务后台运行日志
* **滚动跟踪服务日志（用于排错）：**
  ```bash
  docker logs -f mongo4
  # 按 Ctrl+C 退出跟踪
  ```

---

## 3. 直接进入容器内部调试数据库

不需要到处去下载 Navicat 或 Compass，直接跳进容器里快速用命令行操作数据库最快！

### 从内部操作 MongoDB：
```bash
docker exec -it mongo4 mongo
```
> 进入后可以用熟悉的：`show dbs`、`use xxx` 快速核对。

### 从内部操作 Redis 缓存和 BullMQ 任务：
```bash
docker exec -it local_redis redis-cli
```
> 进入以后常用的命令有：
> * `ping` —— 查看是否存活（返回PONG）
> * `keys *` —— 查看所有数据和任务键
> * `flushall` —— 暴力清空整个节点里面的所有内存缓存/任务排队（极速重置功能的好帮手）
> * `exit` —— 退出
