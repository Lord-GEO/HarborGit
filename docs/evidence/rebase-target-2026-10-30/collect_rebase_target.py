from pathlib import Path
import json, zipfile, hashlib, re, subprocess, shutil
OUT=Path(__file__).resolve().parent
EVID=OUT.parent
ROOT=Path(r'D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3')
BACK=ROOT/'plugins/vcs-git/lib/vcs-git.jar'
FRONT=ROOT/'plugins/vcs-git/lib/vcs-git-frontend.jar'
def sha(b): return hashlib.sha256(b).hexdigest()
assert sha(BACK.read_bytes())=='6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0'
CLASSES=[
 'git4idea.ui.branch.GitRebaseOntoCommitAction',
 'git4idea.ui.branch.GitLogBranchOperationsActionGroup',
 'git4idea.branch.GitRebaseParams$RebaseUpstream$Companion',
 'git4idea.branch.GitRebaseParams$RebaseUpstream$Commit',
 'git4idea.branch.GitRebaseParams$RebaseUpstream$Reference',
 'git4idea.branch.GitBrancherImpl',
 'git4idea.branch.GitBrancherImpl$10',
 'git4idea.branch.GitBrancherImpl$11',
 'git4idea.actions.branch.GitRebaseBranchAction',
 'git4idea.rebase.GitRebaseDialogKt',
 'git4idea.rebase.GitRebaseOptionKt',
]
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'javap').mkdir(exist_ok=True)
prior_file=OUT/'javap-provenance.json'
prior={r['member']:r for r in json.loads(prior_file.read_text(encoding='utf-8'))} if prior_file.exists() else {}
rows=[]
tool=shutil.which('javap')
assert tool
with zipfile.ZipFile(BACK) as b, zipfile.ZipFile(FRONT) as f:
 for clazz in CLASSES:
  member=clazz.replace('.','/')+'.class'
  if member in b.namelist(): z,jar=b,BACK
  elif member in f.namelist(): z,jar=f,FRONT
  else: raise RuntimeError('Class not in selected installed jars: '+clazz)
  member_hash=sha(z.read(member))
  old=prior.get(member)
  if old and old['member_sha256']==member_hash and (OUT/old['output']).exists() and sha((OUT/old['output']).read_bytes())==old['output_sha256']:
   rows.append(old); continue
  cmd=[tool,'-J-Duser.language=en','-J-Duser.country=US','-p','-c','-classpath',str(jar),clazz]
  p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  dest=OUT/'javap'/(clazz+'.txt')
  dest.write_bytes(p.stdout)
  rows.append({'output':str(dest.relative_to(OUT)).replace('\\','/'),'output_sha256':sha(p.stdout),'source_jar':str(jar),'member':member,'member_sha256':member_hash,'arguments':cmd[1:],'stderr':p.stderr.decode('utf-8',errors='replace')})
 res=[]
 for z,jar,member in [(b,BACK,'META-INF/plugin.xml'),(f,FRONT,'messages/GitBundle.properties')]:
  data=z.read(member)
  res.append({'source_jar':str(jar),'member':member,'sha256':sha(data),'selected_lines':[{'line':i+1,'text':s} for i,s in enumerate(data.decode('utf-8').splitlines()) if re.search(r'Git.BranchOperationGroup|GitLogBranchOperations|branches.rebase|rebase.dialog.(target|new.base|old.base|branch.field|error)|rebase.option.(switch|onto)|checkout.and.rebase',s,re.I)]})
 (OUT/'resource-excerpts.json').write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'javap-provenance.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
(OUT/'source-identities.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in [BACK,FRONT]],indent=2),encoding='utf-8')
reuse=[]
for folder,index,wanted in [(EVID,'javap-provenance.json',{'git4idea/branch/GitBranchWorker.class','git4idea/commands/GitImpl.class'}),(EVID/'history-2026-10-30','history-javap-provenance.json',{'git4idea/branch/GitRebaseParams.class','git4idea/rebase/GitRebaseDialog.class','git4idea/rebase/GitRebaseOption.class','git4idea/rebase/GitRebaseUtils.class','git4idea/rebase/GitRebaseProcess.class'})]:
 for row in json.loads((folder/index).read_text(encoding='utf-8')):
  if row['member'] in wanted:
   assert sha((folder/row['output']).read_bytes())==row['output_sha256']
   row=dict(row)
   row['evidence_directory']=str(folder.relative_to(EVID)).replace('\\','/')
   reuse.append(row)
(OUT/'reused-bytecode.json').write_text(json.dumps(reuse,indent=2),encoding='utf-8')
print(json.dumps({'new_disassemblies':len(rows),'reused_disassemblies':len(reuse),'out':str(OUT)},indent=2))
