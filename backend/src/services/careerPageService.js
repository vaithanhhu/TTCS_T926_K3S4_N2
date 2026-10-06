const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const config = require('../config/config');
const { getDatabase } = require('../db/database');

class CareerPageService {
  constructor(db) {
    this.db = db || getDatabase();
    this.maxFileSize = 5 * 1024 * 1024;
    this.allowedContentTypes = ['image/jpeg', 'image/png'];
    this.allowedFormats = ['jpeg', 'png'];
    this.mediaDir = path.join(config.STATIC_DIR, 'public', 'company');
  }

  getSettings() {
    const row = this.db.prepare(`
      SELECT
        introduction,
        logo_url,
        hero_image_url,
        updated_at
      FROM career_page_settings
      WHERE id = 1
    `).get();

    if (!row) {
      return {
        success: true,
        data: {
          introduction: '',
          logoUrl: null,
          heroImageUrl: null,
          updatedAt: null
        }
      };
    }

    return {
      success: true,
      data: {
        introduction: row.introduction || '',
        logoUrl: row.logo_url || null,
        heroImageUrl: row.hero_image_url || null,
        updatedAt: row.updated_at || null
      }
    };
  }

  saveSettings(data = {}) {
    const current = this.getSettings().data;
    if (Object.hasOwn(data, 'introduction') && typeof data.introduction !== 'string') {
      return { success: false, statusCode: 400, code: 'INVALID_CAREER_INTRODUCTION', message: 'Nội dung giới thiệu phải là văn bản.' };
    }
    if (['logoUrl', 'heroImageUrl'].some(key => Object.hasOwn(data, key) && data[key] !== null && typeof data[key] !== 'string')) {
      return { success: false, statusCode: 400, code: 'INVALID_CAREER_MEDIA_URL', message: 'Đường dẫn ảnh giới thiệu không hợp lệ.' };
    }
    const introduction = typeof data.introduction === 'string'
      ? data.introduction.trim()
      : current.introduction;

    const logoUrl = Object.hasOwn(data, 'logoUrl') ? this.normalizeMediaUrl(data.logoUrl) : current.logoUrl;
    const heroImageUrl = Object.hasOwn(data, 'heroImageUrl') ? this.normalizeMediaUrl(data.heroImageUrl) : current.heroImageUrl;
    if ((data.logoUrl && !logoUrl) || (data.heroImageUrl && !heroImageUrl)) {
      return { success: false, statusCode: 400, code: 'INVALID_CAREER_MEDIA_URL', message: 'Đường dẫn ảnh giới thiệu không hợp lệ.' };
    }

    this.db.prepare(`
      INSERT INTO career_page_settings (
        id,
        introduction,
        logo_url,
        hero_image_url,
        updated_at
      )
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        introduction = excluded.introduction,
        logo_url = excluded.logo_url,
        hero_image_url = excluded.hero_image_url,
        updated_at = datetime('now')
    `).run(
      introduction,
      logoUrl,
      heroImageUrl
    );

    return {
      success: true,
      statusCode: 200,
      code: 'CAREER_PAGE_UPDATED',
      message: 'Đã lưu cấu hình trang giới thiệu công ty.',
      data: this.getSettings().data
    };
  }

  async saveMedia(kind, imageBuffer, contentType) {
    if (!['logo', 'hero'].includes(kind)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CAREER_MEDIA_KIND',
        message: 'Loại ảnh trang tuyển dụng không hợp lệ.'
      };
    }

    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMPTY_CAREER_IMAGE',
        message: 'Tệp ảnh không được để trống.'
      };
    }

    if (imageBuffer.length > this.maxFileSize) {
      return {
        success: false,
        statusCode: 413,
        code: 'CAREER_IMAGE_TOO_LARGE',
        message: 'Ảnh không được vượt quá 5 MB.'
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
        code: 'INVALID_CAREER_IMAGE_TYPE',
        message: 'Chỉ chấp nhận ảnh JPG hoặc PNG.'
      };
    }

    let metadata;

    try {
      metadata = await sharp(imageBuffer, { failOn: 'error' }).metadata();
    } catch {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CAREER_IMAGE',
        message: 'Tệp tải lên không phải ảnh hợp lệ.'
      };
    }

    if (!this.allowedFormats.includes(metadata.format)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CAREER_IMAGE',
        message: 'Nội dung tệp không phải ảnh JPG hoặc PNG hợp lệ.'
      };
    }

    fs.mkdirSync(this.mediaDir, { recursive: true });

    const fileName = `${kind}-${Date.now()}-${crypto.randomUUID()}.png`;
    const filePath = path.join(this.mediaDir, fileName);

    try {
      let pipeline = sharp(imageBuffer).rotate();

      if (kind === 'logo') {
        pipeline = pipeline.resize(800, 400, {
          fit: 'inside',
          withoutEnlargement: true
        });
      } else {
        pipeline = pipeline.resize(1920, 1080, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      await pipeline.png().toFile(filePath);
    } catch {
      return {
        success: false,
        statusCode: 400,
        code: 'CAREER_IMAGE_PROCESSING_FAILED',
        message: 'Không thể xử lý ảnh trang tuyển dụng.'
      };
    }

    return {
      success: true,
      statusCode: 200,
      code: 'CAREER_IMAGE_UPLOADED',
      message: 'Tải ảnh thành công.',
      data: {
        kind,
        url: `/public/company/${fileName}`
      }
    };
  }

  normalizeMediaUrl(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const url = String(value).trim();

    if (!/^\/public\/company\/[a-zA-Z0-9_-]+\.png$/.test(url)) {
      return null;
    }

    return url;
  }
}

module.exports = CareerPageService;
