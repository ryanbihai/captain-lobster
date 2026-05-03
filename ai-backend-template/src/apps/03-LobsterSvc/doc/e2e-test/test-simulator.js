const PlayerSimulator = require('./PlayerSimulator')

async function testSimulator() {
  console.log('测试 PlayerSimulator...')

  const player = new PlayerSimulator('TestPlayer', {
    l1Url: 'http://localhost:17019/api',
    startCity: 'canton',
    initialGold: 10000
  })

  console.log('PlayerSimulator 配置:')
  console.log('  l1Url:', player.l1Url)

  try {
    console.log('\n调用 enroll...')
    const result = await player.enroll()
    console.log('入驻成功:', result)
  } catch (err) {
    console.error('入驻失败:', err.message)
    console.error('错误详情:', err)
  }
}

testSimulator()
