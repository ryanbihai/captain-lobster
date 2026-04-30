/**
 * @file example.test.js
 * @description AVA 单元测试样例。展示了如何对工具函数与异步业务逻辑进行自动化校验。
 * 运行指令：npm run test:unit
 */

const test = require('ava')
const util = require('../src/lib/util')

/**
 * 【同步函数测试】
 * 验证 util.createId() 是否能生成符合预期的 32 位唯一字符串
 */
test('util.createId() 应当生成唯一的字符串标识', t => {
  const id1 = util.createId()
  const id2 = util.createId()

  t.truthy(id1, '生成的 ID 不能为空')
  t.is(typeof id1, 'string', 'ID 的数据类型应当是字符串')
  t.is(id1.length, 32, 'ID 长度应当严格为 32 位（无横杠 UUID）')
  t.not(id1, id2, '连续两次生成的 ID 不应当重复（冲突概率极低）')
})

/**
 * 【异步业务 Mock 测试结构示例】
 */
test('异步业务逻辑测试骨架：模拟异步返回结果', async t => {
  /**
   * 提示：在真实测试中，你可以直接 require 业务 Service 或 Model
   * 示例：const userService = require('../src/apps/01-UserSvc/service.js')
   */

  // 模拟一个异步执行的过程
  const mockResult = await Promise.resolve({ code: 0, msg: 'ok' })
  
  // 断言：预期的业务状态码应当为 0
  t.is(mockResult.code, 0, '业务逻辑返回码非 0，测试不通过')
})
