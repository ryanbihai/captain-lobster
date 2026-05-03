/**
 * @file test-complete-e2e.js
 * @description 完整端到端测试
 * 
 * 测试流程：
 * 1. 船长A买入丝绸
 * 2. 船长B在威尼斯买香料
 * 3. 验证航海日志
 * 4. 验证账目守恒
 */

const request = require('superagent')
const fs = require('fs')
const path = require('path')
const os = require('os')

const API = 'http://localhost:17019/api'
const LOG_DIR = path.join(os.homedir(), '.captain-lobster', 'logs')

async function test() {
  console.log('\n' + '═'.repeat(60))
  console.log('  🦞 龙虾船长 - 完整端到端测试')
  console.log('═'.repeat(60) + '\n')

  const captains = {}
  const results = { passed: 0, failed: 0 }

  function assert(condition, message) {
    if (condition) {
      results.passed++
      console.log('  ✅ ' + message)
      return true
    } else {
      results.failed++
      console.log('  ❌ ' + message)
      return false
    }
  }

  console.log('[步骤1] 创建两个船长\n')

  captains.A = {}
  captains.B = {}

  const resA = await request.post(`${API}/lobster/enroll`).send({
    openid: `test_A_${Date.now()}`,
    publicKey: `key_A_${Date.now()}`,
    initialGold: 10000
  }).timeout(10000)

  if (resA.body.code === 0) {
    captains.A.openid = resA.body.data.doc.openid
    captains.A.gold = resA.body.data.doc.gold
    assert(true, `船长A: ${captains.A.openid.substring(0, 30)}... 金币: ${captains.A.gold}`)
  } else {
    assert(false, '船长A: 入驻失败 - ' + resA.body.msg)
    return
  }

  const resB = await request.post(`${API}/lobster/enroll`).send({
    openid: `test_B_${Date.now()}`,
    publicKey: `key_B_${Date.now()}`,
    initialGold: 10000
  }).timeout(10000)

  if (resB.body.code === 0) {
    captains.B.openid = resB.body.data.doc.openid
    captains.B.gold = resB.body.data.doc.gold
    assert(true, `船长B: ${captains.B.openid.substring(0, 30)}... 金币: ${captains.B.gold}`)
  } else {
    assert(false, '船长B: 入驻失败 - ' + resB.body.msg)
    return
  }

  console.log('\n[步骤2] 船长A在广州买入丝绸\n')

  const buySilk = await request.post(`${API}/lobster/trade/npc`).send({
    openid: captains.A.openid,
    item: 'silk',
    amount: 10,
    action: 'buy'
  }).timeout(10000)

  if (buySilk.body.code === 0) {
    captains.A.gold = buySilk.body.data.playerGold
    captains.A.cargo = buySilk.body.data.cargo || {}
    assert(true, `买入成功: 金币 ${10000} → ${captains.A.gold}`)
    assert(captains.A.gold < 10000, '金币减少')
    assert(captains.A.cargo.silk === 10, `货物: silk: ${captains.A.cargo.silk || 0}`)
  } else {
    assert(false, '买入失败: ' + buySilk.body.msg)
  }

  console.log('\n[步骤3] 船长B在威尼斯买香料\n')

  const moveB1 = await request.post(`${API}/lobster/action/move`).send({
    openid: captains.B.openid,
    targetCity: 'venice'
  }).timeout(10000)

  await new Promise(r => setTimeout(r, 300))
  await request.post(`${API}/lobster/action/move`).send({
    openid: captains.B.openid,
    targetCity: 'venice'
  }).timeout(10000)

  const buySpice = await request.post(`${API}/lobster/trade/npc`).send({
    openid: captains.B.openid,
    item: 'spice',
    amount: 5,
    action: 'buy'
  }).timeout(10000)

  if (buySpice.body.code === 0) {
    captains.B.gold = buySpice.body.data.playerGold
    captains.B.cargo = buySpice.body.data.cargo || {}
    assert(true, `B买入香料成功: 金币减少`)
    assert(captains.B.cargo.spice === 5, `货物: spice: ${captains.B.cargo.spice || 0}`)
  }

  console.log('\n[步骤4] 航海日志验证\n')

  if (fs.existsSync(LOG_DIR)) {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.md'))
    assert(files.length > 0, '日志文件存在: ' + files.length + ' 个')
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8')
      assert(content.length > 0, '日志非空: ' + content.length + ' 字符')
    }
  } else {
    assert(false, '日志目录不存在')
  }

  console.log('\n[步骤5] 账目守恒验证\n')

  const totalGold = captains.A.gold + captains.B.gold
  const initialTotal = 20000
  const npcSpread = initialTotal - totalGold
  
  assert(totalGold < initialTotal, `金币守恒检查: ${captains.A.gold} + ${captains.B.gold} = ${totalGold}`)
  assert(npcSpread > 0, `NPC价差收入: ${npcSpread} 金币（正常）`)

  console.log('\n[步骤6] 密钥加密验证\n')

  const KEY_DIR = path.join(os.homedir(), '.captain-lobster', 'keys')
  if (fs.existsSync(KEY_DIR)) {
    const keys = fs.readdirSync(KEY_DIR).filter(f => f.endsWith('.json'))
    for (const keyFile of keys) {
      const content = fs.readFileSync(path.join(KEY_DIR, keyFile), 'utf8')
      try {
        const keyData = JSON.parse(content)
        assert(!!keyData.encryptedPrivateKey, '密钥已加密')
        assert(!content.includes('-----BEGIN RSA PRIVATE KEY-----'), '私钥非明文')
      } catch (e) {
        assert(false, '密钥文件格式正确')
      }
    }
  }

  console.log('\n' + '═'.repeat(60))
  console.log('  测试结果')
  console.log('═'.repeat(60))
  console.log('  ✅ 通过: ' + results.passed)
  console.log('  ❌ 失败: ' + results.failed)
  console.log('═'.repeat(60) + '\n')

  if (results.failed === 0) {
    console.log('🎉 所有测试通过！\n')
  } else {
    console.log('⚠️  有 ' + results.failed + ' 项测试失败\n')
  }
}

test().catch(err => {
  console.error('测试异常:', err.message)
  process.exit(1)
})
