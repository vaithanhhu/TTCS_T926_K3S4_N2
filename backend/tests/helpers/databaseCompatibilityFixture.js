const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};
async function installFailureTrigger(db,{name,table,event,condition,message='test failure'}){
  assert.ok(['INSERT','UPDATE','DELETE'].includes(event));
  const trigger=identifier(name),relation=identifier(table);
  const literal="'"+message.replace(/'/g,"''")+"'";
  if(db.provider!=='postgres'){
    await db.exec('CREATE TEMP TRIGGER '+trigger+' BEFORE '+event+' ON '+relation+' WHEN '+condition+' BEGIN SELECT RAISE(ABORT, '+literal+'); END');
    return()=>db.exec('DROP TRIGGER '+trigger);
  }
  const functionName=identifier('qa_fixture_'+name+'_'+crypto.randomBytes(4).toString('hex'));
  await db.transaction(async()=>{
    await db.exec('CREATE FUNCTION '+functionName+'() RETURNS trigger LANGUAGE plpgsql AS $qa$ BEGIN IF '+condition+' THEN RAISE EXCEPTION USING MESSAGE = '+literal+", ERRCODE = 'P0001'; END IF; RETURN "+(event==='DELETE'?'OLD':'NEW')+'; END $qa$');
    await db.exec('CREATE TRIGGER '+trigger+' BEFORE '+event+' ON '+relation+' FOR EACH ROW EXECUTE FUNCTION '+functionName+'()');
  });
  return()=>db.transaction(async()=>{await db.exec('DROP TRIGGER '+trigger+' ON '+relation);await db.exec('DROP FUNCTION '+functionName+'()');});
}
async function assertNoOpenTransaction(db){
  if(db.provider!=='postgres'){await db.exec('BEGIN');await db.exec('ROLLBACK');return;}
  assert.equal(db.context.getStore(),undefined,'Transaction context must be released');
  const leaked=await db.prepare("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='internal-ats' AND state IN ('idle in transaction','idle in transaction (aborted)')").get();
  assert.equal(leaked.n,0,'No native connection may retain an open transaction');
  await db.transaction(async()=>{assert.equal((await db.prepare('SELECT 1 AS value').get()).value,1);});
  assert.equal(db.context.getStore(),undefined);
}
async function foreignKeyViolations(db){
  if(db.provider!=='postgres')return db.prepare('PRAGMA foreign_key_check').all();
  assert.equal((await db.prepare("SELECT current_setting('session_replication_role') AS mode").get()).mode,'origin');
  const constraints=await db.prepare(`SELECT c.conname,c.convalidated,c.confmatchtype,s.nspname AS child_schema,t.relname AS child_table,ps.nspname AS parent_schema,pt.relname AS parent_table,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS child_columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace s ON s.oid=t.relnamespace JOIN pg_class pt ON pt.oid=c.confrelid JOIN pg_namespace ps ON ps.oid=pt.relnamespace
    WHERE c.contype='f' AND s.nspname=current_schema() ORDER BY c.conname`).all();
  const violations=[];
  for(const c of constraints){
    if(!c.convalidated)violations.push({constraint:c.conname,unvalidated:true});
    const child=identifier(c.child_schema)+'.'+identifier(c.child_table),parent=identifier(c.parent_schema)+'.'+identifier(c.parent_table);
    const nonnull=c.child_columns.map(column=>'child.'+identifier(column)+' IS NOT NULL').join(' AND '),equal=c.child_columns.map((column,i)=>'parent.'+identifier(c.parent_columns[i])+'=child.'+identifier(column)).join(' AND ');
    const partial=c.confmatchtype==='f'?' OR (('+c.child_columns.map(column=>'child.'+identifier(column)+' IS NULL').join(' OR ')+') AND ('+c.child_columns.map(column=>'child.'+identifier(column)+' IS NOT NULL').join(' OR ')+'))':'';
    const result=await db.prepare('SELECT count(*) AS n FROM '+child+' child WHERE (('+nonnull+') AND NOT EXISTS(SELECT 1 FROM '+parent+' parent WHERE '+equal+'))'+partial).get();
    if(result.n)violations.push({constraint:c.conname,table:c.child_table,rows:result.n});
  }
  return violations;
}
module.exports={installFailureTrigger,assertNoOpenTransaction,foreignKeyViolations};
