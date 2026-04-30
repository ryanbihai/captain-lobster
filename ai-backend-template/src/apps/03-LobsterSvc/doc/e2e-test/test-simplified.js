/**
 * @file test-simplified.js
 * @description 简化测试：创建合约并手动查询数据
 */

const request = require('superagent')

const API = 'http://localhost:17019/api'

async function test() {
  console.log('\n简化测试：创建合约并验证数据\n')

  // 创建买家和卖家
  const sellerRes = await request.post(`${API}/lobster/enroll`).send({
    openid: `seller_${Date.now()}`,
    publicKey: 'test',
    initialGold: 10000
  }).timeout(10000)

  const buyerRes = await request.post(`${API}/lobster/enroll`).send({
    openid: `buyer_${Date.now()}`,
    publicKey: 'test',
    initialGold: 10000
  }).timeout(10000)

  const seller = sellerRes.body.data.doc
  const buyer = buyerRes.body.data.doc

  console.log(`卖家: ${seller.openid}`)
  console.log(`买家: ${buyer.openid}`)

  // 卖家买入丝绸
  await request.post(`${API}/lobster/trade/npc`).send({
    openid: seller.openid,
    item: 'silk',
    amount: 10,
    action: 'buy'
  }).timeout(10000)

  console.log('卖家买入丝绸成功')

  // 卖家航行到威尼斯
  await request.post(`${API}/lobster/action/move`).send({
    openid: seller.openid,
    targetCity: 'venice'
  }).timeout(10000)
  await request.post(`${API}/lobster/action/move`).send({
    openid: seller.openid,
    targetCity: 'venice'
  }).timeout(10000)

  console.log('卖家抵达威尼斯')

  // 买家航行到威尼斯
  await request.post(`${API}/lobster/action/move`).send({
    openid: buyer.openid,
    targetCity: 'venice'
  }).timeout(10000)
  await request.post(`${API}/lobster/action/move`).send({
    openid: buyer.openid,
    targetCity: 'venice'
  }).timeout(10000)

  console.log('买家抵达威尼斯')

  // 卖家抵达并检测交割
  const arrive1 = await request.post(`${API}/lobster/action/arrive`).send({
    openid: seller.openid
  }).timeout(10000)

  console.log(`卖家抵达结果: ${JSON.stringify(arrive1.body)}`)

  // 创建合约
  const contractRes = await request.post(`${API}/lobster/contract/create`).send({
    buyerOpenid: buyer.openid,
    sellerOpenid: seller.openid,
    item: 'silk',
    amount: 10,
    price: 500,
    deliveryCity: 'venice'
  }).timeout(10000)

  console.log(`合约创建: ${JSON.stringify(contractRes.body)}`)

  // 买家抵达并检测交割
  const arrive2 = await request.post(`${API}/lobster/action/arrive`).send({
    openid: buyer.openid
  }).timeout(10000)

  console.log(`买家抵达结果: ${JSON.stringify(arrive2.body)}`)

  // 查询城市数据验证
  const cityRes = await request.get(`${API}/lobster/city/venice`).timeout(10000)
  const players = cityRes.body.data.players

  const sellerInCity = players.find(p => p.openid === seller.openid)
  const buyerInCity = players.find(p => p.openid === buyer.openid)

  console.log('\n城市数据验证:')
  console.log(`卖家 cargoCapacity: ${JSON.stringify(sellerInCity?.cargoCapacity)}`)
  console.log(`买家 cargoCapacity: ${JSON.stringify(buyerInCity?.cargoCapacity)}`)

  console.log('\n测试完成')
}

test().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
