# 后端 项目 AI 编码规则

## 项目概述

这是一个基于 Node.js 的后端项目模板，采用 Express + Mongoose + Redis 技术栈，提供多个业务模块的 API 服务。
务必注意，当生成的代码在本地运行时，因为无法连接server的db，所以不需要连接 MongoDB 和 Redis，而是使用 json 文件系统代替，日志不要引用hl-logger也使用text文件系统代替，但所有调用mongodb,redis和日志的接口预留好，可先注释掉或者绕过。保证本地可运行，同时又能方便的移植到server上运行。

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| **运行时** | Node.js = 20 | 服务端 JavaScript, 代码用commonjs规范 |
| **Web 框架** | Express 4.x | HTTP 服务和路由 |
| **数据库 ORM** | Mongoose 7.x | MongoDB ODM，Schema 定义、数据验证、中间件钩子 |
| **数据库** | MongoDB | 主存储，本地测试时连接本地的db，docker启动 |
| **缓存/会话** | Redis（via `hl-redis` + `ioredis`） | 会话存储和数据缓存，本地测试时用 json 文件系统代替 |
| **HTTP 客户端** | superagent 5.x | 所有对外 HTTP 请求统一使用 |
| **进程管理** | PM2 | 生产和开发环境的进程管理 |
| **定时任务** | cron-scheduler | 定时任务调度 |
| **消息队列** | BullMQ 4.x | 基于 Redis 的任务队列，支持延迟/重试/优先级/限流，本地测试时用内存队列代替，如无必要，请勿调用 |
| **对象存储** | 阿里云 OSS（via `hl-aliyun-oss`） | 文件存储 |
| **认证** | express-session + JWT | 微信用户用 session，管理后台用 JWT |
| **测试** | AVA | 单元测试框架 |
| **代码规范** | ESLint（hl-nodejs 配置） | 代码风格约束 |

## 项目目录结构

```
project/
├── config/                          # 全局配置文件
│   ├── realtime-config.json         # 生产环境运行时配置（支持热更新）
│   ├── realtime-config-dev.json     # 开发环境运行时配置
│   ├── static-config.json           # 生产环境静态配置（MongoDB 连接等）
│   └── static-config-dev.json       # 开发环境静态配置
├── src/
│   ├── server.js                    # 主入口：Express 服务初始化
│   ├── task.js                      # 定时任务入口（独立进程运行）
│   ├── models/                      # Mongoose Model 定义
│   │   ├── index.js                 # 统一导出所有 Model
│   │   ├── User.js                  # 用户模型
│   │   ├── Order.js                 # 订单模型（示例）
│   │   └── ...                      # 其他业务模型
│   ├── apps/                        # 业务模块（按编号组织）
│   │   ├── index.js                 # 加载所有 app 的 config.json
│   │   ├── 00-CoreSvc/              # 核心服务
│   │   └── ...                      # 其他业务模块
│   ├── lib/                         # 公共库
│   │   ├── db.js                    # Mongoose 连接管理（本地回退 JSON 文件存储）
│   │   ├── redis.js                 # Redis 连接
│   │   ├── routerlib.js             # 路由注册工具（interceptRouters 模式）
│   │   ├── util.js                  # 工具函数（基于 hl-util 扩展）
│   │   ├── logger.js                # 日志初始化
│   │   ├── queue-manager.js         # BullMQ 队列管理器（本地回退内存队列）
│   │   └── ...
│   ├── routes/                      # 路由入口
│   │   ├── api.js                   # 路由总入口
│   │   └── register.js              # 动态注册各 app 的 router
│   ├── scripts/                     # 脚本工具
│   └── www/                         # 静态资源
├── data/                            # 本地 JSON 文件存储（替代 MongoDB/Redis）
│   └── logs/                        # 本地文本日志
├── test/                            # 测试文件
├── package.json
├── pm2-start.json                   # PM2 生产配置
└── pm2-start-dev.json               # PM2 开发配置
```

## 核心架构模式

### 1. Mongoose Model 定义

所有 Model 统一放在 `src/models/` 目录下，每个文件定义一个 Schema 和 Model。

**Model 文件模板**：

