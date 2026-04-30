const request = require('superagent')
const SignatureUtils = require('./SignatureUtils')

async function testPost() {
  console.log('测试 superagent POST...')

  const keyPair = SignatureUtils.generateKeyPair()
  const publicKeyPem = keyPair.publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')

  const openid = `test_${Date.now()}`

  try {
    const res = await request
      .post('http://localhost:17019/api/lobster/enroll')
      .send({
        openid,
        publicKey: publicKeyPem,
        initialGold: 10000
      })
      .timeout(10000)

    console.log('状态码:', res.status)
    console.log('响应:', JSON.stringify(res.body, null, 2))
    console.log('\n测试成功！')
  } catch (err) {
    console.error('测试失败!')
    console.error('Error:', err.message)
    console.error('Status:', err.status)
    console.error('Response:', err.response?.body)
  }
}

testPost()
