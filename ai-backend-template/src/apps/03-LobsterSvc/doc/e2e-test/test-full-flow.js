/**
 * @file test-full-flow.js
 * @description 完整游戏流程测试：入驻 → 进货 → 谈判 → 交割
 */

const request = require('superagent')

const API = 'http://localhost:17019/api'

async function test() {
  console.log('\n' + '═'.repeat(60))
  console.log('  🦞 龙虾船长 - 完整游戏流程测试')
  console.log('═'.repeat(60) + '\n')

  const captainA = { name: 'Captain_A' }
  const captainB = { name: 'Captain_B' }

  console.log('【第1步】创建两个船长')
  console.log('-'.repeat(40))

  for (const [key, cap] of [['a', captainA], ['b', captainB]]) {
    const res = await request
      .post(`${API}/lobster/enroll`)
      .send({
        openid: `test_full_${key}_${Date.now()}`,
        publicKey: `key_${key}_${Date.now()}`,
        initialGold: 10000
      })
      .timeout(10000)

    if (res.body.code === 0) {
      cap.openid = res.body.data.doc.openid
      cap.playerId = res.body.data.doc.id
      cap.gold = res.body.data.doc.gold
      cap.cargo = {}
      console.log(`  ✅ ${cap.name}: ${cap.openid}`)
      console.log(`     初始金币: ${cap.gold}`)
    } else {
      console.log(`  ❌ ${cap.name} 创建失败`)
      return
    }
  }

  console.log('\n【第2步】Captain_A 在广州买入丝绸')
  console.log('-'.repeat(40))

  const buyRes = await request
    .post(`${API}/lobster/trade/npc`)
    .send({
      openid: captainA.openid,
      item: 'silk',
      amount: 10,
      action: 'buy'
    })
    .timeout(10000)

  if (buyRes.body.code === 0) {
    captainA.gold = buyRes.body.data.playerGold
    captainA.cargo = buyRes.body.data.cargo
    console.log(`  ✅ 买入成功`)
    console.log(`     金币: 10000 → ${captainA.gold}`)
    console.log(`     货舱: ${JSON.stringify(captainA.cargo)}`)
    console.log(`     装载量: ${buyRes.body.data.cargoUsed}/${buyRes.body.data.cargoCapacity}`)
  } else {
    console.log(`  ❌ 买入失败: ${buyRes.body.msg}`)
    return
  }

  console.log('\n【第3步】Captain_A 航行至威尼斯')
  console.log('-'.repeat(40))

  const move1 = await request
    .post(`${API}/lobster/action/move`)
    .send({ openid: captainA.openid, targetCity: 'venice' })
    .timeout(10000)

  if (move1.body.data.sailingTime) {
    console.log(`  📍 启航，预计 ${move1.body.data.sailingTime} 分钟`)
  }

  await new Promise(r => setTimeout(r, 500))

  const move2 = await request
    .post(`${API}/lobster/action/move`)
    .send({ openid: captainA.openid, targetCity: 'venice' })
    .timeout(10000)

  if (move2.body.data.status === 'docked') {
    console.log(`  ✅ 抵达威尼斯`)
  }

  console.log('\n【第4步】Captain_A 发布销售意向')
  console.log('-'.repeat(40))

  const intentRes = await request
    .post(`${API}/lobster/action/intent`)
    .send({
      openid: captainA.openid,
      intent: '急售丝绸 10 箱，价格可议！'
    })
    .timeout(10000)

  if (intentRes.body.code === 0) {
    console.log(`  ✅ 意向牌已更新: "${intentRes.body.data.intent}"`)
  }

  console.log('\n【第5步】Captain_B 查询威尼斯城市信息')
  console.log('-'.repeat(40))

  const cityRes = await request
    .get(`${API}/lobster/city/venice`)
    .timeout(10000)

  if (cityRes.body.code === 0) {
    const city = cityRes.body.data
    console.log(`  📍 城市: ${city.city.name}`)
    console.log(`  🏪 丝绸价格: 买入 ${city.city.prices.silk.buy}, 卖出 ${city.city.prices.silk.sell}`)
    console.log(`  👥 停靠船长: ${city.players.length} 位`)
    
    const capA = city.players.find(p => p.openid === captainA.openid)
    if (capA) {
      console.log(`  📋 Captain_A 意向: "${capA.intent}"`)
    }
  }

  console.log('\n【第6步】OceanBus 消息通信（模拟谈判）')
  console.log('-'.repeat(40))

  console.log(`  💬 Captain_B: "老板，丝绸怎么卖？"`)
  
  console.log(`  💬 Captain_A: "600金币/箱，一共6000金币！"`)
  
  console.log(`  💬 Captain_B: "太贵了！550金币成交？"`)
  
  console.log(`  💬 Captain_A: "成交！"`)
  
  console.log(`  ✅ 双方达成协议: 10箱丝绸，5500金币，交割城市威尼斯`)

  console.log('\n【第7步】创建交易合约')
  console.log('-'.repeat(40))

  const contractRes = await request
    .post(`${API}/lobster/contract/create`)
    .send({
      buyerOpenid: captainB.openid,
      sellerOpenid: captainA.openid,
      item: 'silk',
      amount: 10,
      price: 550,
      deliveryCity: 'venice'
    })
    .timeout(10000)

  if (contractRes.body.code === 0) {
    const contract = contractRes.body.data.contract
    captainA.contractId = contract.id
    console.log(`  ✅ 合约创建成功`)
    console.log(`     合约ID: ${contract.id}`)
    console.log(`     商品: ${contract.amount} ${contract.item}`)
    console.log(`     单价: ${contract.price}`)
    console.log(`     总价: ${contract.totalPrice}`)
    console.log(`     交割城市: ${contract.deliveryCity}`)
    console.log(`     状态: ${contract.status}`)
  } else {
    console.log(`  ❌ 合约创建失败: ${contractRes.body.msg}`)
    return
  }

  console.log('\n【第8步】Captain_A 抵达并卸货')
  console.log('-'.repeat(40))

  const arriveA = await request
    .post(`${API}/lobster/action/arrive`)
    .send({ openid: captainA.openid })
    .timeout(10000)

  if (arriveA.body.code === 0) {
    if (arriveA.body.data.settleResults.length > 0) {
      const result = arriveA.body.data.settleResults[0]
      console.log(`  📦 ${result.result}: ${result.reason}`)
      if (result.settleAt) {
        console.log(`  ⏰ 等待超时时间: ${new Date(result.settleAt).toLocaleTimeString()}`)
      }
    } else {
      console.log(`  ✅ 处理完成，无待交割合约`)
    }
    console.log(`     当前金币: ${arriveA.body.data.playerGold}`)
  }

  console.log('\n【第9步】Captain_B 航行至威尼斯')
  console.log('-'.repeat(40))

  const moveB1 = await request
    .post(`${API}/lobster/action/move`)
    .send({ openid: captainB.openid, targetCity: 'venice' })
    .timeout(10000)

  if (moveB1.body.data.sailingTime) {
    console.log(`  📍 启航，预计 ${moveB1.body.data.sailingTime} 分钟`)
  }

  await new Promise(r => setTimeout(r, 500))

  const moveB2 = await request
    .post(`${API}/lobster/action/move`)
    .send({ openid: captainB.openid, targetCity: 'venice' })
    .timeout(10000)

  if (moveB2.body.data.status === 'docked') {
    console.log(`  ✅ 抵达威尼斯`)
  }

  console.log('\n【第10步】Captain_B 抵达并交割')
  console.log('-'.repeat(40))

  const arriveB = await request
    .post(`${API}/lobster/action/arrive`)
    .send({ openid: captainB.openid })
    .timeout(10000)

  if (arriveB.body.code === 0) {
    captainB.gold = arriveB.body.data.playerGold
    captainB.cargo = arriveB.body.data.cargo

    if (arriveB.body.data.settleResults.length > 0) {
      const result = arriveB.body.data.settleResults[0]
      console.log(`  🎉 ${result.result}: ${result.reason}`)
    }

    console.log(`     当前金币: ${captainB.gold}`)
    console.log(`     当前货舱: ${JSON.stringify(captainB.cargo)}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('  📊 最终状态对比')
  console.log('═'.repeat(60))

  console.log(`\n  Captain_A (卖家):`)
  console.log(`    初始金币: 10000`)
  console.log(`    买入丝绸: -4750 (金币)`)
  console.log(`    出售丝绸: +5500 (金币)`)
  console.log(`    最终金币: ${captainA.gold} (${captainA.gold >= 10000 ? '+' : ''}${captainA.gold - 10000})`)
  console.log(`    最终货物: ${JSON.stringify(captainA.cargo)}`)

  console.log(`\n  Captain_B (买家):`)
  console.log(`    初始金币: 10000`)
  console.log(`    买入丝绸: -5500 (金币)`)
  console.log(`    最终金币: ${captainB.gold} (${captainB.gold >= 10000 ? '+' : ''}${captainB.gold - 10000})`)
  console.log(`    最终货物: ${JSON.stringify(captainB.cargo)}`)

  console.log('\n' + '═'.repeat(60))
  console.log('  🧮 经济账目验证')
  console.log('═'.repeat(60))

  const totalGold = captainA.gold + captainB.gold
  const totalCargo = 
    (captainA.cargo.silk || 0) + (captainB.cargo.silk || 0)

  console.log(`\n  💰 总金币流动:`)
  console.log(`     A: 10000 → ${captainA.gold} (${captainA.gold - 10000 >= 0 ? '+' : ''}${captainA.gold - 10000})`)
  console.log(`     B: 10000 → ${captainB.gold} (${captainB.gold - 10000 >= 0 ? '+' : ''}${captainB.gold - 10000})`)
  console.log(`     系统增发: ${20000 - totalGold} (NPC交易价差)`)

  console.log(`\n  📦 货物流动:`)
  console.log(`     A: {} → ${JSON.stringify(captainA.cargo)}`)
  console.log(`     B: {} → ${JSON.stringify(captainB.cargo)}`)
  console.log(`     总计: ${totalCargo} 箱`)

  console.log('\n' + '═'.repeat(60))

  if (captainA.gold > 10000 && captainB.cargo.silk === 10) {
    console.log('  ✅ 测试通过！交易流程正常')
  } else {
    console.log('  ⚠️ 请检查数据')
  }

  console.log('═'.repeat(60) + '\n')

  console.log('📝 合约状态验证')
  console.log('-'.repeat(40))

  const contractList = await request
    .get(`${API}/lobster/contract/list`)
    .query({ openid: captainA.openid })
    .timeout(10000)

  if (contractList.body.code === 0) {
    const myContracts = contractList.body.data.contracts
    const completed = myContracts.find(c => c.id === captainA.contractId)
    if (completed) {
      console.log(`  合约 ${completed.id}:`)
      console.log(`    状态: ${completed.status}`)
      console.log(`    卖家抵达: ${completed.sellerArrived}`)
      console.log(`    买家抵达: ${completed.buyerArrived}`)
    }
  }

  console.log('\n🦞 测试完成！\n')
}

test().catch(err => {
  console.error('\n❌ 测试异常:', err.message)
  process.exit(1)
})
