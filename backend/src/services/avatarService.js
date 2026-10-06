const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config/config');

class AvatarService {
  constructor() {
    this.maxFileSize = 2 * 1024 * 1024;
    this.allowedContentTypes = ['image/jpeg', 'image/png'];
    this.allowedFormats = ['jpeg', 'png'];
    this.avatarDir = path.join(config.STATIC_DIR, 'public', 'avatars');
  }

  getAvatarUrls(userId, includeVersion = false) {
    const safeUserId = this.sanitizeUserId(userId);

    if (!safeUserId) {
      return null;
    }

    let avatarVersion = 0;
    const existingUrl = fileName => {
      try {
        const stat = fs.statSync(path.join(this.avatarDir, fileName));
        if (!stat.isFile()) return null;
        avatarVersion = Math.max(avatarVersion, stat.mtimeMs, stat.ctimeMs);
        return `/public/avatars/${fileName}`;
      } catch {
        return null;
      }
    };
    const metadata = {
      avatarUrl: existingUrl(`avatar-${safeUserId}.png`),
      thumbnailUrl: existingUrl(`avatar-${safeUserId}-thumb.png`)
    };
    if (includeVersion) metadata.avatarVersion = avatarVersion || null;
    return metadata;
  }

  async saveAvatar(userId, imageBuffer, contentType) {
    const safeUserId = this.sanitizeUserId(userId);

    if (!safeUserId) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_USER_ID',
        message: 'Mã người dùng không hợp lệ.'
      };
    }

    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMPTY_AVATAR',
        message: 'Tệp ảnh đại diện không được để trống.'
      };
    }

    if (imageBuffer.length > this.maxFileSize) {
      return {
        success: false,
        statusCode: 413,
        code: 'AVATAR_TOO_LARGE',
        message: 'Ảnh đại diện vượt quá giới hạn 2MB.'
      };
    }

    const normalizedContentType = String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!this.allowedContentTypes.includes(normalizedContentType)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_AVATAR_TYPE',
        message: 'Ảnh đại diện chỉ chấp nhận định dạng JPG hoặc PNG.'
      };
    }

    let metadata;

    try {
      metadata = await sharp(imageBuffer, { failOn: 'error' }).metadata();
    } catch {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_AVATAR_IMAGE',
        message: 'Tệp tải lên không phải ảnh hợp lệ.'
      };
    }

    if (!this.allowedFormats.includes(metadata.format)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_AVATAR_IMAGE',
        message: 'Nội dung tệp không phải ảnh JPG hoặc PNG hợp lệ.'
      };
    }

    fs.mkdirSync(this.avatarDir, { recursive: true });

    const avatarFileName = `avatar-${safeUserId}.png`;
    const thumbnailFileName = `avatar-${safeUserId}-thumb.png`;

    const avatarPath = path.join(this.avatarDir, avatarFileName);
    const thumbnailPath = path.join(this.avatarDir, thumbnailFileName);

    try {
      const [avatarBuffer, thumbnailBuffer] = await Promise.all([
        sharp(imageBuffer)
          .rotate()
          .resize(512, 512, {
            fit: 'cover',
            position: 'centre'
          })
          .png()
          .toBuffer(),

        sharp(imageBuffer)
          .rotate()
          .resize(96, 96, {
            fit: 'cover',
            position: 'centre'
          })
          .png()
          .toBuffer()
      ]);

      await Promise.all([
        fs.promises.writeFile(avatarPath, avatarBuffer),
        fs.promises.writeFile(thumbnailPath, thumbnailBuffer)
      ]);
    } catch {
      return {
        success: false,
        statusCode: 400,
        code: 'AVATAR_PROCESSING_FAILED',
        message: 'Không thể xử lý ảnh đại diện.'
      };
    }

    return {
      success: true,
      statusCode: 200,
      code: 'AVATAR_UPDATED',
      message: 'Cập nhật ảnh đại diện thành công.',
      data: this.getAvatarUrls(safeUserId)
    };
  }

  sanitizeUserId(userId) {
    if (typeof userId !== 'string') {
      return '';
    }

    return /^[a-zA-Z0-9_-]+$/.test(userId) ? userId : '';
  }
}

module.exports = AvatarService;
