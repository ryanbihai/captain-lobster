/**
 * @file index.js (UserSvc Models)
 * @description 用户模块数据库模型统一导出入口。
 */

module.exports = {
  // 导出 User 模型，业务层可通过 require('./models').User 获取
  User: require('./User'),
}
