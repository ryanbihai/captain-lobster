/**
 * @file router.js (01-UserSvc)
 * @description 用户服务路由配置文件。定义了用户增删改查的所有外部接口。
 */

const { interceptRouters, METHODS: { GET, POST, PUT, PATCH, DELETE } } = require('../../lib/routerlib')
const service = require('./service')

module.exports = expressRouter => {
  interceptRouters({
    expressRouter,
    routers: {
      /**
       * [用户基础业务路由组]
       * 由于该子应用在 register.js 中挂载在 /users 下，
       * 故最终生成的路径为：/api/users/list, /api/users/create 等。
       */
      '': [
        ['list', GET, service.listUsers],           // 分页/条件查询用户列表
        ['create', POST, service.createUser],       // 创建新用户
        [':id', GET, service.getUserById],          // 根据 ID 获取详情
        [':id', PATCH, service.updateUser],         // 更新用户字段信息
        [':id', DELETE, service.deleteUser],        // 软删除用户
      ],
    },
  })
}
