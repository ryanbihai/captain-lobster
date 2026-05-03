const request = require('superagent')

async function testEnroll() {
  console.log('测试入驻接口...')

  const res = await request
    .post('http://localhost:17019/api/lobster/enroll')
    .send({
      openid: 'test123',
      publicKey: 'test_key',
      initialGold: 10000
    })
    .timeout(10000)

  console.log('状态码:', res.status)
  console.log('响应:', JSON.stringify(res.body, null, 2))
}

testEnroll()
  .then(() => console.log('\n测试成功！'))
  .catch(err => console.error('\n测试失败:', err.message))