```javascript
const mongoose = require('mongoose')
const { Schema } = mongoose

const userSchema = new Schema({
  id:         { type: String, required: true, unique: true, index: true },  // 业务 ID（UUID）
  name:       { type: String, default: '' },
  mobile:     { type: String, default: '' },
  gender:     { type: String, enum: ['male', 'female', ''], default: '' },
  openid:     { type: String, default: '' },
  avatar:     { type: String, default: '' },
  deleted:    { type: Boolean, default: false },                            // 软删除标记
  createDate: { type: Date, default: Date.now },
  updateDate: { type: Date, default: Date.now },
}, {
  timestamps: false,          // 使用自定义的 createDate/updateDate
  versionKey: false,          // 禁用 __v
  collection: 'users',        // 指定集合名
})

// 查询中间件：自动过滤已删除记录
userSchema.pre(/^find/, function(next) {
  if (this.getFilter().deleted === undefined) {
    this.where({ deleted: { $ne: true } })
  }
  next()
})

// 更新中间件：自动更新 updateDate
userSchema.pre(/^(update|findOneAndUpdate)/, function(next) {
  this.set({ updateDate: new Date() })
  next()
})

module.exports = mongoose.model('User', userSchema)
```

**models/index.js 统一导出**：

```javascript
module.exports = {
  User:  require('./User'),
  Order: require('./Order'),
  // ...按需添加
}
```

### 2. 数据库连接管理（db.js）

```javascript
const mongoose = require('mongoose')

// 本地开发时如果连接失败，回退到 JSON 文件存储
async function connectDB() {
  const mongoURI = global.static_config?.mongodb?.uri || 'mongodb://localhost:27017/myapp'
  try {
    await mongoose.connect(mongoURI)
    INFO('MongoDB connected via Mongoose')
  } catch (err) {
    ERROR(`MongoDB connection failed: ${err.message}, using JSON file fallback`)
    // 本地回退逻辑在各 service 中处理
  }
}

module.exports = { connectDB, mongoose }
```

### 3. 服务模块结构（App Module）

每个业务模块位于 `src/apps/XX-XXXSvc/` 下，典型结构：

```
XX-XXXSvc/
├── config.json          # 生产配置（appid、appSecret 等）
├── config-dev.json      # 开发配置
├── router.js            # 路由定义
├── service.js           # 业务逻辑（简单模块）
├── services/            # 业务逻辑（复杂模块，拆分多文件）
│   ├── someService.js
│   └── ...
└── resource/            # 静态资源（模板、字体等）
```

### 4. 路由注册机制

路由通过 `src/routes/register.js` 自动注册，它遍历 `src/apps/` 中的 `config.json` 获取 `appid`，然后加载对应的 `router.js` 挂载到 `/api/{appid}/` 路径下。

**使用 routerlib.interceptRouters**（推荐）：

```javascript
const { interceptRouters, METHODS: { GET, POST, PUT, PATCH, DELETE } } = require('../../lib/routerlib')
const someService = require('./services/someService')

interceptRouters({
  expressRouter, routers: {
    // 路由分组名: [[路径, 方法, 处理函数, 选项]]
    groupName: [
      ['list',    GET,  someService.findMany],
      ['create',  PUT,  someService.insertOne],
      [':id',     GET,  someService.findOneById],
      [':id',     PATCH, someService.updateOne, { preMiddlewares: [checkLanIP] }],
    ],
  },
})
```

### 5. 服务层模式（结合 Mongoose）

```javascript
const { Service } = require('../../../lib/servicelib2')
const User = require('../../../models/User')
const service = new Service({ __dirname, __filename, module })

exports.validatorConfig = {
  createUser: {
    name:   v => validator.isNonemptyString(v),
    mobile: v => validator.isChineseMobile(v),
  }
}

// 使用 Mongoose Model 进行数据库操作
exports.createUser = async ({ name, mobile, gender }) => {
  const id = util.createId()
  const user = await User.create({ id, name, mobile, gender })
  return { code: 0, data: { doc: user } }
}

exports.getUserById = async ({ id }) => {
  const user = await User.findOne({ id })
  if (!user) return { code: 4, data: {} }
  return { code: 0, data: { doc: user } }
}

exports.updateUser = async ({ id, updates }) => {
  const user = await User.findOneAndUpdate(
    { id, deleted: { $ne: true } },
    { $set: updates },
    { new: true }
  )
  if (!user) return { code: 4, data: {} }
  return { code: 0, data: { doc: user } }
}

exports.deleteUser = async ({ id }) => {
  // 软删除
  const result = await User.findOneAndUpdate(
    { id },
    { $set: { deleted: true, updateDate: new Date() } },
    { new: true }
  )
  return result ? { code: 0 } : { code: 4 }
}

exports.listUsers = async ({ condition = {}, sort, skip, limit }) => {
  let query = User.find(condition)
  if (sort)  query = query.sort(sort)
  if (skip)  query = query.skip(skip)
  if (limit) query = query.limit(limit)
  const docs = await query.exec()
  return { code: 0, data: { docs } }
}

service.exportMe()
```

