#!/usr/bin/env node
const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')
const L1 = process.env.L1_OPENID
if (!L1) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

async function test(label, action, params) {
  const client = new OceanBusClient()
  await client.register()
  const rid = `quick_${action}_${Date.now()}`
  await client.sendMessage(L1, JSON.stringify({ action, request_id: rid, ...params }))
  await new Promise(r => setTimeout(r, 10000))
  const reply = await client.pollForReply(rid, 15000, 1000)
  console.log(`${label}: ${reply ? '✅ ' + JSON.stringify(reply).substring(0, 250) : '❌ TIMEOUT'}`)
  return reply
}

async function main() {
  console.log('── 快速验证 get_city + capabilities ──\n')
  await test('get_city 广州', 'get_city', { city_id: 'canton' })
  await test('capabilities', 'capabilities', {})
  console.log('\n── 完成 ──')
}
main().catch(e => console.error(e))
