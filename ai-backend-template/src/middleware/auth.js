/**
 * @file auth.js
 * @description 通用业务鉴权 Guard 守卫。负责拦截未授权请求，支持 Bearer Token 与 Session 双重校验。
 */

const { ERROR } = require('../lib/logSvc.js')(__filename)

/**
 * 【鉴权中间件】
 * 可用于保护需要强制登录访问的用户级或后台敏感接口。
 */
module.exports = function requireAuth(req, res, next) {
  // 1. 尝试从 Header: Authorization 解析标准 Bearer Token
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

  // 2. 尝试从 Session 中判断（用于传统的单点登录或 Web 端会话持久化）
  const isSessionValid = req.session && req.session.userId

  /**
   * > TODO: 真实正式业务建议在此引入 jsonwebtoken
   * 示例：const payload = jwt.verify(token, process.env.JWT_SECRET);
   */

  // 如果两者皆无，则视为非法访问，执行截停
  if (!token && !isSessionValid) {
    ERROR(`[鉴权拦截] 访问受限路径被截停: ${req.originalUrl}`)
    
    /**
     * 注意：这里的 res.fail 依赖全局加载的 lib/responder.js
     * 若未加载则回退到原生 JSON 返回 401
     */
    return res.fail ? res.fail('UnAuthorized / 未授权访问，请先登录', 401) : res.status(401).json({ code: 401, msg: '未授权' })
  }

  // 3. 将解析出的用户凭证挂载到 req.user 中，供后续业务流程消费
  req.user = {
    id: req.session?.userId || 'guest-context-id',
    token,
  }

  // 放行进入业务逻辑
  next()
}