### 6. Mongoose 常用操作速查

```javascript
const Model = require('../../../models/SomeModel')

// 查询
const doc  = await Model.findOne({ id })                       // 按条件查一条
const docs = await Model.find({ status: 'active' })            // 查多条
const doc  = await Model.findById(objectId)                    // 按 _id 查
const count = await Model.countDocuments({ status: 'active' }) // 计数

// 创建
const doc = await Model.create({ id, name, ... })             // 创建单条
const docs = await Model.insertMany([{ ... }, { ... }])        // 批量创建

// 更新
const doc = await Model.findOneAndUpdate(                      // 查找并更新
  { id },
  { $set: { name: 'new' } },
  { new: true }                                                 // 返回更新后的文档
)
await Model.updateMany({ status: 'old' }, { $set: { status: 'archived' } })

// 删除（推荐软删除）
await Model.findOneAndUpdate({ id }, { $set: { deleted: true } })

// 聚合
const result = await Model.aggregate([
  { $match: { deleted: { $ne: true } } },
  { $group: { _id: '$type', count: { $sum: 1 } } },
])

// 分页查询
const docs = await Model.find(condition)
  .sort({ createDate: -1 })
  .skip((page - 1) * pageSize)
  .limit(pageSize)
  .select('id name mobile')   // 字段投影
  .lean()                      // 返回普通 JS 对象（性能更好）
```

### 7. 统一返回格式

所有 API 响应统一格式：

```javascript
{
  code: 0,     // 状态码
  msg: 'ok',   // 状态消息
  data: { }    // 业务数据
}
```

**标准状态码**：

| code | 含义 |
|------|------|
| `0` | 成功 |
| `1` | 参数不合法 |
| `2` | 未登录/无 session |
| `3` | 无权限 |
| `4` | 未找到 |
| `5` | 数据已存在 |
| `-1` | 服务器内部错误 |
| `-2` | 数据库操作失败 |
| `-3` | 调用依赖 API 出错 |

### 8. 配置管理

- **静态配置**（`static-config.json`）：MongoDB 连接 URI 等，启动时加载一次
- **运行时配置**（`realtime-config.json`）：业务参数、功能开关等，支持**热更新**（每 15 秒检测文件变化）
- **模块配置**（`apps/XX-XXXSvc/config.json`）：每个模块独立的 appid 等

运行时配置通过 `global.realtime_config` 全局访问：

```javascript
const config = global.realtime_config.moduleName
// 或在 Service 中
const config = this.getConfig()
```

### 9. HTTP 外部请求 (superagent)

所有对外 HTTP 请求通过 `src/lib/superagent-proxy.js` 封装的 superagent 发起，自动设置 user-agent：

```javascript
const superAgent = require('../../lib/superagent-proxy')

// GET 请求
const res = await superAgent.get(url)

// POST 请求
const res = await superAgent.post(url).send({ key: value })

// 响应数据在 res.body 中
```

### 10. 全局日志函数


```javascript
DEBUG('调试信息')      // 调试级别
INFO('普通信息')       // 信息级别
ERROR('错误信息')      // 错误级别
EXCEPTION(error)      // 异常级别（接收 Error 对象或字符串）
```

### 11. 中间件

| 中间件 | 用途 |
|--------|------|
| `checkLanIP` | 限制仅内网 IP 访问 |
| `createRouter(fn)` | 封装异步路由，统一捕获异常 |

### 12. 定时任务

定时任务在 `src/task.js` 中定义，通过 PM2 作为独立进程运行：

```javascript
const CRON = require('cron-scheduler')

CRON({ on: util.getField(global, 'realtime_config', 'task', 'moduleName', 'cron') }, async () => {
  const service = require('./apps/XX-XXXSvc/service')
  await service.someTask()
})
```

### 13. ID 生成

使用 UUID v1（去掉连字符）作为业务 ID：

```javascript
const util = require('../../lib/util')
const id = util.createId()  // 32 位无连字符 UUID
```

### 14. BullMQ 消息队列

项目通过 `src/lib/queue-manager.js` 统一管理 BullMQ 队列。本地开发时 Redis 不可用会自动回退为内存队列。

**适用场景**：
- 耗时任务异步处理（如 PDF 生成、邮件发送、图片处理）
- 定时延迟任务（如订单超时取消、延迟通知）
- 需要重试的外部 API 调用
- 限流/并发控制

**使用方式**：

