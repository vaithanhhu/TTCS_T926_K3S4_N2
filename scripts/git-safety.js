const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const REPOSITORY = 'vaithanhhu/TTCS_T926_K3S4_N2';
const ZERO = /^0+$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function branchAllowed(branch) {
  return /^(feature|fix|hotfix|chore|docs|test|refactor)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes('..') && !branch.endsWith('/') && !branch.endsWith('.lock') && !branch.includes('//');
}
function approvedRemote(value) {
  if (/^git@github\.com:/.test(value)) return value.slice(15).replace(/\.git$/, '') === REPOSITORY;
  try { const u = new URL(value); return ['https:', 'ssh:'].includes(u.protocol) && u.hostname === 'github.com' && !u.password && (!u.username || u.protocol === 'ssh:' && u.username === 'git') && !u.port && !u.search && !u.hash && u.pathname.replace(/^\//, '').replace(/\.git$/, '') === REPOSITORY; } catch { return false; }
}
function sampleName(name) { return /^\.env(?:\.[\w-]+)?\.(example|sample|template)$/.test(path.posix.basename(name).toLowerCase()); }
function forbiddenPath(name) {
  const n = name.replace(/\\/g, '/').toLowerCase(), base = path.posix.basename(n);
  if (base.startsWith('.env') && !sampleName(n)) return 'ENV_FILE';
  if (/^docs\/evidence\/.*\.zip$/.test(n)) return 'EVIDENCE_ARCHIVE_REQUIRES_REVIEW';
  if (/\.(db|sqlite|sqlite3)(-(wal|shm|journal))?$/.test(n)) return 'DATABASE';
  if (/(^|\/)(?:\.?backup[^/]*|backups|node_modules|postgres_data|test-artifacts|\.local|\.ssh|\.aws)(\/|$)/.test(n) || /\.(bak|backup|dump|sql\.gz|dump\.sql|pfx|p12)$/.test(n)) return 'PRIVATE_OR_RUNTIME';
  if (/^backend\/data\//.test(n) && !['.gitkeep','readme.md'].includes(base)) return 'RUNTIME_DATA';
  if (/^frontend\/public\/(avatars|company)\//.test(n)) return 'RUNTIME_MEDIA';
  if (['.pgpass','.netrc','credentials.json','id_rsa','id_ed25519','id_ecdsa'].includes(base) || /(?:private|[_-]key)\.(pem|key)$/.test(base) || /\.log$/.test(base)) return 'SECRET_OR_LOG';
  return null;
}
function placeholder(value, weak = true) { return !value || /^(?:change[_-]?me|replace[_-]?me|redacted|none|null|your(?:app)?password)$/i.test(value) || /^(?:your|replace|insert|example|dummy)[_-]/i.test(value) || /^(?:<[^>]+>|\$\{[^}]+\})$/.test(value) || weak && /^(?:example|test|fixture|password|pass|x|y|dummy|fake|unused)$/i.test(value); }
function inspectContent(name, input) {
  const issues = [], warnings = [], buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.subarray(0,16).toString('binary') === 'SQLite format 3\0') issues.push('SQLITE_CONTENT');
  let text;
  if(buffer[0]===255&&buffer[1]===254)text=buffer.subarray(2).toString('utf16le');
  else if(buffer[0]===254&&buffer[1]===255){if((buffer.length-2)%2) return {issues:['INVALID_TEXT_ENCODING'],warnings};text=Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');}
  else text=buffer.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(text)) issues.push('PRIVATE_KEY_CONTENT');
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/.test(text)) issues.push('ACCESS_TOKEN_CONTENT');
  for (const m of text.matchAll(/postgres(?:ql)?:\/\/([^\s:'"/]+):([^\s@'"/]+)@([^\s/'"]+)/g)) {
    let secret; try { secret = decodeURIComponent(m[2]); } catch { issues.push('MALFORMED_CONNECTION_SECRET'); continue; }
    let host;try{host=new URL(m[0]).hostname;}catch{issues.push('MALFORMED_CONNECTION_SECRET');continue;}
    const exampleHost=['localhost','127.0.0.1','[::1]','example.com'].includes(host)||/\.(invalid|test|example)$/.test(host);
    if (!placeholder(secret,exampleHost)) issues.push('CONNECTION_SECRET');
  }
  if (/\.sql$/i.test(name) && /^-- PostgreSQL database dump\b/m.test(text)) issues.push('DATABASE_DUMP');
  if (sampleName(name)) for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]*(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY))\s*=\s*(.*?)\s*$/i);
    if (m && !placeholder(m[2].replace(/^(['"])(.*)\1$/, '$2'))) issues.push('SAMPLE_CONTAINS_SECRET');
  }
  if (/\b(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/i.test(text)) warnings.push('REVIEW_LITERAL_CREDENTIAL');
  return { issues: [...new Set(issues)], warnings };
}
function parsePush(input, branch) {
  const rows = input.trim() ? input.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/)) : [];
  for (const row of rows) if (row.length !== 4 || !/^[0-9a-f]{40,64}$/i.test(row[1]) || !/^[0-9a-f]{40,64}$/i.test(row[3])) fail('INVALID_PUSH_INPUT');
  for (const row of rows) if (/^refs\/heads\/(main|develop)$/i.test(row[2])) fail('PROTECTED_DESTINATION');
  if (rows.length !== 1) fail('SINGLE_BRANCH_PUSH_REQUIRED');
  const [localRef, localSha, remoteRef] = rows[0];
  if (!branchAllowed(branch) || !['HEAD','refs/heads/' + branch].includes(localRef) || remoteRef !== 'refs/heads/' + branch || ZERO.test(localSha)) fail('PUSH_BRANCH_MISMATCH');
  return rows[0];
}
function makeGit(root) {
  return (args, options = {}) => {
    const result = cp.spawnSync('git', args, { cwd: root, windowsHide: true, encoding: options.binary ? null : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout:['fetch','push','ls-remote'].includes(args[0])?120000:30000, input: options.input, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
    if (result.error) fail('GIT_UNAVAILABLE');
    if (result.status !== 0 && !options.allowFailure) fail('GIT_COMMAND_FAILED');
    return { status: result.status, stdout: result.stdout || (options.binary ? Buffer.alloc(0) : '') };
  };
}
function context(git, clean = false, allowDetached = false, allowProtected = false) {
  for (const marker of ['MERGE_HEAD','REBASE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer','index.lock']) {
    const location = git(['rev-parse','--git-path',marker]).stdout.trim();
    if (fs.existsSync(path.resolve(git(['rev-parse','--show-toplevel']).stdout.trim(), location))) fail('GIT_OPERATION_IN_PROGRESS');
  }
  if (git(['ls-files','-u','-z']).stdout) fail('UNMERGED_INDEX');
  const branch = git(['symbolic-ref','--quiet','--short','HEAD'], { allowFailure: true }).stdout.trim();
  if (!allowDetached && !branchAllowed(branch) && !(allowProtected && ['main','develop'].includes(branch))) fail('UNSAFE_BRANCH');
  if (clean && git(['status','--porcelain=v1','-z','--untracked-files=all']).stdout) fail('DIRTY_WORKTREE');
  return branch;
}
function remote(git) {
  for (const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']]) {
    const urls = git(args).stdout.trim().split(/\r?\n/);
    if (urls.length !== 1 || !approvedRemote(urls[0])) fail('UNAPPROVED_REMOTE');
  }
}
function remoteBlobVerifier(git, remoteBranch = null) {
  let verified;
  return blob => {
    if (!verified) {
      remote(git);
      const current = git(['symbolic-ref','--quiet','--short','HEAD'],{allowFailure:true}).stdout.trim();
      if (current && remoteBranch && current !== remoteBranch) fail('CI_REMOTE_BRANCH_MISMATCH');
      const branch = current || remoteBranch;
      if (!branchAllowed(branch) && !(remoteBranch && ['main','develop'].includes(branch))) fail('REMOTE_BRANCH_REQUIRED_FOR_LARGE_BLOB');
      const ref = 'refs/heads/'+branch;
      const lookup = () => {
        const found = git(['ls-remote','--exit-code','--heads','origin',ref],{allowFailure:true});
        if (found.status === 2 && !found.stdout.trim()) return null;
        const rows = found.stdout.trim().split(/\r?\n/).map(line=>line.split(/\s+/));
        if (found.status !== 0 || rows.length !== 1 || rows[0].length !== 2 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(rows[0][0]) || rows[0][1] !== ref) fail('REMOTE_UNVERIFIED_FOR_LARGE_BLOB');
        return rows[0][0];
      };
      const tip = lookup();
      verified = new Set();
      if (tip) {
        const type = git(['cat-file','-t',tip],{allowFailure:true});
        if (type.status !== 0 || type.stdout.trim() !== 'commit') fail('REMOTE_COMMIT_UNAVAILABLE');
        const tree = git(['ls-tree','-r','-z',tip],{allowFailure:true});
        if (tree.status !== 0) fail('REMOTE_TREE_UNAVAILABLE');
        for (const row of tree.stdout.split('\0').filter(Boolean)) {
          const entry = row.match(/^\d+ (blob|commit) ((?:[a-f0-9]{40}|[a-f0-9]{64}))\t[\s\S]+$/);
          if (!entry) fail('INVALID_REMOTE_TREE');
          if (entry[1] === 'blob') verified.add(entry[2]);
        }
      }
      if (lookup() !== tip) fail('REMOTE_CHANGED_DURING_VERIFICATION');
    }
    return verified.has(blob);
  };
}
function scan(git, entries, output, cache = new Map(), verifiedBlob = remoteBlobVerifier(git)) {
  let failures = 0;
  for (const entry of entries) {
    const reason = forbiddenPath(entry.name);
    if (reason) { output('BLOCK ' + reason + ' ' + JSON.stringify(entry.name)); failures++; continue; }
    if (entry.mode === '160000') { output('WARN SUBMODULE_REQUIRES_OWN_GUARDS ' + JSON.stringify(entry.name)); continue; }
    if (entry.mode === '120000') { output('BLOCK LINK_REQUIRES_REVIEW ' + JSON.stringify(entry.name)); failures++; continue; }
    if (!cache.has(entry.sha)) {
      const size = Number(git(['cat-file','-s',entry.sha]).stdout);
      if (!Number.isSafeInteger(size) || size < 0 || size > 2 * 1024 * 1024 && !verifiedBlob(entry.sha)) { output('BLOCK LARGE_BLOB_REQUIRES_REVIEW ' + JSON.stringify(entry.name)); failures++; continue; }
      if (size > 2 * 1024 * 1024) output('INFO VERIFIED_REMOTE_LARGE_BLOB '+entry.sha+' '+JSON.stringify(entry.name));
      cache.set(entry.sha, git(['cat-file','blob',entry.sha], { binary: true }).stdout);
    }
    const result = inspectContent(entry.name, cache.get(entry.sha));
    for (const kind of result.issues) { output('BLOCK ' + kind + ' ' + JSON.stringify(entry.name)); failures++; }
    for (const kind of result.warnings) output('WARN ' + kind + ' ' + JSON.stringify(entry.name));
  }
  if (failures) fail('SENSITIVE_FILES_FOUND');
}
function indexEntries(git) {
  return git(['ls-files','--stage','-z']).stdout.split('\0').filter(Boolean).map(row => {
    const m = row.match(/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/);
    if (!m || m[3] !== '0') fail('UNMERGED_INDEX');
    return { mode:m[1], sha:m[2], name:m[4] };
  });
}
function inspectIndex(git, output, remoteBranch = null) { scan(git,indexEntries(git),output,new Map(),remoteBlobVerifier(git,remoteBranch)); }
function inspectStaged(git, output) {
  const names = new Set(git(['diff','--cached','--name-only','--no-renames','--diff-filter=ACMT','-z','--']).stdout.split('\0').filter(Boolean));
  const entries = indexEntries(git).filter(entry => names.has(entry.name));
  if (entries.length !== names.size) fail('STAGED_INDEX_CHANGED');
  scan(git,entries,output);
}
function outgoing(git, local, old, output) {
  if (!ZERO.test(old) && git(['merge-base','--is-ancestor',old,local],{allowFailure:true}).status !== 0) fail('NON_FAST_FORWARD_OR_UNKNOWN_BASE');
  const args = ZERO.test(old) ? ['rev-list',local,'--not','--remotes=origin'] : ['rev-list',old+'..'+local];
  const commits = git(args).stdout.trim().split(/\r?\n/).filter(Boolean), cache = new Map(), verifiedBlob = remoteBlobVerifier(git);
  if (commits.length > 200) fail('OUTGOING_HISTORY_REQUIRES_REVIEW');
  for (const commit of commits) {
    const entries = git(['ls-tree','-r','-z',commit]).stdout.split('\0').filter(Boolean).map(row => {
      const m = row.match(/^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/); if (!m) fail('INVALID_TREE');
      return {mode:m[1],sha:m[2],name:m[3]};
    });
    scan(git,entries,output,cache,verifiedBlob);
  }
}
function execute(command, args, git, input = '', output = console.log) {
  if (command === 'pre-push') {
    if (args.length !== 2 || args[0] !== 'origin' || !approvedRemote(args[1])) fail('UNAPPROVED_REMOTE');
    const branch = context(git), row = parsePush(input,branch); remote(git); inspectIndex(git,output);
    if (git(['rev-parse','HEAD']).stdout.trim() !== row[1]) fail('LOCAL_HEAD_CHANGED');
    outgoing(git,row[1],row[3],output); return;
  }
  if (command === 'pre-commit' || command === 'ci') {
    let remoteBranch = null;
    if (args.length) {
      if (command !== 'ci' || args.length !== 2 || args[0] !== '--remote-branch' || !branchAllowed(args[1]) && !['main','develop'].includes(args[1])) fail('UNEXPECTED_ARGUMENT');
      remoteBranch = args[1];
    }
    context(git,false,command === 'ci');git(['diff','--cached','--check']);
    if (command === 'pre-commit') inspectStaged(git,output); else inspectIndex(git,output,remoteBranch);
    return;
  }
  if (!['start','sync','check','push'].includes(command)) fail('UNKNOWN_COMMAND');
  if (command === 'start' ? args.length !== 1 || !branchAllowed(args[0]) : args.length !== 0) fail('INVALID_SPRINT_ARGUMENT');
  const branch = context(git,command !== 'check',false,command==='start'); inspectIndex(git,output);
  if (command === 'check') {
    git(['diff','--check']);git(['diff','--cached','--check']);
    const root = git(['rev-parse','--show-toplevel']).stdout.trim();
    for (const name of git(['ls-files','--others','--exclude-standard','-z']).stdout.split('\0').filter(Boolean)) {
      const reason=forbiddenPath(name); if(reason)fail('UNTRACKED_SENSITIVE_FILE');
      const target=path.join(root,name),stat=fs.lstatSync(target);
      if(stat.isSymbolicLink()||stat.size>2*1024*1024)fail('UNTRACKED_FILE_REQUIRES_REVIEW');
      const result=inspectContent(name,fs.readFileSync(target));
      if(result.issues.length)fail('UNTRACKED_SECRET_REQUIRES_REVIEW');
      for(const kind of result.warnings)output('WARN '+kind+' '+JSON.stringify(name));
    }
    output('GIT_SAFETY_OK');return;
  }
  remote(git);
  if (command === 'start' || command === 'sync') {
    if(command==='start')git(['check-ref-format','--branch',args[0]]);
    git(['fetch','--no-tags','origin','refs/heads/develop']);
    context(git,true,false,command==='start');
    if(command === 'start') {git(['check-ref-format','--branch',args[0]]);git(['switch','--no-track','-c',args[0],'FETCH_HEAD']);output('Branch created from verified develop.');}
    else if(git(['merge-base','--is-ancestor','FETCH_HEAD','HEAD'],{allowFailure:true}).status!==0)fail('DEVELOP_INTEGRATION_REQUIRED_NO_AUTO_MERGE');
    else output('develop is already an ancestor; no merge/stash/rebase performed.');
    return;
  }
  const destination='refs/heads/'+branch;
  const found=git(['ls-remote','--exit-code','--heads','origin',destination],{allowFailure:true});
  if(![0,2].includes(found.status))fail('REMOTE_UNAVAILABLE');
  const old=found.status===2?'0'.repeat(40):found.stdout.trim().split(/\s+/)[0];
  if(!/^[a-f0-9]{40,64}$/.test(old))fail('INVALID_REMOTE_HEAD');
  outgoing(git,git(['rev-parse','HEAD']).stdout.trim(),old,output);context(git,true);
  git(['push','--porcelain','--no-follow-tags','--recurse-submodules=no','--','origin','HEAD:'+destination]);
  output('Create Pull Request into develop: https://github.com/'+REPOSITORY+'/compare/develop...'+encodeURIComponent(branch)+'?expand=1');
}
function main(argv = process.argv.slice(2)) {
  const git=makeGit(process.cwd());
  try {execute(argv[0],argv.slice(1),git,argv[0]==='pre-push'?fs.readFileSync(0,'utf8'):'');}
  catch(error) {console.error('ATS_GIT_SAFETY: '+(error.code||'CHECK_FAILED'));process.exitCode=1;}
}
if(require.main===module)main();
module.exports={branchAllowed,approvedRemote,forbiddenPath,inspectContent,parsePush,execute,makeGit};
