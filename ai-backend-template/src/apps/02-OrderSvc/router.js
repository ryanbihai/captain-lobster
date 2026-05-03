/**
 * @file router.js (02-OrderSvc)
 * @description 订单服务路由定义。该模块在 register.js 中通过 config.json 中的 appid 被挂载至 /api/orders。
 */

const { interceptRouters, METHODS: { GET, POST } } = require('../../lib/routerlib')
const service = require('./service')

module.exports = expressRouter => {
  interceptRouters({
    expressRouter,
    routers: {
      /**
       * [订单业务路由组]
       * 最终生成的路径：/api/orders/create, /api/orders/get
       */
      '': [
        ['create', POST, service.createOrder], // 下单接口 (POST /api/orders/create)
        ['get', GET, service.getOrder],       // 获取订单详情 (GET /api/orders/get)
      ],
    },
  })
}
