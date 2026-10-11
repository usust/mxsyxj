import { cp, mkdir, rm } from 'node:fs/promises';

await rm('www', { recursive: true, force: true });
await mkdir('www/vendor', { recursive: true });
for (const path of ['index.html', 'css', 'js', 'assets', 'manifest.json']) {
    await cp(path, `www/${path}`, { recursive: true });
}
await cp('node_modules/@capacitor/core/dist/capacitor.js', 'www/vendor/capacitor.js');
console.log('APK web assets built in www/');