```javascript
const queueManager = require('../../lib/queue-manager')

// 1. 定义队列和消费者（通常在模块初始化时）
queueManager.createWorker('email-queue', async (job) => {
  const { to, subject, html } = job.data
  await sendEmail({ to, subject, html })
  return { sent: true }
}, {
  concurrency: 3,          // 并发处理数
})

// 2. 在业务逻辑中往队列添加任务
await queueManager.addJob('email-queue', {
  to: 'user@example.com',
  subject: '欢迎注册',
  html: '<p>欢迎使用</p>',
}, {
  delay: 5000,             // 延迟 5 秒执行
  attempts: 3,             // 失败最多重试 3 次
  backoff: { type: 'exponential', delay: 2000 },  // 指数退避
  priority: 1,             // 优先级（数字越小越优先）
  removeOnComplete: true,  // 完成后自动清理
  removeOnFail: 50,        // 保留最近 50 条失败记录
})

// 3. 批量添加任务
await queueManager.addBulk('email-queue', [
  { data: { to: 'a@test.com', subject: '通知1' } },
  { data: { to: 'b@test.com', subject: '通知2' }, opts: { delay: 10000 } },
])

// 4. 监听队列事件
queueManager.onCompleted('email-queue', (job, result) => {
  INFO(`邮件任务 ${job.id} 完成: ${JSON.stringify(result)}`)
})
queueManager.onFailed('email-queue', (job, err) => {
  ERROR(`邮件任务 ${job.id} 失败: ${err.message}`)
})

// 5. 关闭所有队列（优雅退出时调用）
await queueManager.closeAll()
```

**队列配置通过运行时配置管理**：

```json
// realtime-config.json
{
  "bullmq": {
    "redis": { "host": "127.0.0.1", "port": 6379 },
    "defaultJobOptions": {
      "attempts": 3,
      "removeOnComplete": true
    }
  }
}
```

## 编码规范

### 必须遵守

1. **所有新模块使用 `Service` 类 + `interceptRouters` 模式**
2. **返回值必须使用统一格式** `{ code, msg, data }`
3. **外部 HTTP 请求必须使用 `superagent-proxy.js`**，不要直接 require superagent
4. **日志使用全局函数** DEBUG/INFO/ERROR/EXCEPTION，不要使用 console.log
5. **异步函数必须有 try-catch**，catch 中使用 `EXCEPTION(ex)` 记录
6. **数据库操作统一使用 Mongoose Model**，不直接使用 MongoDB 原生驱动
7. **所有 Model 定义放在 `src/models/` 目录**，通过 `models/index.js` 统一导出
8. **Schema 必须声明 `id`（业务UUID）、`deleted`、`createDate`、`updateDate` 字段**
9. **使用软删除**（设置 `deleted: true`），除非明确需要真实删除
10. **配置通过 `global.realtime_config` 或 `Service.getConfig()` 读取**
11. **环境区分**：通过 `process.env.NODE_ENV === 'production'` 判断
12. **ID 字段使用 `util.createId()`** 生成，字段名为 `id`（非 `_id`）
13. **异步耗时任务使用 BullMQ 队列**，通过 `queue-manager.js` 统一管理，不在路由处理函数中同步执行
14. **队列名使用 kebab-case**，如 `email-queue`、`pdf-generation`

### 代码风格

- 使用 `const` 优先，必要时用 `let`，禁止 `var`
- 对齐风格：变量声明和对象属性使用冒号对齐（项目现有风格）
- 异步全部使用 `async/await`，不使用回调
- 参数校验使用 `validatorConfig` 声明式校验
- 字符串使用反引号模板字符串

### 文件命名

- Model 文件使用 **PascalCase**：`User.js`、`Order.js`
- 服务文件使用 **camelCase**：`someService.js`
- 模块目录使用 **编号-PascalCase**：`XX-ModuleNameSvc`
- 配置文件：`config.json` / `config-dev.json`
- 路由文件固定名：`router.js`
- 服务文件：`service.js`（单文件）或 `services/` 目录（多文件）

## 新增模块模板

创建新业务模块时，按以下步骤：

1. 在 `src/models/` 下创建所需的 Model 文件（PascalCase），在 `models/index.js` 中注册
2. 在 `src/apps/` 下创建 `XX-NewSvc/` 目录
3. 创建 `config.json` 和 `config-dev.json`（含 appid、appSecret 等）
4. 创建 `router.js` 使用 `interceptRouters` 注册路由
5. 创建 `services/` 目录，引用 Model 编写业务逻辑
6. 在 `config/realtime-config-dev.json` 中添加模块运行时配置
7. 如需定时任务，在 `src/task.js` 中添加 CRON 调度
8. 如需异步任务，通过 `queue-manager.js` 注册队列和 Worker
