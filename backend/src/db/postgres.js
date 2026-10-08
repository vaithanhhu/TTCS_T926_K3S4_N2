const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');

function postgresSQL(source) {
  const literals = []; let masked = '', i = 0, count = 0;
  while (i < source.length) {
    const start = i, dollar = source.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++]; let closed = false;
      while (i < source.length) { if (source[i++] === quote) { if (source[i] === quote) i++; else { closed = true; break; } } }
      if (!closed) throw new Error('UNTERMINATED_SQL_LITERAL');
    } else if (dollar) {
      const end = source.indexOf(dollar, i + dollar.length); if (end < 0) throw new Error('UNTERMINATED_SQL_LITERAL'); i = end + dollar.length;
    } else if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i); i = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2); if (end < 0) throw new Error('UNTERMINATED_SQL_COMMENT'); i = end + 2;
    } else { masked += source[i++]; continue; }
    const index = literals.push(source.slice(start, i)) - 1; masked += '__ATS_LITERAL_' + index + '__';
  }
  if (/\bPRAGMA\b/i.test(masked)) throw new Error('SQLITE_SCHEMA_QUERY_NOT_SUPPORTED');
  return masked.split(';').filter(part => part.trim()).map(part => {
    const ignore = /\bINSERT OR IGNORE\b/i.test(part);
    part = part.replace(/\bINSERT OR IGNORE\b/gi, 'INSERT').replace(/datetime\(([^)]+)\)/gi, (_, expression) => {
      const literal = expression.match(/^__ATS_LITERAL_(\d+)__$/);
      if (literal && literals[Number(literal[1])] === "'now'") return 'CURRENT_TIMESTAMP';
      if (!literal && /^[\w.]+$/.test(expression)) return expression;
      throw new Error('UNSUPPORTED_SQLITE_DATETIME');
    }).replace(/([\w.]+)\s*=\s*\?\s+COLLATE NOCASE/gi, 'lower($1) = lower(?)')
      .replace(/([\w.]+)\s+COLLATE NOCASE/gi, 'lower($1)')
      .replace(/\b([\w.]*email)\s*=\s*\?/gi, 'lower($1) = lower(?)')
      .replace(/\browid\b/gi, 'sequence_id').replace(/\bLIKE\b/gi, 'ILIKE')
      .replace(/\?/g, () => '$' + (++count));
    if (ignore) part = part.trim() + ' ON CONFLICT DO NOTHING';
    return part.replace(/__ATS_LITERAL_(\d+)__/g, (_, index) => literals[Number(index)]);
  }).join(';\n');
}
function pgTypes() {
  return { getTypeParser(oid, format) {
    if (oid === 1082) return value => value;
    if (oid === 1184) return value => new Date(value).toISOString();
    if (oid === 20 || oid === 1700) return value => { const n = Number(value); return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : value; };
    return types.getTypeParser(oid, format);
  } };
}
/** prepare builds statements without I/O; every PostgreSQL terminal method returns a Promise. */
class PostgresDatabase {
  constructor(config, pool) {
    if (!pool && !config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
    this.provider = 'postgres'; this.auditOrderColumn = 'sequence_id'; this.context = new AsyncLocalStorage();
    this.pool = pool || new Pool({ connectionString: config.DATABASE_URL, types: pgTypes(), options: '-c timezone=UTC', application_name: 'internal-ats',
      ...(config.PG_SSL_MODE === 'disable' ? { ssl: false } : config.PG_SSL_MODE === 'verify' ? { ssl: { rejectUnauthorized: true } } : {}) });
    this.pool.on?.('error', () => console.error('[PostgreSQL] CONNECTION_ERROR'));
  }
  prepare(sql) {
    const text = postgresSQL(sql), query = params => (this.context.getStore()?.client || this.pool).query(text, params);
    return { all: async (...params) => (await query(params)).rows,
      get: async (...params) => (await query(params)).rows[0],
      run: async (...params) => { const r = await query(params); return { changes: r.rowCount, rows: r.rows }; } };
  }
  async exec(sql) {
    const scope = this.context.getStore();
    if (/^\s*BEGIN(?: IMMEDIATE)?\s*;?\s*$/i.test(sql)) { if (!scope) throw new Error('TRANSACTION_CALLBACK_REQUIRED'); return; }
    if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) {
      if (!scope) throw new Error('TRANSACTION_CALLBACK_REQUIRED'); if (/ROLLBACK/i.test(sql)) scope.rollback = true; return;
    }
    await (scope?.client || this.pool).query(postgresSQL(sql));
  }
  async transaction(action) {
    if (this.context.getStore()) return action();
    const client = await this.pool.connect(), scope = { client, rollback: false, afterCommit: [] };
    let result;
    try { await client.query('BEGIN'); result = await this.context.run(scope, action);
      await client.query(scope.rollback ? 'ROLLBACK' : 'COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    if (!scope.rollback) for (const callback of scope.afterCommit) {
      try { await callback(); } catch { console.error('[PostgreSQL] AFTER_COMMIT_ACTION_FAILED'); }
    }
    return result;
  }
  afterCommit(action) { const scope = this.context.getStore(); if (scope) scope.afterCommit.push(action); else return action(); }
  async withConnection(action) { return action(); }
  async close() { await this.pool.end(); }
}
function sqliteBoundary(db) {
  const context = new AsyncLocalStorage(), exec = db.exec.bind(db); let tail = Promise.resolve();
  db.provider = 'sqlite'; db.auditOrderColumn = 'rowid';
  db.withConnection = async action => {
    if (context.getStore()?.request) return action();
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
    try { return await context.run({ request: true }, action); } finally { release(); }
  };
  db.exec = sql => {
    const scope = context.getStore();
    if (scope?.transaction && /^\s*BEGIN(?: IMMEDIATE)?\s*;?\s*$/i.test(sql)) return;
    if (scope?.transaction && /^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) { if (/ROLLBACK/i.test(sql)) scope.rollback = true; return; }
    return exec(sql);
  };
  db.transaction = async action => {
    if (context.getStore()?.transaction) return action();
    return db.withConnection(async () => {
      const scope = { request: true, transaction: true, rollback: false, afterCommit: [] }; exec('BEGIN IMMEDIATE');
      let result;
      try { result = await context.run(scope, action); exec(scope.rollback ? 'ROLLBACK' : 'COMMIT'); }
      catch (error) { try { exec('ROLLBACK'); } catch {} throw error; }
      if (!scope.rollback) for (const callback of scope.afterCommit) {
        try { await callback(); } catch { console.error('[SQLite] AFTER_COMMIT_ACTION_FAILED'); }
      }
      return result;
    });
  };
  db.afterCommit = action => { const scope = context.getStore(); if (scope?.transaction) scope.afterCommit.push(action); else return action(); };
  return db;
}
module.exports = { PostgresDatabase, postgresSQL, sqliteBoundary, pgTypes };
