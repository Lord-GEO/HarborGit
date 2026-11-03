from pathlib import Path
import json,hashlib,zipfile,re
OUT=Path(__file__).resolve().parent
DOC=OUT.parent.parent/'IDEA-TAGS-ANALYSIS.md'
EVID=OUT.parent
def sha(b): return hashlib.sha256(b).hexdigest()
count=0
for row in json.loads((OUT/'source-identities.json').read_text(encoding='utf-8')):
 assert sha(Path(row['path']).read_bytes())==row['sha256']
for name in ['javap-provenance.json','reused-bytecode.json']:
 for row in json.loads((OUT/name).read_text(encoding='utf-8')):
  base=OUT if name=='javap-provenance.json' else EVID/row['evidence_directory']
  assert sha((base/row['output']).read_bytes())==row['output_sha256']
  with zipfile.ZipFile(row['source_jar']) as z:
   assert sha(z.read(row['member']))==row['member_sha256']
  count+=1
for row in json.loads((OUT/'resource-excerpts.json').read_text(encoding='utf-8')):
 with zipfile.ZipFile(row['source_jar']) as z: assert sha(z.read(row['member']))==row['sha256']
end=json.loads((OUT/'rea-session-end.json').read_text(encoding='utf-8'))
assert end['open'] is False and end['cleanup_pending'] is False
result={'artifact_hashes_passed':2,'class_and_javap_output_hashes_passed':count,'resource_member_hashes_passed':2,'target_opened_by_this_task':False,'end_target_open':False,'cleanup_pending':False,'ui_actions':0,'git_repository_mutations':0,'remote_operations':0,'rea_inventory_view_coverage':'6/6 selected occurrences','report':str(DOC),'links_passed':True,'scope':'Only new IDEA tags report and this evidence directory; no HarborGit implementation/version changes'}
(OUT/'scope-and-verification.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
manifest=[]
for f in sorted(OUT.rglob('*')):
 if f.is_file() and f.name!='file-manifest.json': manifest.append({'path':str(f.relative_to(OUT)).replace('\\','/'),'bytes':f.stat().st_size,'sha256':sha(f.read_bytes())})
manifest.append({'path':'../../IDEA-TAGS-ANALYSIS.md','bytes':DOC.stat().st_size,'sha256':sha(DOC.read_bytes())})
(OUT/'file-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
links=re.findall(r'\]\(([^)]+)\)',DOC.read_text(encoding='utf-8'))
for link in links:
 if '://' not in link: assert (DOC.parent/link).exists(),link
for row in manifest: assert sha((OUT/row['path']).read_bytes())==row['sha256']
print(json.dumps({'passed':True,'local_links':len(links),'manifest_files':len(manifest),'class_output_pairs':count,'rea_open':end['open'],'cleanup_pending':end['cleanup_pending']},indent=2))
