/**
 * @file api.js
 * @description 核心 API 路由分发器。作为所有业务子应用的顶层容器。
 */

const express = require('express')
const expressRouter = express.Router()

/**
 * 【系统存活自检接口】
 * 用于外部负载均衡或监控系统探测服务状态
 */
expressRouter.get('/ping', (req, res) => res.json({ msg: 'pong', code: 0 }))

module.exports = { expressRouter }
