const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function install(root=process.cwd(),invoke=cp.spawnSync) {
  const git=args=>{const r=invoke('git',args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});if(r.status!==0)throw Error('GIT_CHECK_FAILED');return r.stdout.trim();};
  const configured=invoke('git',['config','--get','core.hooksPath'],{cwd:root,encoding:'utf8',windowsHide:true});
  if(configured.status!==1)throw Error('EXISTING_HOOKS_CONFIGURATION_REQUIRES_REVIEW');
  const folder=path.resolve(root,git(['rev-parse','--git-path','hooks'])),names=['pre-commit','pre-push'];
  const files=names.map(name=>({target:path.join(folder,name),content:fs.readFileSync(path.join(root,'.githooks',name))}));
  files.push({target:path.join(folder,'ats-git-safety.js'),content:fs.readFileSync(path.join(root,'scripts/git-safety.js'))});
  for(const file of files)if(fs.existsSync(file.target)&&!fs.readFileSync(file.target).equals(file.content))throw Error('EXISTING_HOOK_REQUIRES_REVIEW');
  for(const file of files)if(!fs.existsSync(file.target))fs.writeFileSync(file.target,file.content,{flag:'wx',mode:0o755});
  console.log('ATS hooks installed without replacing existing hooks or changing Git config.');
}
if(require.main===module)try{if(process.argv.length!==2)throw Error('UNEXPECTED_ARGUMENT');install();}catch(error){console.error('ATS_HOOKS: '+error.message);process.exitCode=1;}
module.exports={install};
