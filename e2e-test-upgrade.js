/**
 * @file e2e-test-upgrade.js
 * @description 升级后的端到端测试
 */

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')
const KeyStore = require('./skills/captain-lobster/src/keystore')

const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }
const OCEANBUS_URL = 'https://ai-t.ihaola.com.cn/api/l0'

let testCount = 0
let passCount = 0
let failCount = 0

function assert(condition, testName) {
  testCount++
  if (condition) {
    passCount++
    console.log(`  ✅ ${testName}`)
  } else {
    failCount++
    console.log(`  ❌ ${testName}`)
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function drainMessages(client, maxDrains = 5) {
  for (let i = 0; i < maxDrains; i++) {
    const result = await client.syncMessages()
    if (result.code === 0 && result.data) {
      if (!result.data.messages || result.data.messages.length === 0) break
    }
    await sleep(1000)
  }
}

async function sendAndReceive(client, l1Openid, action, params, maxAttempts = 45, intervalMs = 1000) {
  const requestId = `e2e_${action}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
  const request = { action, request_id: requestId, ...params }

  await client.sendMessage(l1Openid, JSON.stringify(request))

  let attempts = 0
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, intervalMs))
    const syncResult = await client.syncMessages()
    if (syncResult.code === 0 && syncResult.data && syncResult.data.messages) {
      for (const msg of syncResult.data.messages) {
        try {
          const payload = JSON.parse(msg.content)
          if (payload.request_id === requestId) {
            return payload
          }
        } catch (e) {}
      }
    }
    attempts++
  }
  return null
}

async function testOceanBusIdentity() {
  console.log('\n📋 测试组 1: OceanBus 身份注册')

  const client = new OceanBusClient(OCEANBUS_URL)
  const result = await client.register()

  assert(result.code === 0, 'register() 返回 code=0')
  assert(!!client.apiKey, '获取到 apiKey')
  assert(!!client.agentCode, '获取到 agentCode')
  assert(!!client.openid, 'register + lookup 获取到 openid')
  assert(client.isReady(), '三要素完整, isReady()=true')

  console.log(`  ℹ️  agentCode: ${client.agentCode}`)
  console.log(`  ℹ️  openid: ${client.openid.substring(0, 30)}...`)

  return client
}

async function testSkillToL1(client) {
  console.log('\n📋 测试组 2: Skill → L1 通信')

  // drain old messages first
  await drainMessages(client)

  // ping
  const pingReply = await sendAndReceive(client, L1_OPENID, 'ping', {})
  assert(!!pingReply, 'ping 收到响应')
  assert(pingReply?.code === 0, 'ping 响应 code=0')
  assert(pingReply?.data?.service === 'lobster-l1', 'ping 响应标识为 lobster-l1')

  // enroll
  const enrollReply = await sendAndReceive(client, L1_OPENID, 'enroll', {
    openid: client.openid, publicKey: 'test_key_e2e', initialGold: 10000
  })
  assert(!!enrollReply, 'enroll 收到响应')
  assert(enrollReply?.code === 0, 'enroll 响应 code=0')
  assert(!!enrollReply?.data?.doc, 'enroll 返回玩家文档')
  assert(enrollReply?.data?.doc?.gold === 10000, '初始金币 10000')
  assert(enrollReply?.data?.doc?.currentCity === 'canton', '初始城市广州')

  // get_city
  const cityReply = await sendAndReceive(client, L1_OPENID, 'get_city', { city_id: 'canton' })
  assert(!!cityReply, 'get_city 收到响应')
  assert(cityReply?.code === 0, 'get_city 响应 code=0')
  assert(!!cityReply?.data?.city, 'get_city 返回城市信息')
  assert(!!cityReply?.data?.city?.prices, 'get_city 返回物价表')
  assert(cityReply?.data?.city?.name === '广州', '广州名称正确')

  // trade_npc (buy silk)
  const tradeReply = await sendAndReceive(client, L1_OPENID, 'trade_npc', {
    openid: client.openid, item: 'silk', amount: 10, trade_action: 'buy'
  })
  assert(!!tradeReply, 'trade_npc buy 收到响应')
  assert(tradeReply?.code === 0, 'trade_npc buy 响应 code=0')
  assert(!!tradeReply?.data?.cargo, 'trade_npc 返回货舱信息')

  // intent
  const intentReply = await sendAndReceive(client, L1_OPENID, 'intent', {
    openid: client.openid, intent: '大量收购香料！'
  })
  assert(!!intentReply, 'intent 收到响应')
  assert(intentReply?.code === 0, 'intent 响应 code=0')

  // status
  const statusReply = await sendAndReceive(client, L1_OPENID, 'status', {
    openid: client.openid
  })
  assert(!!statusReply, 'status 收到响应')
  assert(statusReply?.code === 0, 'status 响应 code=0')
  assert(!!statusReply?.data?.player, 'status 返回玩家信息')

  // list_contracts
  const listReply = await sendAndReceive(client, L1_OPENID, 'list_contracts', {
    openid: client.openid
  })
  assert(!!listReply, 'list_contracts 收到响应')
  assert(listReply?.code === 0, 'list_contracts 响应 code=0')

  // sell some silk back
  const sellReply = await sendAndReceive(client, L1_OPENID, 'trade_npc', {
    openid: client.openid, item: 'silk', amount: 5, trade_action: 'sell'
  })
  assert(!!sellReply, 'trade_npc sell 收到响应')
  assert(sellReply?.code === 0, 'trade_npc sell 响应 code=0')
}

async function testP2P(clientA, clientB) {
  console.log('\n📋 测试组 3: P2P 通信 (A → B)')

  await drainMessages(clientB)

  const testMsg = JSON.stringify({
    type: 'p2p_test',
    from: clientA.openid,
    content: '你好 B，我是 A！砍价吗？',
    ts: Date.now()
  })

  const sendResult = await clientA.sendMessage(clientB.openid, testMsg)
  assert(sendResult.code === 0, 'A → B 消息发送成功')

  await sleep(3000)

  const syncResult = await clientB.syncMessages()
  assert(syncResult.code === 0, 'B syncMessages 成功')

  const p2pMessages = clientB.parseMessages(syncResult.data?.messages, 'p2p_test')
  assert(p2pMessages.length > 0, 'B 收到 A 的 P2P 消息')
  if (p2pMessages.length > 0) {
    assert(p2pMessages[0].content === '你好 B，我是 A！砍价吗？', 'P2P 消息内容匹配')
  }
}

async function testKeyStore() {
  console.log('\n📋 测试组 4: 密钥签名 & 验签')

  const ks = new KeyStore()

  const keyPair = ks.generateKeyPair()
  assert(!!keyPair.publicKey, '生成公钥')
  assert(!!keyPair.privateKey, '生成私钥')

  const testData = 'hello lobster captain'
  const signature = ks.sign(keyPair.privateKey, testData)
  assert(!!signature, '签名成功')

  const verified = ks.verify(keyPair.publicKey, testData, signature)
  assert(verified === true, '验签通过')

  const tampered = ks.verify(keyPair.publicKey, 'tampered data', signature)
  assert(tampered === false, '篡改数据验签失败')

  const tradePayload = {
    buyer_openid: 'buyer_123',
    seller_openid: 'seller_456',
    item: 'silk',
    amount: 10,
    total_price: 5000,
    delivery_city: 'venice'
  }
  const tradeSig = ks.signTrade(keyPair.privateKey, tradePayload)
  assert(!!tradeSig, '交易签名成功')

  const tradeVerified = ks.verifyTradeSignature(keyPair.publicKey, tradePayload, tradeSig)
  assert(tradeVerified === true, '交易签名验签通过')

  const testDir = require('path').join(require('os').tmpdir(), 'lobster-test-keys-' + Date.now())
  const ks2 = new KeyStore({ keyDir: testDir })
  ks2.saveKeyPair('testuser', 'testpassword123', keyPair)
  const loaded = ks2.loadKeyPair('testuser', 'testpassword123')
  assert(!!loaded, '加密存储后可加载')
  assert(loaded.publicKey === keyPair.publicKey, '加载后公钥一致')

  require('fs').rmSync(testDir, { recursive: true, force: true })
}

async function testThreeCities(client) {
  console.log('\n📋 测试组 5: 城市查询 (抽样 3 城市)')

  const cities = ['canton', 'venice', 'istanbul']
  let citiesOk = 0

  for (const cityId of cities) {
    const reply = await sendAndReceive(client, L1_OPENID, 'get_city', { city_id: cityId })
    if (reply?.code === 0 && reply?.data?.city?.name) {
      citiesOk++
      console.log(`  ℹ️  ${cityId}: ${reply.data.city.name} ✅`)
    } else {
      console.log(`  ℹ️  ${cityId}: 失败 ❌`)
    }
  }

  assert(citiesOk === 3, `3 城市全部可查询 (${citiesOk}/3)`)
}

async function main() {
  console.log('🦞 龙虾船长 升级后端到端测试')
  console.log('='.repeat(50))
  console.log(`L1 OpenID: ${L1_OPENID.substring(0, 30)}...`)
  console.log('')

  try {
    const clientA = await testOceanBusIdentity()
    const clientB = new OceanBusClient(OCEANBUS_URL)
    await clientB.register()
    assert(clientB.isReady(), 'Client B 身份注册成功')

    await testSkillToL1(clientA)
    await testP2P(clientA, clientB)
    await testKeyStore()
    await testThreeCities(clientA)

  } catch (err) {
    console.error('\n💥 测试异常:', err.message)
    console.error(err.stack)
  }

  console.log('\n' + '='.repeat(50))
  console.log(`🦞 测试结果: ${passCount}/${testCount} 通过`)
  if (failCount > 0) {
    console.log(`❌ 失败: ${failCount} 项`)
  } else {
    console.log('✅ 全部通过！')
  }

  process.exit(failCount > 0 ? 1 : 0)
}

main()
