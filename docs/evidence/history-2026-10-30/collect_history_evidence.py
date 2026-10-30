from pathlib import Path
import json, hashlib, zipfile, subprocess, shutil, re

HERE=Path(__file__).resolve().parent
PREV=HERE.parent
IDEA=Path(r'D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3')
BACK=IDEA/'plugins/vcs-git/lib/vcs-git.jar'
FRONT=IDEA/'plugins/vcs-git/lib/vcs-git-frontend.jar'
JAVAP=shutil.which('javap')
assert JAVAP, 'Use the installed JDK javap; do not install another engine'
EXPECTED='6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0'
assert hashlib.sha256(BACK.read_bytes()).hexdigest()==EXPECTED, 'IDEA package changed; invalidate old evidence first'

CLASSES=[
 'git4idea.actions.GitAbstractRebaseAction',
 'git4idea.actions.GitRebase',
 'git4idea.actions.GitRebase$1',
 'git4idea.actions.GitRebaseContinue',
 'git4idea.actions.GitRebaseSkip',
 'git4idea.actions.GitRebaseAbort',
 'git4idea.actions.GitRepositoryStateActionGroup$Rebase',
 'git4idea.actions.GitResetHead',
 'git4idea.branch.GitRebaseParams',
 'git4idea.rebase.GitRebaseDialog',
 'git4idea.rebase.GitRebaseUtils',
 'git4idea.rebase.GitRebaseProcess',
 'git4idea.rebase.GitRebaseResumeMode',
 'git4idea.rebase.GitRebaseStatus',
 'git4idea.rebase.GitRebaseStatus$Type',
 'git4idea.rebase.GitAbortRebaseProcess',
 'git4idea.rollback.GitRollbackEnvironment',
 'git4idea.rollback.GitRollbackEnvironment$1',
 'git4idea.index.actions.GitRevertAction',
 'git4idea.index.actions.GitRevertOperation',
 'git4idea.reset.GitResetAction',
 'git4idea.reset.GitResetAction$1',
 'git4idea.reset.GitResetOperation',
 'git4idea.reset.GitNewResetDialog',
 'git4idea.reset.GitResetMode',
 'git4idea.ui.GitResetDialog',
 'git4idea.ui.GitResetDialog$ResetMode',
 'git4idea.revert.GitRevertAction',
 'git4idea.revert.GitRevertAction$actionPerformed$1$3',
 'git4idea.revert.GitRevertProcess',
 'git4idea.applyChanges.GitApplyChangesProcess',
 'git4idea.rebase.GitRebaseProcess$RebaseConflictResolver',
 'git4idea.rebase.GitRebaseSpec',
 'git4idea.rebase.GitRebaseOption',
 'git4idea.reset.GitNewResetDialog$Companion',
 'git4idea.reset.GitOneCommitPerRepoLogAction',
 'git4idea.actions.GitAbortOperationAction',
 'git4idea.actions.GitAbortOperationAction$Revert',
]

def sha(b): return hashlib.sha256(b).hexdigest()
HERE.mkdir(parents=True,exist_ok=True)
(HERE/'javap').mkdir(exist_ok=True)
provenance=[]
prior_file=HERE/'history-javap-provenance.json'
prior={r['member']:r for r in json.loads(prior_file.read_text(encoding='utf-8'))} if prior_file.exists() else {}
with zipfile.ZipFile(BACK) as bz, zipfile.ZipFile(FRONT) as fz:
 for clazz in CLASSES:
  member=clazz.replace('.','/')+'.class'
  if member in bz.namelist(): jar,z=BACK,bz
  elif member in fz.namelist(): jar,z=FRONT,fz
  else: raise RuntimeError('Class name not present in selected package inventory: '+clazz)
  previous=prior.get(member)
  if previous and previous['source_jar']==str(jar) and previous['member_sha256']==sha(z.read(member)):
   dest=HERE/previous['output']
   if dest.exists() and sha(dest.read_bytes())==previous['output_sha256']:
    provenance.append(previous)
    continue
  cmd=[JAVAP,'-J-Duser.language=en','-J-Duser.country=US','-p','-c','-classpath',str(jar),clazz]
  p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  dest=HERE/'javap'/(clazz+'.txt')
  dest.write_bytes(p.stdout)
  provenance.append({'output':str(dest.relative_to(HERE)).replace('\\','/'),'output_sha256':sha(p.stdout),'source_jar':str(jar),'member':member,'member_sha256':sha(z.read(member)),'arguments':cmd[1:],'stderr':p.stderr.decode('utf-8',errors='replace')})
 resources=[]
 for jar,z,member in [(BACK,bz,'META-INF/plugin.xml'),(FRONT,fz,'messages/GitBundle.properties')]:
  data=z.read(member)
  lines=data.decode('utf-8').splitlines()
  selected=[{'line':i+1,'text':line} for i,line in enumerate(lines) if re.search(r'rebase|rollback|revert|reset',line,re.I)]
  resources.append({'source_jar':str(jar),'member':member,'sha256':sha(data),'matches':selected})
 (HERE/'history-resource-excerpts.json').write_text(json.dumps(resources,ensure_ascii=False,indent=2),encoding='utf-8')

(HERE/'history-javap-provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
identities=[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in [BACK,FRONT]]
(HERE/'history-source-identities.json').write_text(json.dumps(identities,indent=2),encoding='utf-8')
old=json.loads((PREV/'javap-provenance.json').read_text(encoding='utf-8'))
reuse=[]
for item in old:
 if item['member'] in {'git4idea/commands/GitImpl.class','git4idea/util/GitFileUtils.class','git4idea/repo/GitRepositoryReader.class','git4idea/GitVcs.class','git4idea/commands/GitHandler.class','git4idea/merge/GitMergeUtil.class'}:
  assert sha((PREV/item['output']).read_bytes())==item['output_sha256']
  reuse.append(item)
(HERE/'history-reused-bytecode.json').write_text(json.dumps(reuse,indent=2),encoding='utf-8')
print(json.dumps({'new_javap_files':len(provenance),'reused_bytecode_files':len(reuse),'resources':len(resources),'evidence_directory':str(HERE)},indent=2))
