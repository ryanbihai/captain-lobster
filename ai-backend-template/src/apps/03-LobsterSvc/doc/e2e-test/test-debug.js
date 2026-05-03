/**
 * @file test-debug.js
 * @description 调试脚本 - 检查玩家数据
 */

const request = require('superagent')

const API = 'http://localhost:17019/api'

async function debug() {
  console.log('调试：查询最近的玩家数据\n')

  // 获取广州的所有玩家
  const res = await request.get(`${API}/lobster/city/canton`).timeout(10000)

  if (res.body.code === 0) {
    console.log('广州玩家:')
    for (const p of res.body.data.players) {
      if (p.openid.includes('test_full')) {
        console.log(`  ${p.openid}:`)
        console.log(`    cargoCapacity: ${JSON.stringify(p.cargoCapacity)}`)
      }
    }
  }

  // 获取威尼斯的所有玩家
  const res2 = await request.get(`${API}/lobster/city/venice`).timeout(10000)

  if (res2.body.code === 0) {
    console.log('\n威尼斯玩家:')
    for (const p of res2.body.data.players) {
      if (p.openid.includes('test_full')) {
        console.log(`  ${p.openid}:`)
        console.log(`    cargoCapacity: ${JSON.stringify(p.cargoCapacity)}`)
      }
    }
  }
}

debug().catch(console.error)
