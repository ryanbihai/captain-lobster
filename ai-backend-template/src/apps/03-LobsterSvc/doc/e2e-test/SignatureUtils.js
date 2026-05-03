/**
 * @file SignatureUtils.js
 * @description 签名工具类，用于模拟 Ed25519 签名（使用 RSA 模拟）
 */

const crypto = require('crypto')

class SignatureUtils {
  static generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    return { publicKey, privateKey }
  }

  static sign(data, privateKey) {
    const sign = crypto.createSign('SHA256')
    sign.update(JSON.stringify(data))
    return sign.sign(privateKey, 'base64')
  }

  static verify(data, signature, publicKey) {
    try {
      const verify = crypto.createVerify('SHA256')
      verify.update(JSON.stringify(data))
      return verify.verify(publicKey, signature, 'base64')
    } catch (e) {
      return false
    }
  }

  static createTradePayload(tradeId, buyerOpenid, sellerOpenid, item, amount, totalPrice) {
    return {
      trade_id: tradeId,
      buyer_openid: buyerOpenid,
      seller_openid: sellerOpenid,
      item,
      amount,
      total_price: totalPrice
    }
  }
}

module.exports = SignatureUtils
