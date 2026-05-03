/**
 * @file logSvc.js
 * @description 企业级增强型日志服务。基于 tracer 封装，支持颜色区分、堆栈追踪、多级别过滤及热更新的 Debug 开关。
 */

const tracer = require('tracer')

// 日志输出格式定义：包含标题、路径、行号、方法名及正文
const log_info = ' {{title}}: {{path}} : {{line}} - {{method}}, {{message}}'
// 简易格式定义：仅包含时间、级别与正文
const info = '{{timestamp}} - {{title}}: {{message}}'
// 枚举所有支持的日志级别方法
const methods = ['INFO', 'ERROR', 'WARN', 'DEBUG', 'EXCEPTION', 'TRACE'].reduce((a, b) => a.concat(b).concat(b.toLowerCase()), [])

const colors = require('colors')

/**
 * Tracer 样式配置
 */
const options = {
  filters: {
    // 为不同级别的日志赋予不同的 ANSI 颜色
    TRACE: colors.magenta,
    DEBUG: colors.green,
    INFO: colors.white,
    WARN: colors.yellow,
    ERROR: [colors.red, colors.bold],
    EXCEPTION: [colors.red, colors.bold],
    trace: colors.magenta,
    debug: colors.blue,
    info: colors.green,
    warn: colors.yellow,
    error: [colors.red, colors.bold],
    exception: [colors.red, colors.bold],
  },
  stackIndex: 1, // 修正堆栈索引，确保通过包装器调用时能打印真实的源文件行号
  format: [
    `${log_info} \n{{stack}}`, // 默认带堆栈的详细格式
    {
      // 特定级别的定制化简化格式
      INFO: `${log_info}`,
      info: `${info}`,
      DEBUG: `${log_info}`,
      WARN: `可能的错误(error): ${log_info}`,
    },
  ],
  dateformat: 'yyyy-mm-dd HH:MM:ss.l',
  methods: methods,
  /**
   * 预处理逻辑：修剪路径，并美化匿名函数在日志中的方法名展示
   */
  preprocess: data => {
    data.path = data.path.replace(`${process.cwd()}/`, '')
    data.method = data.method.replace(/Object\.<anonymous>/, 'file-level').replace(/.*\.<anonymous>|^$/, 'closure')
  },
  /**
   * 传输层：直接输出至标准控制台
   */
  transport: data => {
    // eslint-disable-next-line no-console
    console.log(data.output)
  },
}

// 构造原始 Tracer 实例
const logger = tracer.colorConsole(options)

/**
 * 导出日志构造函数
 * @param {string} filename 当前调用文件的 __filename
 * @returns {Object} 具备热更新过滤能力的日志对象
 */
module.exports = filename => {
  // 提取相对路径作为配置热更新的 Key
  const key = filename.replace(`${process.cwd()}/`, '')
  
  /**
   * 判断当前文件是否允许输出 DEBUG 级别日志
   * 支持针对单个文件路径精确开启：debug: { "src/server.js": true }
   */
  const isDebugEnabled = () => global.realtime_config?.debug?.[key] ?? global.realtime_config?.debug?.default ?? false

  const wrappedLogger = { ...logger }

  // 遍历并包装所有日志方法，注入过滤逻辑
  methods.forEach(method => {
    wrappedLogger[method] = (...args) => {
      // 如果是 DEBUG 级别且开关未打开，则静默跳过不输出
      if ((method === 'DEBUG' || method === 'debug') && !isDebugEnabled()) {
        return
      }
      
      // 执行真实的底层日志输出
      logger[method](...args)
    }
  })

  return wrappedLogger
}
