const crypto = require('node:crypto');

/**
 * Hash password using standard Scrypt with cryptographic salt
 * @param {string} password Plaintext password
 * @returns {string} Salted hash format "salt:hash"
 */
function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify password against stored salted hash using constant-time comparison
 * @param {string} password Plaintext password to verify
 * @param {string} storedHash Stored format "salt:hash"
 * @returns {boolean} True if password matches, false otherwise
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, key] = parts;
  try {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(key, 'hex');
    if (derivedKey.length !== keyBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword
};
