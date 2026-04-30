const request = require('superagent');
const assert = require('assert');

const BASE_URL = 'https://ai-t.ihaola.com.cn/api/l0';

async function runTests() {
  console.log('开始执行 OceanBus 自动化测试...');
  
  try {
    let apiKey = '';
    let agentCode = '';
    let targetOpenId = '';
    let keyIdToRevoke = '';

    // 封装一个带有通用配置的请求构造器
    const buildReq = (method, path) => {
      // 使用 .ok(() => true) 避免 HTTP 状态码不是 2xx 时抛出异常，方便统一断言
      let req = request[method](BASE_URL + path).timeout(10000).ok(() => true);
      if (apiKey) {
        req = req.set('Authorization', `Bearer ${apiKey}`);
      }
      return req;
    };

    // 1. 注册 Agent (POST /agents/register)
    console.log('\n[1] 测试注册 Agent...');
    const registerRes = await buildReq('post', '/agents/register');
    assert.strictEqual(registerRes.body.code, 0, '注册 Agent 失败');
    
    agentCode = registerRes.body.data.agent_code;
    apiKey = registerRes.body.data.api_key;
    assert.ok(agentCode, '应返回 agent_code');
    assert.ok(apiKey, '应返回 api_key');
    console.log('✅ 注册成功, Agent Code:', agentCode);

    // 2. 申请新 API Key (POST /agents/me/keys)
    console.log('\n[2] 测试申请新 API Key...');
    const applyKeyRes = await buildReq('post', '/agents/me/keys');
    assert.strictEqual(applyKeyRes.body.code, 0, '申请新 Key 失败');
    keyIdToRevoke = applyKeyRes.body.data.key_id;
    assert.ok(keyIdToRevoke, '应返回新 key_id');
    console.log('✅ 申请成功, New Key ID:', keyIdToRevoke);

    // 3. 吊销 API Key (DELETE /agents/me/keys/:key_id)
    console.log('\n[3] 测试吊销 API Key...');
    const revokeKeyRes = await buildReq('delete', `/agents/me/keys/${keyIdToRevoke}`);
    assert.strictEqual(revokeKeyRes.body.code, 0, '吊销 Key 失败');
    console.log('✅ 吊销成功');

    // 4. 精确寻址 Lookup (GET /agents/lookup)
    console.log('\n[4] 测试精确寻址...');
    const lookupRes = await buildReq('get', '/agents/lookup').query({ agent_code: agentCode });
    assert.strictEqual(lookupRes.body.code, 0, '精确寻址失败');
    targetOpenId = lookupRes.body.data.to_openid;
    assert.ok(targetOpenId, '应返回 to_openid');
    console.log('✅ 寻址成功, Target OpenID:', targetOpenId);

    // 5. 投递消息 (POST /messages)
    console.log('\n[5] 测试投递消息...');
    const clientMsgId = `msg_${Date.now()}`;
    const sendMsgRes = await buildReq('post', '/messages').send({
      to_openid: targetOpenId,
      client_msg_id: clientMsgId,
      content: 'Hello from automated test!'
    });
    assert.strictEqual(sendMsgRes.body.code, 0, '消息投递失败');
    console.log('✅ 投递成功');

    // 6. 同步信箱 (GET /messages/sync)
    console.log('\n[6] 测试同步信箱...');
    const syncRes = await buildReq('get', '/messages/sync').query({ since_seq: 0 });
    assert.strictEqual(syncRes.body.code, 0, '同步信箱失败');
    assert.ok(Array.isArray(syncRes.body.data.messages), '应该返回消息数组');
    console.log('✅ 同步信箱成功, 收到消息数量:', syncRes.body.data.messages.length);

    // 7. 屏蔽目标 (POST /messages/block)
    console.log('\n[7] 测试屏蔽目标...');
    const blockRes = await buildReq('post', '/messages/block').send({ from_openid: targetOpenId });
    assert.strictEqual(blockRes.body.code, 0, '屏蔽目标失败');
    console.log('✅ 屏蔽成功');

    // 8. 内网反向解析 (GET /internal/reverse-lookup)
    console.log('\n[8] 测试内网反向解析...');
    const reverseRes = await buildReq('get', '/internal/reverse-lookup').query({ openid: targetOpenId });
    assert.strictEqual(reverseRes.body.code, 0, '反向解析失败');
    assert.ok(reverseRes.body.data.real_agent_id, '应该返回 real_agent_id');
    console.log('✅ 反向解析成功, Real Agent ID:', reverseRes.body.data.real_agent_id);

    console.log('\n🎉 所有测试通过！');
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
  }
}

runTests();
