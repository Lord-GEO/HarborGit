from pathlib import Path
import json,zipfile,hashlib,subprocess,shutil,re
OUT=Path(__file__).resolve().parent
EVID=OUT.parent
ROOT=Path(r'D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3')
BACK=ROOT/'plugins/vcs-git/lib/vcs-git.jar'
FRONT=ROOT/'plugins/vcs-git/lib/vcs-git-frontend.jar'
PLATFORM=ROOT/'lib/intellij.platform.vcs.impl.jar'
def sha(b): return hashlib.sha256(b).hexdigest()
assert sha(BACK.read_bytes())=='6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0'
assert sha(FRONT.read_bytes())=='0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17'
CLASSES=[
 'git4idea.stash.GitChangesSaver',
 'git4idea.stash.GitStashChangesSaver',
 'git4idea.stash.GitStashChangesSaver$UnstashConflictResolver',
 'git4idea.stash.GitShelveChangesSaver',
 'git4idea.stash.GitStashUtils',
 'git4idea.util.GitPreservingProcess',
 'git4idea.config.GitSaveChangesPolicy',
 'git4idea.config.GitVcsSettings',
 'git4idea.stash.GitStashOperations',
 'git4idea.stash.GitShelveChangesSaver$1',
 'git4idea.config.GitVcsOptions',
 'git4idea.index.GitStageManagerKt',
 'com.intellij.openapi.vcs.changes.VcsShelveChangesSaver',
]
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'javap').mkdir(exist_ok=True)
previous_file=OUT/'javap-provenance.json'
previous={r['member']:r for r in json.loads(previous_file.read_text(encoding='utf-8'))} if previous_file.exists() else {}
rows=[]
tool=shutil.which('javap'); assert tool
with zipfile.ZipFile(BACK) as b,zipfile.ZipFile(FRONT) as f,zipfile.ZipFile(PLATFORM) as platform:
 for clazz in CLASSES:
  member=clazz.replace('.','/')+'.class'
  if member in b.namelist(): z,jar=b,BACK
  elif member in f.namelist(): z,jar=f,FRONT
  elif member in platform.namelist(): z,jar=platform,PLATFORM
  else: raise RuntimeError('Class not in selected installed packages: '+member)
  member_hash=sha(z.read(member))
  prior=previous.get(member)
  if prior and prior['member_sha256']==member_hash and (OUT/prior['output']).exists() and sha((OUT/prior['output']).read_bytes())==prior['output_sha256']:
   rows.append(prior); continue
  cmd=[tool,'-J-Duser.language=en','-J-Duser.country=US','-p','-c','-classpath',str(jar),clazz]
  p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
  dest=OUT/'javap'/(clazz+'.txt');dest.write_bytes(p.stdout)
  rows.append({'output':str(dest.relative_to(OUT)).replace('\\','/'),'output_sha256':sha(p.stdout),'source_jar':str(jar),'member':member,'member_sha256':member_hash,'arguments':cmd[1:],'stderr':p.stderr.decode('utf-8',errors='replace')})
 data=f.read('messages/GitBundle.properties')
 (OUT/'resource-excerpts.json').write_text(json.dumps({'source_jar':str(FRONT),'member':'messages/GitBundle.properties','member_sha256':sha(data),'selected_lines':[{'line':i+1,'text':line} for i,line in enumerate(data.decode('utf-8').splitlines()) if re.search(r'saving|saving.*changes|saved.local|unstash|unstash|restor|shelv|stash|preserving|local.changes',line,re.I)]},ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'javap-provenance.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
(OUT/'source-identities.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in [BACK,FRONT,PLATFORM]],indent=2),encoding='utf-8')
reuse=[]
for folder,index,wanted in [(EVID,'javap-provenance.json',{'git4idea/commands/GitImpl.class','git4idea/commands/GitHandler.class'}),(EVID/'history-2026-10-30','history-javap-provenance.json',{'git4idea/rebase/GitRebaseProcess.class','git4idea/rebase/GitRebaseSpec.class','git4idea/rebase/GitAbortRebaseProcess.class','git4idea/rebase/GitRebaseUtils.class'})]:
 for row in json.loads((folder/index).read_text(encoding='utf-8')):
  if row['member'] in wanted:
   assert sha((folder/row['output']).read_bytes())==row['output_sha256']
   row=dict(row);row['evidence_directory']=str(folder.relative_to(EVID)).replace('\\','/');reuse.append(row)
(OUT/'reused-bytecode.json').write_text(json.dumps(reuse,indent=2),encoding='utf-8')
print(json.dumps({'new_disassemblies':len(rows),'reused_disassemblies':len(reuse),'out':str(OUT)},indent=2))
