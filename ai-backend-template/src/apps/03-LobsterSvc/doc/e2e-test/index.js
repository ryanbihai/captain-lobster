/**
 * @file e2e-test/index.js
 * @description 端到端测试入口
 */

const TestOrchestrator = require('./TestOrchestrator')

async function main() {
  console.log('🦞'.repeat(30))
  console.log('')
  console.log('       龙虾船长 Captain Lobster - 端到端测试')
  console.log('')
  console.log('🦞'.repeat(30))

  const orchestrator = new TestOrchestrator({
    l1Url: process.env.L1_URL || 'http://localhost:17019/api'
  })

  await orchestrator.runAll()
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
