/**
 * @file routerlib.js
 * @description 路由扩展工具库。负责将配置式的路由描述转换为 Express 的实体路由，并注入统一的请求参数解析与异常处理逻辑。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./logSvc.js')(__filename)

// 标准 HTTP 方法映射表
const METHODS = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
}

/**
 * 【路由拦截与转换器】
 * @param {Object} options.expressRouter 原始 Express 路由实例
 * @param {Object} options.routers 业务路由配置对象
 */
function interceptRouters({ expressRouter, routers }) {
  for (const groupName in routers) {
    const rules = routers[groupName] // 获取分组下的路由规则数组
    
    rules.forEach(([path, method, handler, options = {}]) => {
      // 1. 路由路径清洗与拼接：支持自动处理斜杠前缀
      const routePath = path === '/' || !path ? '' : path.startsWith('/') ? path : `/${path}`
      const fullPath = groupName ? `/${groupName}${routePath}` : routePath || '/'
      
      // 2. 提取预置中间件（如鉴权 Guard）
      const middlewares = options.preMiddlewares || []

      /**
       * 3. 核心装饰器：将业务 Handler 包装进 Express 路由
       */
      expressRouter[method](fullPath, ...middlewares, async (req, res, next) => {
        try {
          // 4. 参数归一化：将 Query、Body、Params 统合为一个 Params 对象，简化业务层调用
          const params = { ...req.query, ...req.body, ...req.params }
          
          // 5. 执行业务处理逻辑
          const result = await handler(params, { req, res })

          // 6. 统一结果处理与报文返回
          if (!res.headersSent) {
            if (result && result.code !== undefined) {
              // 兼容格式：{ code, msg, data }
              res.json({
                code: result.code,
                msg: result.msg || (result.code === 0 ? 'ok' : 'error'),
                data: result.data || {},
              })
            } else if (result) {
               // 兜底：直接返回结果对象
               res.json(result)
            } else {
               // 缺省成功返回
               res.json({ code: 0, msg: 'ok', data: {} })
            }
          }
        } catch (err) {
          /**
           * 7. 异常拦截：捕获业务代码运行时的崩溃
           * 记录详细堆栈并向前端返回标准的错误报文，防止进程挂起
           */
          EXCEPTION(err)
          if (!res.headersSent) {
             res.json({ code: -1, msg: '服务器内部错误' })
          }
        }
      })
    })
  }
}

module.exports = { interceptRouters, METHODS }
