---
name: create-app
description: 按照 01-UserSvc 的基准目录结构针对项目在 src/apps 自动生成并初始化一个新的微服务项目。系统会自动为模型设置并加上 MongoDB 的表前缀实现数据隔离。当用户要求“创建新应用”或“生成脚手架服务”时务必触发挂载。
---

# 微服务子应用自动生成技能 (Create App)

每当用户在沟通中明示或者暗示要求你帮助他在模板的 `ai-backend-template/src/apps` 根目录里设立或者开发搭建一个全新的微服务（即子应用系统）时，请毫不妥协地履行以下所有构建指南，从而保障项目规范的有序传承以及不同数据库组别之间严格的结构孤立。

## 1. 结构与目录分配基础准则
建立的全新子微服务应用务必嵌套入一个由数字自增序号和应用名称构成的统一包装文件夹之内（例如 `02-xxxSvc`），且**所有相关源代码、配置及文档文件必须严格限定在该子目录路径之下（即 `ai-backend-template/src/apps/XX-XXXSvc/`）**，严禁在 `src` 外部或根目录下散落业务逻辑代码。倘若用户并没有事先说明希望的序号，则你可以就地检索项目 `src/apps` 内包含的所有合法业务组文件夹并据此自动衍生出序列号。

进阶这个全新的空置空间内，请严格对照先前的典范应用 `01-UserSvc` 作为参照标尺，为你创建出以下构成应用基石的核心架构文件群：
1. **`router.js`**: 收拢该子站内所有内部出口并路由分发的导出表汇聚中心。
   - **🔴【网关防崩溃预警】**：该文件绝对不可随意向外输出平铺的 JSON 常规对象！你必须严格使用高阶回调函数格式：`module.exports = expressRouter => { ... }`，并搭配使用从 `../../lib/routerlib` 层挂载引入的 `interceptRouters` 和 `METHODS: { GET, POST... }` 工具函数对 `service.js` 上的各个具体路由映射执行封装。若不遵循此规范，系统网关加载至此时必然会因抛出 `TypeError: require(...) is not a function` 而导致整个进程宕机退出！
2. **`service.js`**: 主要处理该领域业务的独立宿主载体层。必须正确挂入 `servicelib2` 和基础运行日志层模块 `logSvc.js`。并在源码中进行声明构造实例化且务必以包含专属路径挂载模块的方法组指令 `service.exportMe()` 置底作为最终抛出出口。
3. **`config.json`**: 用于子系统的泛用和基础型全境环境业务常驻属性加载表.
   - **🟡【防 404 路径漂移预警】**：在这里除了声明 `name` / `version` 之外，你必须为其明确制定 `"appid": "xxx"` 属性词典键（如 `"appid": "orders"`）。不论其上层应用夹带没带有标号数字前置，一旦配置里缺失该强宣发入口，底板网关在解析 Local / Dev 退化环境时会因为读取合并出现偏差er 抛弃这套路由或者挂载偏斜，从而引发第三方联调访问时大面积的 404 错误！
4. **`config-local.json` / `config-dev.json` 等**: 主要用于非正环境调试期时覆盖基础配置参数的非必现型衍生替换配置清单（允许内部内容初始为 `{}`）。
5. **`models/` 实体仓储（可选且致命）**: 如果你洞察到该子系统的搭建附随有诸如订单表、商品记录表等等关联性的数据库存储增删改查动作时，应把全部与之相配位的 `Mongoose schema models` 类对象脚本整备安置于这里。
6. **`doc/` 专属技术栈文档 (极其重要)**: 务必围绕当前新建微服务同步拉起一个文档伴随夹。
   - 必定在其内部分配并撰写一份 **业务需求说明书** `.md` 文件（如 `xxxSvc-需求提纲.md`），沉淀记录该项目的边界职能、所涉场景逻辑及接口构想。
   - **如果所建子服务含有供外部访问调用的入口路由 (APIs)**，则你必须在这儿为其附带刻画出一份标准且完整、遵从 `OpenAPI 3.0+` 约定的 **`openapi.json`** 文件。
    - **⚠️【API 契约一致性军规】**：生成的内容必须深度对齐 `02-OrderSvc/doc/openapi.json` 的结构风格。包括且不限于：路径必须写全（如 `/api/products/list` 而非简写 `/list`）、Request/Response 实体必须包含极其详尽的 `properties`、`example` 与 `description` 注释、返回体必须遵循标准的 `code`/`data`/`doc` 嵌套层级。此外，**必须为所有接口操作（Operations）添加统一的 `tags` 数组（例如 `tags: ["OrderSvc"]`），确保导入 APIFox 时所有接口能自动归入该微服务命名的文件夹目录下**。保障研发后期的 APIFox / Swagger 一键导入开箱即用体验。

## 2. 严苛的 MongoDB 存储实体隔离化军规 (致命级别)
若基于指令的产生需求迫使你进入针对下属 `models/` 目录展开数据库表文件实体类的刻画编写，**那么你必须无条件保障实现基于该业务系统的表数据互斥操作，严禁裸露的原始表名直接打向引擎，要求你在构筑 Mongoose 层表选项 Option 对象时显式赋予强制性的 `collection` 配置重定向名字属性名！**

它的集合名字规则结构：此项目专属名称去除序号的实体标识前缀 + 单独表类名称。这对于微服务的分割举足轻重！
> 举个典型的反面示例：用户新提出创立一个应用名叫做 `02-OrderSvc` 并且伴随着名叫 `Order` 实体的微前端体系，你让模型直连写入了表名为 `orders`。
> **正面合法示例**：它的物理落库底层强制绑定位必须要被你约束成叫作 `OrderSvc_Order`！

### 强数据物理隔离化应用蓝本借鉴范式
```javascript
// 【范例路径】 src/apps/02-OrderSvc/models/Order.js
const mongoose = require('mongoose')
const Schema = mongoose.Schema

const orderSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String },
  createDate: { type: Date, default: Date.now },
  deleted: { type: Boolean, default: false }
  // ... 此处容纳由于用户的沟通指令带入扩展的具体应用属性字段 ...
}, {
  // 👇 致命遵守要求：这是微服务存活的关键，向配置内强行覆盖写入物理级表名称 Collection 参数！
  collection: 'OrderSvc_Order'
})

module.exports = mongoose.model('Order', orderSchema)
```

且最后建议你为服务模型聚落处搭建一座对外沟通的便捷检索灯塔模块，方便上游服务解构加载所有相关的实体链：
```javascript
// 【范例路径】 src/apps/02-OrderSvc/models/index.js
module.exports = {
  Order: require('./Order') // 以此类推追加后续产生的其它关联模型...
}
```

## 3. 全局流水线与落子操纵流程
1. 读取排查已有项目群体 `src/apps` 获取最大末位序号用作下一个 `0x-XXXSvc` 微系统的构建分配参考依据。
2. 铺设核心应用运转所必不可缺的核心工作件（如 `service.js`、`router.js` 等）、并强行搭配衍生出记录了开发意图与 `openapi.json` 样板的 `doc/` 说明矩阵组。
3. 如用户附带了对于存储对象的蓝图要求甚至只是意图趋势，于 `/models` 类聚落下遵循那套**极端性加上表名后缀强力锁定**的数据分割方阵建立该系列 `Schema` 文件集合。
4. 大量调取 Agent 已有的快速生成修改写权限 `write_to_file` 去高速把前置构想转嫁成真实盘古代码体系。
5. 任务落定之后向用户明示目前生成的一切业务目录情况（不遗漏关于数据前缀挂载的汇报工作项）。
