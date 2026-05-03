/**
 * @file router.js (03-LobsterSvc)
 * @description 龙虾船长 L1 游戏引擎路由定义。
 */

const { interceptRouters, METHODS: { GET, POST } } = require('../../lib/routerlib')
const service = require('./service')

module.exports = expressRouter => {
  interceptRouters({
    expressRouter,
    routers: {
      '': [
        ['enroll', POST, service.enrollPlayer],                 // 玩家入驻
        ['city/:id', GET, service.getCity],                   // 获取城市信息
        ['action/move', POST, service.movePlayer],             // 移动到新城市
        ['action/intent', POST, service.updateIntent],         // 更新供需意向牌
        ['action/arrive', POST, service.arriveAndSettle],      // 抵达并检测交割
        ['trade/npc', POST, service.tradeWithNpc],             // NPC 系统交易
        ['contract/create', POST, service.createContract],      // 创建交易合约
        ['contract/cancel', POST, service.cancelContract],      // 取消合约
        ['contract/list', GET, service.listContracts],          // 查询合约列表
        ['oceanbus/register', POST, service.registerOceanBus], // 注册 OceanBus Agent
        ['oceanbus/messages/send', POST, service.sendOceanMessage], // 发送消息
        ['oceanbus/messages/sync', GET, service.syncOceanMessages],  // 同步消息
      ],
    },
  })
}
