// Rasterize the editable brand SVG with the bundled Chromium renderer.
// Run via `npm run icons`; no graphics packages or system fonts are needed.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
app.setPath('userData', path.resolve(project, '../../work/icon-render-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const output = path.join(project, 'assets');
  const svg = await fs.readFile(path.join(output, 'harborgit.svg'), 'utf8');
  const window = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
    const rendered = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
      await image.decode();
      return ${JSON.stringify(sizes)}.map(size => {
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL('image/png').split(',')[1] };
      });
    })()`);
    const icons = [];
    for (const entry of rendered) {
      const png = Buffer.from(entry.png, 'base64');
      await fs.writeFile(path.join(output, `harborgit-${entry.size}.png`), png);
      if (entry.size <= 256) icons.push({ size: entry.size, png });
    }
    const directory = Buffer.alloc(6 + icons.length * 16);
    directory.writeUInt16LE(1, 2); directory.writeUInt16LE(icons.length, 4);
    let offset = directory.length;
    icons.forEach((entry, index) => {
      const at = 6 + index * 16;
      directory[at] = entry.size === 256 ? 0 : entry.size; directory[at + 1] = directory[at];
      directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
      directory.writeUInt32LE(entry.png.length, at + 8); directory.writeUInt32LE(offset, at + 12); offset += entry.png.length;
    });
    await fs.writeFile(path.join(output, 'harborgit.ico'), Buffer.concat([directory, ...icons.map(v => v.png)]));
    console.log(`Generated ${sizes.length} PNG sizes and a ${icons.length}-size Windows ICO from assets/harborgit.svg`);
  } finally { window.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
