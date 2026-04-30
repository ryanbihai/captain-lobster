/**
 * @file test-contract.js
 * @description 测试完整的交易合约流程
 */

const request = require('superagent')

const API_BASE = 'http://localhost:17019/api'

async function testContractFlow() {
  console.log('\n' + '═'.repeat(60))
  console.log('  龙虾船长 - 交易合约流程测试')
  console.log('═'.repeat(60) + '\n')

  const captains = {}

  console.log('[步骤 1] 创建两个测试玩家...')
  
  for (const [name, city] of [['Seller_A', 'canton'], ['Buyer_B', 'venice']]) {
    const res = await request
      .post(`${API_BASE}/lobster/enroll`)
      .send({
        openid: `test_contract_${name}_${Date.now()}`,
        publicKey: 'test_key_' + Date.now(),
        initialGold: 10000
      })
      .timeout(10000)
    
    if (res.body.code === 0) {
      captains[name] = {
        openid: res.body.data.doc.openid,
        playerId: res.body.data.doc.id,
        gold: res.body.data.doc.gold
      }
      console.log(`  ✅ ${name}: openid=${captains[name].openid}, gold=${captains[name].gold}`)
    } else {
      console.log(`  ❌ ${name}: ${res.body.msg}`)
      return
    }
  }

  console.log('\n[步骤 2] Seller_A 在广州买入丝绸...')
  
  const seller = captains.Seller_A
  const tradeRes = await request
    .post(`${API_BASE}/lobster/trade/npc`)
    .send({
      openid: seller.openid,
      item: 'silk',
      amount: 10,
      action: 'buy'
    })
    .timeout(10000)

  if (tradeRes.body.code === 0) {
    seller.gold = tradeRes.body.data.playerGold
    seller.cargo = tradeRes.body.data.cargo
    console.log(`  ✅ 购买成功: gold=${seller.gold}, cargo=${JSON.stringify(seller.cargo)}`)
  } else {
    console.log(`  ❌ 购买失败: ${tradeRes.body.msg}`)
    return
  }

  console.log('\n[步骤 3] 创建交易合约...')
  
  const contractRes = await request
    .post(`${API_BASE}/lobster/contract/create`)
    .send({
      buyerOpenid: captains.Buyer_B.openid,
      sellerOpenid: seller.openid,
      item: 'silk',
      amount: 10,
      price: 500,
      deliveryCity: 'venice'
    })
    .timeout(10000)

  if (contractRes.body.code === 0) {
    const contract = contractRes.body.data.contract
    captains.Contract = contract
    console.log(`  ✅ 合约创建成功: ${contract.id}`)
    console.log(`     卖方: ${contract.sellerOpenid}`)
    console.log(`     买方: ${contract.buyerOpenid}`)
    console.log(`     商品: ${contract.amount} ${contract.item}`)
    console.log(`     总价: ${contract.totalPrice}`)
    console.log(`     交割城市: ${contract.deliveryCity}`)
    console.log(`     状态: ${contract.status}`)
  } else {
    console.log(`  ❌ 合约创建失败: ${contractRes.body.msg}`)
    return
  }

  console.log('\n[步骤 4] 移动 Seller_A 到威尼斯...')
  
  const moveToVenice = await request
    .post(`${API_BASE}/lobster/action/move`)
    .send({
      openid: seller.openid,
      targetCity: 'venice'
    })
    .timeout(10000)
  
  console.log(`  状态: ${moveToVenice.body.data.status}, 预计航行时间: ${moveToVenice.body.data.sailingTime} 分钟`)

  await new Promise(r => setTimeout(r, 500))

  const arriveVenice = await request
    .post(`${API_BASE}/lobster/action/move`)
    .send({
      openid: seller.openid,
      targetCity: 'venice'
    })
    .timeout(10000)
  
  console.log(`  抵达威尼斯，状态: ${arriveVenice.body.data.status}`)

  console.log('\n[步骤 5] Seller_A 抵达并检测交割（应该是卖家抵达）...')
  
  const sellerArrive = await request
    .post(`${API_BASE}/lobster/action/arrive`)
    .send({ openid: seller.openid })
    .timeout(10000)
  
  if (sellerArrive.body.code === 0) {
    console.log(`  ✅ 卖家抵达处理完成`)
    if (sellerArrive.body.data.settleResults.length > 0) {
      console.log(`     结果: ${JSON.stringify(sellerArrive.body.data.settleResults[0])}`)
    } else {
      console.log(`     无待处理合约`)
    }
  } else {
    console.log(`  ❌ 卖家抵达失败: ${sellerArrive.body.msg}`)
  }

  console.log('\n[步骤 6] 移动 Buyer_B 到威尼斯...')
  
  const buyer = captains.Buyer_B
  const buyerMove1 = await request
    .post(`${API_BASE}/lobster/action/move`)
    .send({
      openid: buyer.openid,
      targetCity: 'venice'
    })
    .timeout(10000)
  
  console.log(`  状态: ${buyerMove1.body.data.status}, 预计航行时间: ${buyerMove1.body.data.sailingTime} 分钟`)

  await new Promise(r => setTimeout(r, 500))

  const buyerArriveVenice = await request
    .post(`${API_BASE}/lobster/action/move`)
    .send({
      openid: buyer.openid,
      targetCity: 'venice'
    })
    .timeout(10000)
  
  console.log(`  抵达威尼斯，状态: ${buyerArriveVenice.body.data.status}`)

  console.log('\n[步骤 7] Buyer_B 抵达并检测交割（应该交割完成）...')
  
  const buyerArrive = await request
    .post(`${API_BASE}/lobster/action/arrive`)
    .send({ openid: buyer.openid })
    .timeout(10000)
  
  if (buyerArrive.body.code === 0) {
    buyer.gold = buyerArrive.body.data.playerGold
    buyer.cargo = buyerArrive.body.data.cargo
    console.log(`  ✅ 交割处理完成`)
    if (buyerArrive.body.data.settleResults.length > 0) {
      console.log(`     结果: ${buyerArrive.body.data.settleResults[0].result} - ${buyerArrive.body.data.settleResults[0].reason}`)
    }
    console.log(`     买家金币: ${buyer.gold}`)
    console.log(`     买家货物: ${JSON.stringify(buyer.cargo)}`)
  } else {
    console.log(`  ❌ 交割失败: ${buyerArrive.body.msg}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('  测试结果汇总')
  console.log('═'.repeat(60))
  console.log(`  Seller_A (卖家):`)
  console.log(`    最终金币: ${seller.gold}`)
  console.log(`    最终货物: ${JSON.stringify(seller.cargo)}`)
  console.log(`  Buyer_B (买家):`)
  console.log(`    最终金币: ${buyer.gold}`)
  console.log(`    最终货物: ${JSON.stringify(buyer.cargo)}`)
  console.log('═'.repeat(60) + '\n')

  console.log('✅ 交易合约流程测试完成！')
}

testContractFlow()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ 测试异常:', err)
    process.exit(1)
  })
