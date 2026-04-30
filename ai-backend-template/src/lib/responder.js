/**
 * @file responder.js
 * @description 统一响应中间件。为 Express 的 res 对象注入标准化的业务返回方法，确保全项目 API 格式一致性。
 */

module.exports = function responder(req, res, next) {
  /**
   * 【res.ok】 标准化成功响应抛出器
   * 返回格式：{ code: 0, msg: "Success", data: [...] }
   * @param {any} data 返回的业务物料或对象，默认为 null
   * @param {string} msg 自定义成功提示词，默认为 'Success'
   * @param {number} code 业务层成功码，默认为 0
   */
  res.ok = function(data = null, msg = 'Success', code = 0) {
    if (!res.headersSent) {
      res.json({ code, msg, data })
    }
  }

  /**
   * 【res.fail】 标准化失败响应抛出器
   * 返回格式：{ code: 1, msg: "Error", data: null }
   * @param {string} msg 向前端回显的错误提示词，默认为 'Error'
   * @param {number} code 业务逻辑错误码，默认为 1
   * @param {any} data 补充的错误详情负载
   */
  res.fail = function(msg = 'Error', code = 1, data = null) {
    if (!res.headersSent) {
      res.json({ code, msg, data })
    }
  }

  // 移交控制权给后续业务中间件
  next()
}
