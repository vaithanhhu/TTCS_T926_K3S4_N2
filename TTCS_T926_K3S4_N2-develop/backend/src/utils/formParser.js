// Native multipart/form-data & JSON parser for ATS Candidate Portal
// Limits payload to 12MB to strictly accommodate 10MB CV files with base64/multipart overhead.

function parseMultipartOrJson(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;

    req.on('data', chunk => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        const err = new Error('PAYLOAD_TOO_LARGE');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const buffer = Buffer.concat(chunks);

      if (contentType.includes('application/json') || (!contentType && buffer.length && buffer[0] === 0x7b)) {
        try {
          const json = buffer.length ? JSON.parse(buffer.toString('utf8')) : {};
          // Handle embedded base64 CV file if provided
          const fields = { ...json };
          let file = null;
          if (json.cvFile && typeof json.cvFile === 'object') {
            const rawBase64 = json.cvFile.data || json.cvFile.base64 || '';
            const fileBuf = Buffer.from(rawBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            file = {
              filename: json.cvFile.filename || json.cvFile.name || 'cv.pdf',
              mimeType: json.cvFile.mimeType || json.cvFile.type || 'application/pdf',
              buffer: fileBuf
            };
            delete fields.cvFile;
          }
          resolve({ fields, file });
        } catch {
          const err = new Error('INVALID_JSON');
          err.statusCode = 400;
          reject(err);
        }
        return;
      }

      if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!boundaryMatch) {
          const err = new Error('INVALID_MULTIPART_BOUNDARY');
          err.statusCode = 400;
          reject(err);
          return;
        }
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const result = parseMultipartBuffer(buffer, boundary);
        resolve(result);
        return;
      }

      // Default fallback
      resolve({ fields: {}, file: null });
    });

    req.on('error', reject);
  });
}

function parseMultipartBuffer(buffer, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary);
  const endBoundaryBuffer = Buffer.from('--' + boundary + '--');
  const fields = {};
  let file = null;

  let start = 0;
  while (start < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partStart = nextBoundary + boundaryBuffer.length;
    // Check if end boundary
    if (buffer.indexOf(endBoundaryBuffer, nextBoundary) === nextBoundary) {
      break;
    }

    const nextPartBoundary = buffer.indexOf(boundaryBuffer, partStart);
    const partEnd = nextPartBoundary === -1 ? buffer.length : nextPartBoundary - 2; // Trim \r\n before next boundary

    if (partEnd > partStart) {
      const partBuffer = buffer.subarray(partStart, partEnd);
      // Header ends at \r\n\r\n
      const headerEndIndex = partBuffer.indexOf('\r\n\r\n');
      if (headerEndIndex !== -1) {
        const headerText = partBuffer.subarray(0, headerEndIndex).toString('utf8');
        const contentBuffer = partBuffer.subarray(headerEndIndex + 4);

        const nameMatch = headerText.match(/name="([^"]+)"/i);
        const filenameMatch = headerText.match(/filename="([^"]+)"/i);
        const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);

        if (nameMatch) {
          const fieldName = nameMatch[1];
          if (filenameMatch) {
            file = {
              fieldName,
              filename: filenameMatch[1],
              mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
              buffer: contentBuffer
            };
          } else {
            fields[fieldName] = contentBuffer.toString('utf8').trim();
          }
        }
      }
    }

    start = nextPartBoundary === -1 ? buffer.length : nextPartBoundary;
  }

  return { fields, file };
}

module.exports = {
  parseMultipartOrJson
};
