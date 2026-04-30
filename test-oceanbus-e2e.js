#!/usr/bin/env node

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = 'https://ai-t.ihaola.com.cn/api/l0'
const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

const TIMEOUT_MS = 30000

function log(role, msg) {
  console.log(`[${new Date().toISOString().substr(11, 12)}] [${role}] ${msg}`)
}

function pass(testName) {
  console.log(`  ✅ PASS: ${testName}`)
}

function fail(testName, detail) {
  console.log(`  ❌ FAIL: ${testName} — ${detail}`)
}

let passed = 0
let failed = 0

function check(condition, testName, detail = '') {
  if (condition) {
    pass(testName)
    passed++
  } else {
    fail(testName, detail)
    failed++
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function testPhase0_L1Identity() {
  log('L1', '====== Phase 0: L1 GameServer 身份验证 ======')

  log('L1', '注册临时 Agent 并向 L1 发送 ping 验证其在线...')
  const tempAgent = new OceanBusClient(OCEANBUS_URL)
  const regResult = await tempAgent.register()
  if (regResult.code !== 0 || !tempAgent.isReady()) {
    fail('临时 Agent 注册', `code=${regResult.code}`)
    return false
  }
  log('L1', `临时 Agent: agentCode=${tempAgent.agentCode}, openid=${tempAgent.openid?.substring(0, 20)}...`)

  const pingReqId = `req_${Date.now()}_ping`
  await tempAgent.sendMessage(L1_OPENID, JSON.stringify({
    action: 'ping',
    request_id: pingReqId
  }))

  const pingReply = await tempAgent.pollForReply(pingReqId, 15000, 2000)
  if (pingReply && pingReply.code === 0) {
    pass('L1 ping 响应正常')
    log('L1', `L1 返回: ${JSON.stringify(pingReply.data).substring(0, 100)}`)
  } else {
    fail('L1 ping 响应', pingReply ? `code=${pingReply.code}` : '超时无响应')
    log('L1', '⚠️ L1 服务可能未启动 (node start-oceanbus.js)')
    log('L1', '⚠️ 或 L1_OPENID 已失效（重注册导致漂移）')
    log('L1', `⚠️ 当前 L1_OPENID = ${L1_OPENID.substring(0, 30)}...`)
  }

  return pingReply && pingReply.code === 0
}

async function testPhase1_SkillA_to_L1() {
  log('Skill-A', '====== Phase 1: Skill A → L1 通信测试 ======')

  const skillA = new OceanBusClient(OCEANBUS_URL)

  log('Skill-A', 'Step 0: 注册到 OceanBus...')
  const regResult = await skillA.register()
  check(regResult.code === 0, 'Skill A register()', `code=${regResult.code}`)
  check(skillA.isReady(), 'Skill A 三要素完整', `agentCode=${skillA.agentCode}, openid=${skillA.openid?.substring(0, 20)}, hasApiKey=${!!skillA.apiKey}`)
  log('Skill-A', `  agentCode: ${skillA.agentCode}`)
  log('Skill-A', `  openid:    ${skillA.openid?.substring(0, 30)}...`)

  log('Skill-A', 'Step 1: 读取硬编码 L1_OPENID (模拟)')
  log('Skill-A', `  L1_OPENID = ${L1_OPENID.substring(0, 30)}...`)
  check(!!L1_OPENID, 'L1_OPENID 非空', 'L1_OPENID 为空')

  log('Skill-A', 'Step 2: 通过 L1_OPENID 发送 enroll 请求...')
  const enrollReqId = `req_${Date.now()}_enroll`
  await skillA.sendMessage(L1_OPENID, JSON.stringify({
    action: 'enroll',
    request_id: enrollReqId,
    openid: skillA.openid,
    publicKey: 'TEST_PUBLIC_KEY_A',
    initialGold: 10000
  }))
  pass('Skill A → L1 enroll 消息已发送')

  log('Skill-A', 'Step 3: syncMessages() 轮询 L1 响应...')
  const enrollReply = await skillA.pollForReply(enrollReqId, 15000, 2000)
  check(!!enrollReply, 'Skill A 收到 L1 enroll 响应', '超时无响应')
  if (enrollReply) {
    check(enrollReply.code === 0, 'L1 enroll 返回成功', `code=${enrollReply.code}, msg=${enrollReply.data?.msg || ''}`)
    log('Skill-A', `  L1 返回: ${JSON.stringify(enrollReply.data?.doc || enrollReply.data || {}).substring(0, 120)}`)
  }

  log('Skill-A', '额外测试: get_city 请求...')
  const cityReqId = `req_${Date.now()}_city`
  await skillA.sendMessage(L1_OPENID, JSON.stringify({
    action: 'get_city',
    request_id: cityReqId,
    city_id: 'canton'
  }))
  const cityReply = await skillA.pollForReply(cityReqId, 15000, 2000)
  check(!!cityReply, 'Skill A 收到 L1 get_city 响应', '超时无响应')
  if (cityReply && cityReply.code === 0) {
    const cityData = cityReply.data
    log('Skill-A', `  城市: ${cityData?.city?.name || 'N/A'}`)
    log('Skill-A', `  停靠玩家数: ${cityData?.players?.length || 0}`)
  }

  return skillA
}

async function testPhase2_SkillB(skillAOpenid) {
  log('Skill-B', '====== Phase 2: Skill B 注册 + P2P 消息 ======')

  const skillB = new OceanBusClient(OCEANBUS_URL)

  log('Skill-B', 'Step 0: 注册到 OceanBus...')
  const regResult = await skillB.register()
  check(regResult.code === 0, 'Skill B register()', `code=${regResult.code}`)
  check(skillB.isReady(), 'Skill B 三要素完整', `agentCode=${skillB.agentCode}, openid=${skillB.openid?.substring(0, 20)}`)
  log('Skill-B', `  agentCode: ${skillB.agentCode}`)
  log('Skill-B', `  openid:    ${skillB.openid?.substring(0, 30)}...`)

  log('Skill-B', `Step 1: 通过 L1_OPENID 发送 enroll (B 也要入驻游戏) ...`)
  const enrollReqId = `req_${Date.now()}_enroll_b`
  await skillB.sendMessage(L1_OPENID, JSON.stringify({
    action: 'enroll',
    request_id: enrollReqId,
    openid: skillB.openid,
    publicKey: 'TEST_PUBLIC_KEY_B',
    initialGold: 8000
  }))
  const enrollReply = await skillB.pollForReply(enrollReqId, 15000, 2000)
  check(!!enrollReply && enrollReply.code === 0, 'Skill B enroll 成功', enrollReply ? `code=${enrollReply.code}` : '超时')

  return skillB
}

async function testPhase3_P2P(skillA, skillB) {
  log('P2P', '====== Phase 3: Skill B → Skill A P2P 通信 ======')

  log('P2P', `Skill B (${skillB.openid?.substring(0, 20)}...) → Skill A (${skillA.openid?.substring(0, 20)}...)`)

  log('P2P', 'Step 1: B 发送 P2P 消息给 A...')
  const p2pMsg = JSON.stringify({
    type: 'p2p_bargain',
    from: skillB.openid,
    action: 'p2p_offer',
    request_id: `p2p_${Date.now()}`,
    item: 'spice',
    amount: 10,
    price: 500,
    message: '要不要10箱香料？每箱500金币'
  })
  const sendResult = await skillB.sendMessage(skillA.openid, p2pMsg)
  check(sendResult.code === 0, 'B → A P2P 消息发送成功', `code=${sendResult.code}`)
  log('P2P', `  发送结果: code=${sendResult.code}`)

  log('P2P', 'Step 2: A syncMessages() 收取 B 的 P2P 消息...')
  await sleep(3000)

  let aReceivedP2P = false
  const syncResult = await skillA.syncMessages()
  if (syncResult.code === 0 && syncResult.data && syncResult.data.messages) {
    log('P2P', `  A 信箱有 ${syncResult.data.messages.length} 条消息`)
    for (const msg of syncResult.data.messages) {
      try {
        const payload = JSON.parse(msg.content)
        if (payload.type === 'p2p_bargain' || payload.action === 'p2p_offer') {
          aReceivedP2P = true
          log('P2P', `  A 收到 B 的砍价: item=${payload.item}, amount=${payload.amount}, price=${payload.price}`)
          log('P2P', `  B 说: "${payload.message}"`)
        }
      } catch (e) {}
    }
  } else {
    log('P2P', `  syncMessages 失败: code=${syncResult.code}`)
  }
  check(aReceivedP2P, 'A 收到 B 的 P2P 消息', '未在 A 信箱中找到 P2P 消息')

  log('P2P', 'Step 3: A 回复 B...')
  if (aReceivedP2P) {
    const replyMsg = JSON.stringify({
      type: 'p2p_counter',
      from: skillA.openid,
      action: 'p2p_counter_offer',
      request_id: `p2p_reply_${Date.now()}`,
      item: 'spice',
      amount: 10,
      price: 450,
      message: '太贵了！450一箱成交？'
    })
    const replyResult = await skillA.sendMessage(skillB.openid, replyMsg)
    check(replyResult.code === 0, 'A → B 回复发送成功', `code=${replyResult.code}`)

    await sleep(3000)
    const bSync = await skillB.syncMessages()
    let bReceivedReply = false
    if (bSync.code === 0 && bSync.data && bSync.data.messages) {
      for (const msg of bSync.data.messages) {
        try {
          const payload = JSON.parse(msg.content)
          if (payload.type === 'p2p_counter' || payload.action === 'p2p_counter_offer') {
            bReceivedReply = true
            log('P2P', `  B 收到 A 的还价: price=${payload.price}`)
            log('P2P', `  A 说: "${payload.message}"`)
          }
        } catch (e) {}
      }
    }
    check(bReceivedReply, 'B 收到 A 的还价', '未在 B 信箱中找到还价消息')
  }
}

async function main() {
  console.log('')
  console.log('🦞 龙虾船长 OceanBus L0 全链路 E2E 通信测试')
  console.log('============================================')
  console.log(`OCEANBUS_URL: ${OCEANBUS_URL}`)
  console.log(`L1_OPENID:    ${L1_OPENID.substring(0, 30)}...`)
  console.log('')

  try {
    const l1Alive = await testPhase0_L1Identity()
    console.log('')

    if (!l1Alive) {
      log('SYSTEM', '⚠️ L1 服务未响应，后续测试很可能失败')
      log('SYSTEM', '请先启动 L1: cd ai-backend-template/src/apps/03-LobsterSvc && node start-oceanbus.js')
      console.log('')
    }

    const skillA = await testPhase1_SkillA_to_L1()
    console.log('')

    const skillB = await testPhase2_SkillB(skillA.openid)
    console.log('')

    if (skillA && skillB) {
      await testPhase3_P2P(skillA, skillB)
      console.log('')
    }

    console.log('============================================')
    console.log(`📊 测试结果: ${passed} passed, ${failed} failed`)
    if (failed === 0) {
      console.log('🎉 全部通过！')
    } else {
      console.log('⚠️ 部分测试未通过，请检查上方日志')
    }
    console.log('')

  } catch (err) {
    console.error('测试异常:', err)
  }

  process.exit(0)
}

main()
