// Build a QA installer with the exact shipped application payload. Only its
// installer identity/executable filename/shortcut names differ, protecting an
// existing HarborGit installation or running portable instance during testing.
import { mkdir, mkdtemp, cp, rename, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const project = fileURLToPath(new URL('..', import.meta.url));
const parent = path.resolve(project, '../../work/installer-verification');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'harborgit-setup-qa-'));
assert.ok(root.startsWith(parent + path.sep));
const payload = path.join(root, 'payload'), artifacts = path.join(root, 'artifacts');
await cp(path.join(project, 'release/win-unpacked'), payload, { recursive: true, errorOnExist: true });
const qaName = 'HarborGit Installer QA', exeName = 'HarborGit-Installer-QA.exe';
await rename(path.join(payload, 'HarborGit.exe'), path.join(payload, exeName));
const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const config = structuredClone(pkg.build);
config.appId = 'dev.harborgit.installer.qa';
// Keep the product branding. NSIS derives its uninstaller name from the unique
// executable filename; installed-app detection must support this pair as well.
// Unique appId, executable filename, shortcuts and registration isolate QA.
config.directories.output = artifacts;
config.win.executableName = 'HarborGit-Installer-QA';
config.nsis.shortcutName = qaName; config.nsis.uninstallDisplayName = qaName;
config.nsis.artifactName = 'HarborGit-Installer-QA-Setup.exe';
const configPath = path.join(root, 'builder-qa.json'); await writeFile(configPath, JSON.stringify(config, null, 2));
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(project, 'node_modules/electron-builder/cli.js'), '--win', 'nsis', '--x64', '--prepackaged', payload, '--config', configPath, '--publish', 'never'], { cwd: project, shell: false, windowsHide: true, stdio: 'inherit' });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`QA packaging failed (${code})`)));
});
const context = { root, project, version: pkg.version, setup: path.join(artifacts, 'HarborGit-Installer-QA-Setup.exe'), installDir: path.join(root, 'installed 中文 path'), exeName, qaName, contextFile: path.join(root, 'context.json') };
await writeFile(context.contextFile, JSON.stringify(context, null, 2));
await writeFile(path.join(project, 'docs/installer-qa-context.json'), JSON.stringify(context, null, 2));
console.log(JSON.stringify(context, null, 2));
