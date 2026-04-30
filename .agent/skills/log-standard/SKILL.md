---
name: log-standard
description: 强制所有日志输出必须通过项目统一的日志服务 logSvc.js 进行调用，严禁直接使用 console.log/warn/error 等原生方法。当用户要求编写任何新代码、新模块、新服务或涉及日志输出的变更时，请自动遵循此技能规范。
---

# 日志输出规范技能 (Log Standard)

在本项目 `ai-backend-template` 中，**所有日志输出必须统一经由 `src/lib/logSvc.js` 提供的日志服务执行**，严禁在任何业务代码中直接调用 `console.log`、`console.warn`、`console.error`、`console.info`、`console.debug` 等原生控制台方法。

## 1. logSvc.js 核心机制

`logSvc.js` 基于 `tracer` 库封装，提供企业级增强型日志能力：
- **颜色区分**：不同级别的日志以不同 ANSI 颜色输出，便于快速识别
- **堆栈追踪**：ERROR / EXCEPTION 级别自动附带调用堆栈
- **文件行号**：自动打印调用来源的文件路径、行号、方法名
- **热更新 Debug 开关**：支持通过运行时配置 `global.realtime_config.debug` 按文件粒度开关 DEBUG 级别日志

## 2. 引入方式（必须严格遵循）

`logSvc.js` 导出的是一个**工厂函数**，调用时必须传入 `__filename` 以注册当前文件路径，返回值通过**解构赋值**提取所需的日志级别方法。

### 标准引入模板

```javascript
const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('../../lib/logSvc.js')(__filename)
```

> **⚠️ 注意事项**：
> - 相对路径 `require('../../lib/logSvc.js')` 需根据当前文件与 `src/lib/` 目录的层级关系调整。
> - `__filename` 参数**不可省略**，它是日志热更新过滤和文件路径打印的关键依据。
> - 解构时只需提取业务实际使用到的级别方法即可，无需全部引入。

### 各层级文件的典型引入路径示例

| 文件位置 | require 路径 |
|---|---|
| `src/server.js` | `require('./lib/logSvc.js')(__filename)` |
| `src/task.js` | `require('./lib/logSvc.js')(__filename)` |
| `src/routes/*.js` | `require('../lib/logSvc.js')(__filename)` |
| `src/middleware/*.js` | `require('../lib/logSvc.js')(__filename)` |
| `src/apps/XX-XXXSvc/service.js` | `require('../../lib/logSvc.js')(__filename)` |
| `src/apps/XX-XXXSvc/models/*.js` | `require('../../../lib/logSvc.js')(__filename)` |

## 3. 可用日志级别方法

`logSvc.js` 提供以下日志级别方法（大写与小写均可使用，格式略有差异）：

| 方法 | 用途 | 输出格式 |
|---|---|---|
| `INFO(msg)` / `info(msg)` | 常规信息输出（启动成功、流程节点等） | 详细格式（含路径行号）/ 简易格式（仅时间和消息） |
| `ERROR(msg)` / `error(msg)` | 错误日志（捕获异常、业务失败等） | 详细格式 + 红色加粗 |
| `WARN(msg)` / `warn(msg)` | 警告日志（潜在风险、降级处理等） | 详细格式 + 黄色 |
| `DEBUG(msg)` / `debug(msg)` | 调试日志（仅在热更新配置开启时输出） | 详细格式 + 绿色/蓝色 |
| `EXCEPTION(msg)` | 严重异常（未捕获错误、系统级故障） | 详细格式 + 堆栈 + 红色加粗 |
| `TRACE(msg)` / `trace(msg)` | 链路追踪（深度调试用） | 详细格式 + 堆栈 + 紫色 |

### 级别选择指南

- **正常流程通知** → `INFO`（如服务启动、配置加载完成）
- **可恢复的异常或风险** → `WARN`（如配置缺失使用默认值）
- **业务逻辑错误** → `ERROR`（如数据库查询失败、参数校验不通过）
- **系统级崩溃或未捕获异常** → `EXCEPTION`（如中间件初始化失败）
- **开发期调试信息** → `DEBUG`（如变量值检查、流程分支跟踪）
- **深度链路追踪** → `TRACE`（如复杂调用链的逐步记录）

## 4. 使用示例

### 在 service.js 中使用

```javascript
const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('../../lib/logSvc.js')(__filename)
const { Service } = require('../../lib/servicelib')

const service = new Service(__filename)

service.addService('/list', async (req, res) => {
  INFO('开始查询列表数据')
  try {
    const result = await SomeModel.find({ deleted: false })
    DEBUG(`查询结果数量: ${result.length}`)
    return result
  } catch (err) {
    ERROR(`查询失败: ${err.message}`)
    EXCEPTION(err.stack)
    throw err
  }
})

module.exports = service.exportMe()
```

### 在 middleware 中使用

```javascript
const { ERROR } = require('../lib/logSvc.js')(__filename)

module.exports = function someMiddleware(req, res, next) {
  try {
    // 业务逻辑...
    next()
  } catch (err) {
    ERROR(`中间件处理异常: ${err.message}`)
    next(err)
  }
}
```

## 5. 绝对禁止的行为 🚫

以下做法在本项目中**严格禁止**，违反将导致日志体系失效、无法追踪问题来源：

```javascript
// ❌ 禁止！直接使用 console 原生方法
console.log('启动完成')
console.error('发生错误')
console.warn('警告信息')
console.info('信息输出')
console.debug('调试数据')

// ❌ 禁止！忘记传入 __filename
const logger = require('../../lib/logSvc.js')()

// ❌ 禁止！使用其他第三方日志库（如 winston、pino、bunyan 等）
const winston = require('winston')
```

> **🔴 唯一例外**：`logSvc.js` 自身内部的 `transport` 层可以使用 `console.log(data.output)` 作为最终输出管道，这是底层日志引擎的实现需要，不承担业务职能。

## 6. 代码审查检查清单

在编写或审查代码时，请确认：

- [ ] 文件顶部是否已正确引入 `logSvc.js` 并传入 `__filename`
- [ ] 是否存在任何 `console.log/warn/error/info/debug` 残留调用
- [ ] 日志级别是否与消息语义匹配（如错误不应使用 `INFO`）
- [ ] 敏感信息（密码、密钥、Token）是否被错误地写入日志
- [ ] `require` 路径是否正确指向 `src/lib/logSvc.js`
