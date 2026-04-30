/**
 * @file router.js (00-CoreSvc)
 * @description 核心服务路由定义。使用配置化的方式声明该模块下的所有 URL 路径及对应处理器。
 */

const { interceptRouters, METHODS: { GET, POST, PUT, PATCH, DELETE } } = require('../../lib/routerlib')
const service = require('./service')

/**
 * 导出路由挂载函数
 * @param {express.Router} expressRouter 子应用的路由实例
 */
module.exports = expressRouter => {
  interceptRouters({
    expressRouter,
    routers: {
      /**
       * [用户管理子路由组]
       * 最终生成的完整路径为：/api/core/user/xxx
       */
      user: [
        ['list', GET, service.listUsers],           // 获取用户列表 (GET /api/core/user/list)
        ['create', POST, service.createUser],       // 创建新用户 (POST /api/core/user/create)
        [':id', GET, service.getUserById],          // 获取单用户详情 (GET /api/core/user/:id)
        [':id', PATCH, service.updateUser],         // 部分更新用户信息 (PATCH /api/core/user/:id)
        [':id', DELETE, service.deleteUser],        // 逻辑删除用户 (DELETE /api/core/user/:id)
      ],
    },
  })
}
