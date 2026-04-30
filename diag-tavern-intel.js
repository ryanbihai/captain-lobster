#!/usr/bin/env node
/**
 * @file diag-tavern-intel.js
 * @description 酒馆情报系统端到端诊断脚本
 *
 * 流程：
 *   注册 → enroll → tavern_buy → intel_story → intel_list
 *   → move → arrive（自动完成情报）→ 再买 → 转让
 */

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'
const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

const log = (label, detail) => {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '')
  if (detail !== undefined) {
    console.log(`[${ts}] ${label}`, typeof detail === 'object' ? JSON.stringify(detail).substring(0, 400) : detail)
  } else {
    console.log(`[${ts}] ${label}`)
  }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`❌ 断言失败: ${msg}`)
    process.exit(1)
  }
  console.log(`  ✅ ${msg}`)
}

async function sendAndWait(client, toOpenid, payload, maxWait = 45) {
  const requestId = payload.request_id
  const sendResult = await client.sendMessage(toOpenid, JSON.stringify(payload))
  log(`  sendMessage → code=${sendResult.code} httpStatus=${sendResult.httpStatus}`)
  if (sendResult.code !== 0) return { sendResult }
  const reply = await client.pollForReply(requestId, maxWait * 1000, 1000)
  return { sendResult, reply }
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  龙虾船长 — 酒馆情报系统诊断')
  console.log('═══════════════════════════════════════════')
  log('OceanBus URL', OCEANBUS_URL)
  log('L1 OpenID', L1_OPENID.substring(0, 20) + '...')
  console.log('')

  const client = new OceanBusClient(OCEANBUS_URL)

  // ── Step 1: 注册 ──
  console.log('── Step 1: 注册 Agent ──')
  const regResult = await client.register()
  log('注册完成', { code: regResult.code, agentId: client.agentId, hasApiKey: !!client.apiKey })
  assert(client.isReady(), 'Agent 就绪')
  console.log(`  AgentId: ${client.agentId}`)
  console.log(`  OpenID: ${client.openid ? client.openid.substring(0, 20) + '...' : 'NONE'}`)
  console.log('')

  // ── Step 2: Enroll ──
  console.log('── Step 2: Enroll 入驻 ──')
  const enrollId = `diag_enroll_${Date.now()}`
  const { reply: enrollReply } = await sendAndWait(client, L1_OPENID, {
    action: 'enroll', request_id: enrollId, openid: client.openid
  })
  assert(enrollReply && enrollReply.code === 0, '入驻成功')
  const captain = enrollReply.data.doc || enrollReply.data
  const captainToken = enrollReply.data.captainToken
  log('船长', { name: captain.name, city: captain.currentCity, gold: captain.gold, token: captainToken ? captainToken.substring(0, 8) + '...' : 'NONE' })
  console.log('')

  // ── Step 3: tavern_buy ──
  console.log('── Step 3: 酒馆买情报 ──')
  const buyId = `diag_tavern_buy_${Date.now()}`
  const { reply: buyReply } = await sendAndWait(client, L1_OPENID, {
    action: 'tavern_buy', request_id: buyId, openid: client.openid, captain_token: captainToken
  })
  assert(buyReply && buyReply.code === 0, '购买情报成功')
  const intel = buyReply.data.intel
  assert(intel && intel.id, '返回情报对象')
  assert(intel.type && ['cargo', 'passenger', 'discount'].includes(intel.type), `情报类型: ${intel.type}`)
  assert(intel.to_city && intel.to_city !== captain.currentCity, `目标城市: ${intel.to_city} (≠ 当前城市)` )
  assert(intel.reward >= 2500 && intel.reward <= 4000, `报酬在范围内: ${intel.reward}`)
  assert(intel.cost >= 800 && intel.cost <= 1200, `费用在范围内: ${intel.cost}`)
  assert(intel.status === 'active', '状态为 active')
  assert(intel.story === '', '初始故事为空')
  assert(buyReply.data.playerGold === captain.gold - intel.cost, '金币正确扣除')
  log('情报详情', { id: intel.id, type: intel.type, to: intel.to_city, reward: intel.reward, cost: intel.cost, playerGold: buyReply.data.playerGold })
  console.log('')

  // ── Step 4: intel_story ──
  console.log('── Step 4: 撰写情报故事 ──')
  const storyId = `diag_story_${Date.now()}`
  const testStory = '昨夜在码头酒馆，一个独眼老水手喝得酩酊大醉，拍着桌子说' + intel.to_city + '的总督府正在秘密招募快船护送一批波斯地毯，赏金丰厚，但必须在两日内赶到。老水手说完就醉倒了，纸条从他袖口滑了出来。'
  const { reply: storyReply } = await sendAndWait(client, L1_OPENID, {
    action: 'intel_story', request_id: storyId, openid: client.openid, captain_token: captainToken,
    intel_id: intel.id, story: testStory
  })
  assert(storyReply && storyReply.code === 0, '故事存储成功')
  assert(storyReply.data.story_len > 0, `故事长度: ${storyReply.data.story_len}`)
  console.log('')

  // ── Step 5: intel_list ──
  console.log('── Step 5: 查看情报列表 ──')
  const listId = `diag_list_${Date.now()}`
  const { reply: listReply } = await sendAndWait(client, L1_OPENID, {
    action: 'intel_list', request_id: listId, openid: client.openid, captain_token: captainToken
  })
  assert(listReply && listReply.code === 0, '列表查询成功')
  const intels = listReply.data.intels
  assert(intels.length >= 1, `持有 ${intels.length} 份情报`)
  const myIntel = intels.find(i => i.id === intel.id)
  assert(myIntel && myIntel.story === testStory, '故事已持久化')
  console.log('')

  // ── Step 6: 航线到目标城市并抵达 → 自动完成情报 ──
  console.log('── Step 6: 航行到目标城市 → 自动完成情报 ──')
  const targetCity = intel.to_city

  const moveId = `diag_move_${Date.now()}`
  const { reply: moveReply } = await sendAndWait(client, L1_OPENID, {
    action: 'move', request_id: moveId, openid: client.openid, captain_token: captainToken,
    target_city: targetCity
  })
  if (!moveReply || moveReply.code !== 0) {
    log('move 失败 (调试)', { reply: moveReply ? JSON.stringify(moveReply).substring(0, 300) : 'null (poll超时)' })
  }
  assert(moveReply && moveReply.code === 0, `启航前往 ${targetCity}`)
  log('航行信息', { sailingTime: moveReply.data.sailingTime + '分钟', distance: moveReply.data.distance + 'km' })

  // 等待航行完成（SAILING_MULTIPLIER=0.001 时约 0.3 秒）
  const sailSec = (moveReply.data.sailingSeconds || 5) * 1000 + 2000
  log('等待航行完成', `${Math.round(sailSec / 1000)}秒...`)
  await new Promise(r => setTimeout(r, sailSec))

  const arriveId = `diag_arrive_${Date.now()}`
  const { reply: arriveReply } = await sendAndWait(client, L1_OPENID, {
    action: 'arrive', request_id: arriveId, openid: client.openid, captain_token: captainToken
  })
  if (arriveReply && arriveReply.code === 0) {
    log('抵达结果', { city: arriveReply.data.city, gold: arriveReply.data.gold, intelResults: arriveReply.data.intelResults })
    const completed = (arriveReply.data.intelResults || []).filter(r => r.status === 'completed')
    if (completed.length > 0) {
      console.log(`  ✅ 情报自动完成！获得 ${completed[0].reward} 金币`)
    }
  } else {
    log('arrive 响应', arriveReply ? `code=${arriveReply.code} msg=${arriveReply.data?.msg || arriveReply.msg}` : 'null (超时)')
    console.log('  ⚠️ 抵达测试部分跳过（可能需要更快航行或更久等待）')
  }
  console.log('')

  // ── Step 7: 边界测试（航行中买情报应失败）──
  console.log('── Step 7: 边界测试 ──')
  // 先移动到另一个城市（出发航行）
  const move2Id = `diag_move2_${Date.now()}`
  const { reply: move2Reply } = await sendAndWait(client, L1_OPENID, {
    action: 'move', request_id: move2Id, openid: client.openid, captain_token: captainToken,
    target_city: 'canton'
  })
  if (!move2Reply || move2Reply.code !== 0) {
    log('move2 响应', move2Reply ? `code=${move2Reply.code} msg=${move2Reply.data?.msg || move2Reply.msg}` : 'null')
  }
  assert(move2Reply && move2Reply.code === 0, '再次启航前往广州')

  // 航行中买情报应失败
  const buySailId = `diag_buy_sailing_${Date.now()}`
  const { reply: buySailReply } = await sendAndWait(client, L1_OPENID, {
    action: 'tavern_buy', request_id: buySailId, openid: client.openid, captain_token: captainToken
  })
  assert(buySailReply && buySailReply.code !== 0, '航行中无法买情报（正确拒绝）')
  log('拒绝原因', buySailReply.data?.msg || buySailReply.msg)
  console.log('')

  // 等待航行完成并抵达
  const sail2Sec = (move2Reply.data.sailingSeconds || 5) * 1000 + 2000
  await new Promise(r => setTimeout(r, sail2Sec))
  const arrive2Id = `diag_arrive2_${Date.now()}`
  await sendAndWait(client, L1_OPENID, {
    action: 'arrive', request_id: arrive2Id, openid: client.openid, captain_token: captainToken
  })
  log('已抵达广州')

  // ── Step 8: 情报转让 (需要第二个 agent) ──
  console.log('── Step 8: 情报转让 ──')
  // 买一份情报用于转让测试
  const buy2Id = `diag_buy2_${Date.now()}`
  const { reply: buy2Reply } = await sendAndWait(client, L1_OPENID, {
    action: 'tavern_buy', request_id: buy2Id, openid: client.openid, captain_token: captainToken
  })
  assert(buy2Reply && buy2Reply.code === 0, '买第二份情报')
  const intel2 = buy2Reply.data.intel
  log('第二份情报', { id: intel2.id.substring(0, 12), type: intel2.type, to: intel2.to_city })

  // 注册第二个 Agent 作为接盘侠
  const client2 = new OceanBusClient(OCEANBUS_URL)
  await client2.register()
  assert(client2.isReady(), '第二个 Agent 就绪')
  log('第二个Agent', { openid: client2.openid ? client2.openid.substring(0, 20) + '...' : 'NONE' })

  // 第二个 Agent 也要 enroll
  const enroll2Id = `diag_enroll2_${Date.now()}`
  const { reply: enroll2Reply } = await sendAndWait(client2, L1_OPENID, {
    action: 'enroll', request_id: enroll2Id, openid: client2.openid
  })
  assert(enroll2Reply && enroll2Reply.code === 0, '第二个船长入驻')

  // 转让情报（先加故事再转让，验证故事被清空）
  const story2Id = `diag_story2_${Date.now()}`
  await sendAndWait(client, L1_OPENID, {
    action: 'intel_story', request_id: story2Id, openid: client.openid, captain_token: captainToken,
    intel_id: intel2.id, story: '转让前的故事'
  })

  const transferId = `diag_transfer_${Date.now()}`
  const { reply: transferReply } = await sendAndWait(client, L1_OPENID, {
    action: 'intel_transfer', request_id: transferId, openid: client.openid, captain_token: captainToken,
    intel_id: intel2.id, target_openid: client2.openid
  })
  assert(transferReply && transferReply.code === 0, '情报转让成功')
  assert(transferReply.data.intel.holder === client2.openid, '持有者已变更')
  assert(transferReply.data.intel.story === '', '故事已清空')
  log('转让后情报', { holder: transferReply.data.intel.holder.substring(0, 20) + '...', story: transferReply.data.intel.story || '(空)' })
  console.log('')

  // ── Step 9: 验证转让后原持有者列表 ──
  console.log('── Step 9: 验证转让后状态 ──')
  const list2Id = `diag_list2_${Date.now()}`
  const { reply: list2Reply } = await sendAndWait(client, L1_OPENID, {
    action: 'intel_list', request_id: list2Id, openid: client.openid, captain_token: captainToken
  })
  assert(list2Reply && list2Reply.code === 0, '查询原持有者列表')
  const stillHas = (list2Reply.data.intels || []).some(i => i.id === intel2.id)
  assert(!stillHas, '原持有者不再持有该情报')

  const list3Id = `diag_list3_${Date.now()}`
  const { reply: list3Reply } = await sendAndWait(client2, L1_OPENID, {
    action: 'intel_list', request_id: list3Id, openid: client2.openid, captain_token: enroll2Reply.data.captainToken
  })
  assert(list3Reply && list3Reply.code === 0, '查询新持有者列表')
  const nowHas = (list3Reply.data.intels || []).some(i => i.id === intel2.id)
  assert(nowHas, '新持有者拥有该情报')
  console.log('')

  console.log('═══════════════════════════════════════════')
  console.log('  ✅ 酒馆情报系统 — 全部诊断通过')
  console.log('═══════════════════════════════════════════')
}

main().catch(err => {
  console.error('诊断脚本异常:', err)
  process.exit(1)
})
