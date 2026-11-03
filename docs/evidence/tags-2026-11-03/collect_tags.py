from pathlib import Path
import json,zipfile,hashlib,subprocess,shutil,re
OUT=Path(__file__).resolve().parent
EVID=OUT.parent
ROOT=Path(r'D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3')
BACK=ROOT/'plugins/vcs-git/lib/vcs-git.jar'
FRONT=ROOT/'plugins/vcs-git/lib/vcs-git-frontend.jar'
def sha(b): return hashlib.sha256(b).hexdigest()
assert sha(BACK.read_bytes())=='6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0'
assert sha(FRONT.read_bytes())=='0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17'
CLASSES=[
 'git4idea.actions.GitCreateTagAction',
 'git4idea.actions.GitCreateTagAction$1',
 'git4idea.actions.GitTag',
 'git4idea.actions.GitTag$1',
 'git4idea.ui.GitTagDialog',
 'git4idea.push.GitPushOptionsPanel',
 'git4idea.push.GitPushOptionsPanel$1',
 'git4idea.push.GitPushTagMode',
 'git4idea.push.GitPushTagMode$Companion',
 'git4idea.actions.tag.GitPushTagAction',
 'git4idea.actions.tag.GitPushTagsActionGroup',
 'git4idea.push.GitPushSupport',
 'git4idea.push.GitPusher$Companion',
 'git4idea.actions.tag.GitPushTagAction$actionPerformed$1',
 'git4idea.actions.tag.GitPushTagAction$actionPerformed$1$1',
 'git4idea.push.GitPushSource$Tag',
 'git4idea.actions.tag.GitPushTagAction$Companion',
 'git4idea.push.GitPusher',
 'git4idea.GitTag',
 'git4idea.push.GitSpecialRefRemoteBranch',
 'git4idea.branch.GitBrancherImpl$3',
]
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'javap').mkdir(exist_ok=True)
index=OUT/'javap-provenance.json'
prior={r['member']:r for r in json.loads(index.read_text(encoding='utf-8'))} if index.exists() else {}
rows=[]
tool=shutil.which('javap');assert tool
with zipfile.ZipFile(BACK) as b,zipfile.ZipFile(FRONT) as f:
 for clazz in CLASSES:
  member=clazz.replace('.','/')+'.class'
  if member in b.namelist(): z,jar=b,BACK
  elif member in f.namelist(): z,jar=f,FRONT
  else: raise RuntimeError('Class absent from selected installed packages: '+member)
  member_hash=sha(z.read(member))
  old=prior.get(member)
  if old and old['member_sha256']==member_hash and (OUT/old['output']).exists() and sha((OUT/old['output']).read_bytes())==old['output_sha256']:
   rows.append(old);continue
  cmd=[tool,'-J-Duser.language=en','-J-Duser.country=US','-p','-c','-classpath',str(jar),clazz]
  p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  dest=OUT/'javap'/(clazz+'.txt');dest.write_bytes(p.stdout)
  rows.append({'output':str(dest.relative_to(OUT)).replace('\\','/'),'output_sha256':sha(p.stdout),'source_jar':str(jar),'member':member,'member_sha256':member_hash,'arguments':cmd[1:],'stderr':p.stderr.decode('utf-8',errors='replace')})
 res=[]
 for z,jar,member in [(b,BACK,'META-INF/plugin.xml'),(f,FRONT,'messages/GitBundle.properties')]:
  data=z.read(member)
  res.append({'source_jar':str(jar),'member':member,'sha256':sha(data),'selected_lines':[{'line':i+1,'text':line} for i,line in enumerate(data.decode('utf-8').splitlines()) if re.search(r'CreateNewTag|Git.Tag|Push.Tags|tag\.|push.tags|push.tag|follow.tags|git.new.tag|tags.node|tags',line,re.I)]})
 (OUT/'resource-excerpts.json').write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding='utf-8')
index.write_text(json.dumps(rows,indent=2),encoding='utf-8')
(OUT/'source-identities.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in [BACK,FRONT]],indent=2),encoding='utf-8')
reuse=[]
for folder,indexname,wanted in [(EVID,'javap-provenance.json',{'git4idea/commands/GitImpl.class','git4idea/push/GitPushOperation.class','git4idea/branch/GitBranchWorker.class'}),(EVID/'rebase-wip-2026-10-30','javap-provenance.json',{'git4idea/config/GitVcsOptions.class','git4idea/config/GitVcsSettings.class'}),(EVID/'rebase-target-2026-10-30','javap-provenance.json',{'git4idea/branch/GitBrancherImpl.class'})]:
 for row in json.loads((folder/indexname).read_text(encoding='utf-8')):
  if row['member'] in wanted:
   assert sha((folder/row['output']).read_bytes())==row['output_sha256']
   row=dict(row);row['evidence_directory']=str(folder.relative_to(EVID)).replace('\\','/');reuse.append(row)
(OUT/'reused-bytecode.json').write_text(json.dumps(reuse,indent=2),encoding='utf-8')
verbose=[]
for clazz in ['git4idea.GitTag','git4idea.push.GitPushOperation']:
 member=clazz.replace('.','/')+'.class'
 record=next(r for r in rows+reuse if r['member']==member)
 jar=Path(record['source_jar'])
 cmd=[tool,'-J-Duser.language=en','-J-Duser.country=US','-J-Dfile.encoding=UTF-8','-v','-p','-classpath',str(jar),clazz]
 p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 text=p.stdout.decode('ascii',errors='backslashreplace');lines=text.splitlines()
 start=lines.index('BootstrapMethods:')
 end=next((i for i in range(start+1,len(lines)) if lines[i] and not lines[i].startswith(' ')),len(lines))
 with zipfile.ZipFile(jar) as z: member_hash=sha(z.read(member))
 verbose.append({'class':clazz,'source_jar':str(jar),'member_sha256':member_hash,'arguments':cmd[1:],'stdout_sha256':sha(p.stdout),'stdout_lines':len(lines),'display_encoding':'ASCII with non-ASCII original bytes escaped using backslashreplace','selected_lines':[{'line':i+1,'text':lines[i]} for i in range(start,end)]})
(OUT/'concat-recipes.json').write_text(json.dumps(verbose,indent=2),encoding='utf-8')
print(json.dumps({'new_disassemblies':len(rows),'reused_disassemblies':len(reuse),'out':str(OUT)},indent=2))
