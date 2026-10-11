const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');

let browser, server, origin;
before(async () => {
    server = createServer(async (req, res) => {
        try {
            const path = resolve('www', '.' + (req.url === '/' ? '/index.html' : req.url));
            if (!path.startsWith(resolve('www') + '/')) throw new Error('invalid path');
            const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
            res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
            res.end(await readFile(path));
        } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
    });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function openApp({ legacyViewport = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    if (legacyViewport) await page.route('**/css/style.css', async route => {
        const css = (await readFile('www/css/style.css', 'utf8')).replace(/[-a-z]+\s*:[^;{}]*dvh[^;{}]*;/g, '');
        await route.fulfill({ contentType: 'text/css', body: css });
    });
    await page.goto(origin);
    await page.waitForFunction(() => app.camera.isReady());
    return { context, page, errors };
}

test('offline app starts, captures a watermark photo and queries its persisted record', async () => {
    const { context, page, errors } = await openApp();
    assert.equal(await page.locator('#login-modal, #vip-modal, #team-modal, #menu-team').count(), 0);
    await page.click('#btn-capture');
    await page.waitForSelector('#preview-modal:not(.hidden)');
    const code = await page.evaluate(() => app.currentPhotoMeta.antiFakeCode);
    assert.match(code, /^[A-Z0-9]{13}$/);
    const download = page.waitForEvent('download');
    await page.click('#btn-save');
    await download;
    await page.waitForFunction(() => app.photos.length === 1);
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 1);
    await page.click('#btn-verify');
    await page.fill('#verify-code-input', code);
    await page.click('#btn-verify-code');
    assert.match(await page.locator('#verify-result').innerText(), /找到照片记录/);
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'artifacts/record-query.png' });
    await page.fill('#verify-code-input', '<script>XXXXX');
    await page.click('#btn-verify-code');
    assert.match(await page.locator('#verify-result').innerText(), /格式错误/);
    assert.equal(await page.locator('#verify-photo-thumb').isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
});

test('default badge and upgraded settings show the requested label without overwriting custom labels', async () => {
    const { context, page, errors } = await openApp();
    assert.equal(await page.locator('#brand-overlay .brand-verify-badge').innerText(), '真实可验');
    assert.equal(await page.locator('#btn-verify').innerText(), '真实可验');
    await page.evaluate(() => {
        app.cameraWatermark.updateConfigs({ brandBadge: '本机记录', brandName: '施工记录', showCoordinates: false, weatherMode: 'manual' });
        app.saveSettings();
    });
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    assert.equal(await page.locator('#brand-overlay .brand-verify-badge').innerText(), '真实可验');
    assert.equal(await page.locator('#brand-overlay .brand-name').innerText(), '施工记录');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('moxi_settings')).brandBadge), '真实可验');
    assert.equal(await page.evaluate(() => app.watermark.config.showCoordinates), false);
    await page.evaluate(() => app.toggleSettingsPanel(true));
    await page.fill('#brand-badge', '现场记录');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('moxi_settings')).brandBadge === '现场记录');
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    assert.equal(await page.locator('#brand-overlay .brand-verify-badge').innerText(), '现场记录');
    assert.deepEqual(errors, []);
    await context.close();
});

test('rotating the camera keeps controls usable and saves a landscape photo that remains editable', async () => {
    const { context, page, errors } = await openApp();
    await page.evaluate(() => {
        app.watermark.updateConfigs({ useCustomLocation: true, useCustomTime: true, weatherMode: 'manual' });
        app.watermark.setCustomTime('2026-10-11', '08:45');
        app.watermark.setCustomLocation('', '南京市浦口区', '兰新路-道路停车位', '32.189802,118.714729');
        app.watermark.setWeather(true, '多云', '26°C');
        DevicePlatform.saveImage = async () => {};
        app.updateWatermarkPreview();
    });
    for (const viewport of [{ width: 915, height: 412 }, { width: 812, height: 375 }]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(() => {
            const coords = document.querySelector('#watermark-overlay .wm-coordinates');
            return coords && !coords.innerText.includes('\n') && document.querySelector('#watermark-overlay').getBoundingClientRect().bottom < innerHeight;
        });
        const boxes = await page.evaluate(() => Object.fromEntries(['.camera-container', '#btn-capture', '#brand-overlay', '#watermark-overlay', '.wm-coordinates'].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().toJSON()])));
        assert.ok(boxes['.camera-container'].height >= viewport.height - 1, 'landscape camera must use the available height');
        assert.ok(boxes['#btn-capture'].left >= boxes['.camera-container'].right, 'capture button moves beside the preview');
        for (const box of Object.values(boxes)) {
            assert.ok(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height, JSON.stringify(box));
        }
        assert.ok(boxes['.wm-coordinates'].right < boxes['#brand-overlay'].left);
    }
    await page.screenshot({ path: 'artifacts/landscape-camera-195.png' });
    await page.click('#btn-capture');
    await page.waitForSelector('#preview-modal:not(.hidden)');
    const dimensions = await page.evaluate(async () => {
        const image = new Image(); image.src = app.currentPhoto; await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.ok(dimensions.width > dimensions.height, 'landscape frame must export wider than it is tall');
    assert.equal(await page.locator('#preview-antifake-info').innerText().then(text => text.includes('真实可验')), true);
    await page.screenshot({ path: 'artifacts/landscape-preview-195.png' });
    await page.click('#btn-save');
    await page.waitForFunction(() => app.photos.length === 1);
    await page.setViewportSize({ width: 412, height: 915 });
    assert.equal(await page.locator('#watermark-overlay .wm-time').innerText(), '08:45');
    await page.click('#btn-gallery');
    await page.click('.gallery-item');
    await page.click('#btn-edit-watermark');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    await page.click('#btn-photo-edit-settings');
    await page.setViewportSize({ width: 915, height: 412 });
    const editor = await page.locator('.photo-editor-image-area').boundingBox();
    const settings = await page.locator('#settings-panel').boundingBox();
    assert.ok(editor.width > 400 && editor.height > 200, 'landscape editor must leave a usable image area beside settings');
    assert.ok(editor.x + editor.width <= settings.x + 1, 'editing controls must not cover the photo');
    await page.click('#btn-close-settings');
    await page.click('#btn-cancel-photo-edit');
    assert.deepEqual(errors, []);
    await context.close();
});

test('failed native export leaves preview open and creates no success record', async () => {
    const { context, page, errors } = await openApp();
    await page.click('#btn-capture');
    await page.waitForSelector('#preview-modal:not(.hidden)');
    await page.evaluate(() => { DevicePlatform.saveImage = async () => { throw new Error('storage full'); }; });
    await page.click('#btn-save');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('保存失败'));
    assert.equal(await page.evaluate(() => app.photos.length), 0);
    assert.equal(await page.locator('#preview-modal').evaluate(el => el.classList.contains('hidden')), false);
    assert.equal(await page.locator('#btn-save').isEnabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
});

test('legacy local photos migrate and local deletion keeps exported photos independent', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => localStorage.setItem('moxi_photos', JSON.stringify([
        { id: 123, dataUrl: 'data:image/jpeg;base64,/9j/2Q==', antiFakeCode: 'ABCD1234EFGH5' }
    ])));
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('moxi_photos')), null);
    await page.evaluate(() => app.deletePhoto(123));
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    assert.equal(await page.evaluate(() => app.photos.length), 0);
    await context.close();
});

test('manual coordinates and custom time are saved before the app is closed', async () => {
    const { context, page, errors } = await openApp();
    await page.evaluate(() => app.toggleSettingsPanel(true));
    await page.click('#toggle-custom-time + .slider');
    await page.fill('#custom-date', '2025-05-06');
    await page.fill('#custom-time', '08:45');
    await page.click('#toggle-custom-location + .slider');
    await page.fill('#custom-coords', '1.3521,103.8198');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('moxi_settings')).customLocation.coords === '1.3521,103.8198');
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    await page.evaluate(() => app.toggleSettingsPanel(true));
    assert.equal(await page.locator('#custom-time').inputValue(), '08:45');
    assert.equal(await page.locator('#custom-date').inputValue(), '2025-05-06');
    assert.equal(await page.locator('#custom-coords').inputValue(), '1.3521,103.8198');
    assert.equal(await page.evaluate(() => app.watermark.getLocation().full), '坐标 1.3521,103.8198');
    assert.deepEqual(errors, []);
    await context.close();
});

test('detailed geocoder addresses reach all watermark previews, saved records and restored settings', async () => {
    const { context, page, errors } = await openApp();
    const fixture = {
        addresstype: 'office', name: '某某商务中心',
        address: { state: '江苏省', city: '苏州市', county: '吴中区', suburb: '长桥街道', road: '东吴北路', house_number: '168', office: '某某商务中心', country: '中国', country_code: 'cn' },
        display_name: '某某商务中心, 168, 东吴北路, 长桥街道, 吴中区, 苏州市, 江苏省, 中国'
    };
    await page.route('https://nominatim.openstreetmap.org/**', route => {
        const url = new URL(route.request().url());
        assert.equal(url.searchParams.get('zoom'), '18');
        assert.equal(url.searchParams.get('namedetails'), '1');
        return route.fulfill({ json: fixture });
    });
    await page.evaluate(() => {
        app.watermark.setWeatherMode('manual');
        DevicePlatform.getCurrentPosition = (success, failure, options) => {
            window.testLocationOptions = options;
            success({ coords: { latitude: 31.298912, longitude: 120.585399, accuracy: 8 } });
        };
        app.toggleSettingsPanel(true);
    });
    await page.click('#toggle-custom-location + .slider');
    await page.click('#btn-get-location');
    await page.waitForFunction(() => document.getElementById('custom-address').value.includes('东吴北路168号'));
    assert.equal(await page.locator('#custom-address').inputValue(), '吴中区长桥街道东吴北路168号某某商务中心');
    assert.match(await page.locator('#location-status').innerText(), /定位精度约8米/);
    assert.equal(await page.evaluate(() => window.testLocationOptions.enableHighAccuracy), true);
    const full = '江苏省苏州市吴中区长桥街道东吴北路168号某某商务中心2栋301室';
    await page.fill('#custom-address', '吴中区长桥街道东吴北路168号某某商务中心2栋301室');
    for (const template of ['default', 'simple', 'modern', 'professional']) {
        await page.click(`.template-item[data-template="${template}"]`);
        const previewAddress = await page.locator('#watermark-overlay .wm-location').innerText();
        assert.equal(previewAddress.replace(/\n/g, '').replace(' · ', ''), full);
        assert.equal(await page.locator('#watermark-overlay .wm-location').isVisible(), true);
        assert.ok(await page.locator('#watermark-overlay .wm-location').evaluate(element => element.getBoundingClientRect().right < innerWidth - 10), 'long addresses stay inside the preview');
    }
    await page.click('.template-item[data-template="default"]');
    await page.click('#btn-close-settings');
    await page.click('#btn-capture');
    assert.equal(await page.evaluate(() => app.currentPhotoMeta.location), full);
    await page.evaluate(() => { DevicePlatform.saveImage = async () => {}; });
    await page.click('#btn-save');
    await page.waitForFunction(() => app.photos.length === 1);
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 1);
    assert.equal(await page.evaluate(() => app.photos[0].location), full);
    assert.equal(await page.evaluate(() => app.watermark.getLocation().full), full);
    await page.evaluate(() => app.toggleSettingsPanel(true));
    assert.match(await page.locator('#custom-address').inputValue(), /2栋301室$/);
    await page.waitForTimeout(350);
    await page.locator('#custom-address').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/detailed-address-settings.png' });
    await page.evaluate(() => app._applyLocationResult('31.3', '120.6', { province: '江苏省', city: '苏州市', address: '', source: 'ip' }));
    assert.match(await page.locator('#location-status').innerText(), /大致城市/);
    assert.equal(await page.locator('#custom-address').inputValue(), '');
    assert.deepEqual(errors, []);
    await context.close();
});

test('personal profile is shown, editable, and survives restart with the same user ID', async () => {
    const { context, page, errors } = await openApp();
    const id = await page.evaluate(() => app.profile.id);
    assert.match(id, /^MX\d{6}$/);
    await page.click('.quick-left');
    await page.fill('#profile-nickname', '工地记录员');
    await page.click('.profile-save');
    assert.equal(await page.locator('.quick-left').innerText(), '工地记录员 >');
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    await page.click('#btn-menu');
    assert.equal(await page.locator('.side-menu-name').innerText(), '工地记录员');
    assert.equal(await page.locator('.side-menu-description').innerText(), `用户编号：${id}`);
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'artifacts/profile-menu.png' });
    await page.click('.side-menu-header');
    assert.equal(await page.locator('#profile-nickname').inputValue(), '工地记录员');
    assert.equal(await page.locator('#profile-user-id').innerText(), id);
    assert.deepEqual(errors, []);
    await context.close();
});

test('captured photos keep originals and can replace watermarks without accumulating old text', async () => {
    const { context, page, errors } = await openApp();
    await page.click('#btn-capture');
    const download = page.waitForEvent('download');
    await page.click('#btn-save');
    await download;
    await page.waitForFunction(() => app.photos.length === 1);
    const source = await page.evaluate(() => ({ ...app.photos[0] }));
    assert.ok(source.originalDataUrl.startsWith('data:image/jpeg'));
    assert.notEqual(source.originalDataUrl, source.dataUrl);
    const imageDifference = await page.evaluate(async source => {
        const pixels = async dataUrl => {
            const image = new Image(); image.src = dataUrl; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            return ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 3), 1, 1).data;
        };
        const original = await pixels(source.originalDataUrl), saved = await pixels(source.dataUrl);
        return Math.max(...[0,1,2].map(channel => Math.abs(original[channel] - saved[channel])));
    }, source);
    assert.ok(imageDifference < 10, 'saving the original must not clear the photo outside the watermark');
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 1);
    const cameraSettings = await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig()));
    await page.click('.mode-tab[data-mode="edit"]');
    await page.click('#btn-select-local-photo');
    await page.click('.gallery-item');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    await page.click('#btn-photo-edit-settings');
    await page.selectOption('#watermark-position', 'top-right');
    await page.selectOption('#watermark-font-size', 'large');
    await page.click('#toggle-custom-text + .slider');
    await page.fill('#custom-text', '第一次编辑');
    await page.fill('#brand-name', '项目记录');
    await page.fill('#brand-subtitle', '现场');
    const firstRender = await page.evaluate(() => app.photoEditSession.dataUrl);
    await page.fill('#custom-text', '再次编辑');
    await page.fill('#custom-text', '第一次编辑');
    const repeatedRender = await page.evaluate(() => app.photoEditSession.dataUrl);
    if (repeatedRender !== firstRender) {
        await writeFile('artifacts/editor-first.jpg', Buffer.from(firstRender.split(',')[1], 'base64'));
        await writeFile('artifacts/editor-repeated.jpg', Buffer.from(repeatedRender.split(',')[1], 'base64'));
    }
    assert.ok(repeatedRender === firstRender, 'render must always start from the same original');
    await page.click('#btn-close-settings');
    await page.screenshot({ path: 'artifacts/watermark-editor.png' });
    const editedDownload = page.waitForEvent('download');
    await page.click('#btn-save-photo-edit');
    await editedDownload;
    await page.waitForFunction(() => app.photos.length === 2 && !app.photoEditSession);
    const saved = await page.evaluate(() => app.photos[0]);
    assert.equal(saved.originalDataUrl, source.originalDataUrl);
    assert.equal(saved.watermarkConfig.customText, '第一次编辑');
    assert.equal(saved.watermarkConfig.brandName, '项目记录');
    assert.equal(saved.watermarkConfig.position, 'top-right');
    assert.notEqual(saved.dataUrl, source.dataUrl);
    assert.notEqual(saved.antiFakeCode, source.antiFakeCode);
    assert.equal(await page.evaluate(() => app.photos[1].dataUrl), source.dataUrl, 'source photo is unchanged');
    assert.equal(await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig())), cameraSettings);
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 2);
    await page.click('#btn-gallery');
    await page.click('.gallery-item:first-child');
    await page.click('#btn-edit-watermark');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    await page.click('#btn-photo-edit-settings');
    assert.equal(await page.locator('#custom-text').inputValue(), '第一次编辑');
    assert.equal(await page.locator('#brand-name').inputValue(), '项目记录');
    assert.equal(await page.evaluate(() => app.photoEditSession.originalDataUrl), source.originalDataUrl);
    await page.click('#btn-close-settings');
    await page.click('#btn-cancel-photo-edit');
    assert.equal(await page.evaluate(() => app.photos.length), 2);
    assert.deepEqual(errors, []);
    await context.close();
});

test('tapping photo watermark text loads that photo values and replaces them on the original in either orientation', async () => {
    const { context, page, errors } = await openApp();
    await page.evaluate(() => {
        DevicePlatform.saveImage = async () => {};
        app.watermark.updateConfigs({ useCustomTime: true, useCustomLocation: true, weatherMode: 'manual', useCustomText: true, customText: '原始备注' });
        app.watermark.setCustomTime('2026-10-09', '05:20');
        app.watermark.setCustomLocation('', '南京市浦口区', '兰新路-道路停车位', '32.189802,118.714729');
        app.watermark.setWeather(true, '轻度雾霾', '17°C');
        app.updateWatermarkPreview();
    });
    await page.click('#btn-capture');
    await page.click('#btn-save');
    await page.waitForFunction(() => app.photos.length === 1);
    const source = await page.evaluate(() => app.photos[0]);
    await page.evaluate(() => {
        app.cameraWatermark.setCustomTime('2026-10-11', '12:34');
        app.cameraWatermark.setCustomLocation('', '苏州市', '相机的新地址', '31.3,120.5');
        app.cameraWatermark.setWeather(true, '晴', '30°C');
        app.saveSettings();
        app.updateWatermarkPreview();
    });
    const cameraSettings = await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig()));
    await page.click('#btn-gallery');
    await page.click('.gallery-item');
    await page.click('#preview-text-targets [data-field="location"]');
    await page.waitForSelector('#watermark-text-modal:not(.hidden)');
    assert.equal(await page.locator('#watermark-edit-province').inputValue(), '');
    assert.equal(await page.locator('#watermark-edit-city').inputValue(), '南京市浦口区');
    assert.equal(await page.locator('#watermark-edit-address').inputValue(), '兰新路-道路停车位');
    await page.fill('#watermark-edit-province', '江苏省');
    await page.fill('#watermark-edit-city', '南京市浦口区');
    await page.fill('#watermark-edit-address', '兰新路168号2栋301室');
    await page.click('#watermark-text-form button[type="submit"]');
    assert.equal(await page.evaluate(() => app.photoEditSession.manager.getLocation().full), '江苏省南京市浦口区兰新路168号2栋301室');
    assert.equal(await page.evaluate(() => app.photoEditSession.manager.getLocation().coords), '32.189802,118.714729');
    assert.equal(await page.locator('#custom-province').inputValue(), '江苏省');
    assert.equal(await page.locator('#custom-city').inputValue(), '南京市浦口区');
    assert.equal(await page.locator('#custom-address').inputValue(), '兰新路168号2栋301室');
    assert.equal(await page.evaluate(() => app.photoEditSession.originalDataUrl), source.originalDataUrl);
    assert.notEqual(await page.evaluate(() => app.photoEditSession.dataUrl), source.dataUrl);
    assert.equal(await page.locator('#settings-panel').isVisible(), false);
    const editField = async (field, values) => {
        await page.click(`#photo-editor-text-targets [data-field="${field}"]`);
        for (const [name, value] of Object.entries(values)) await page.fill(`#watermark-edit-${name}`, value);
        await page.click('#watermark-text-form button[type="submit"]');
        await page.waitForSelector('#watermark-text-modal.hidden', { state: 'attached' });
    };
    await page.click('#photo-editor-text-targets [data-field="time"]');
    assert.equal(await page.locator('#watermark-edit-time').inputValue(), '05:20');
    assert.equal(await page.locator('#watermark-edit-date').inputValue(), '2026-10-09');
    await page.fill('#watermark-edit-date', '2026-10-10');
    await page.fill('#watermark-edit-time', '08:45');
    await page.click('#watermark-text-form button[type="submit"]');
    await page.click('#photo-editor-text-targets [data-field="weather"]');
    assert.equal(await page.locator('#watermark-edit-weather').inputValue(), '轻度雾霾');
    assert.equal(await page.locator('#watermark-edit-temp').inputValue(), '17°C');
    await page.fill('#watermark-edit-weather', '多云');
    await page.fill('#watermark-edit-temp', '26°C');
    await page.click('#watermark-text-form button[type="submit"]');
    await page.click('#photo-editor-text-targets [data-field="coordinates"]');
    assert.equal(await page.locator('#watermark-edit-coords').inputValue(), '32.189802,118.714729');
    await page.fill('#watermark-edit-coords', '91,181');
    await page.click('#watermark-text-form button[type="submit"]');
    assert.equal(await page.locator('#watermark-text-modal').isVisible(), true);
    assert.equal(await page.evaluate(() => app.photoEditSession.manager.getLocation().coords), '32.189802,118.714729');
    await page.fill('#watermark-edit-coords', '32.190001,118.715001');
    await page.click('#watermark-text-form button[type="submit"]');
    await editField('text', { text: '直接修改备注' });
    await editField('brandName', { value: '现场记录' });
    await editField('brandSubtitle', { value: '施工' });
    await editField('brandBadge', { value: '真实可验' });
    await editField('brandCodeLabel', { value: '防伪' });
    const unchanged = await page.evaluate(() => app.photoEditSession.dataUrl);
    await page.click('#photo-editor-text-targets [data-field="location"]');
    await page.fill('#watermark-edit-address', '取消修改的地址');
    await page.focus('#watermark-edit-province');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#watermark-text-form button[type="submit"]').evaluate(button => button === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#watermark-edit-province').evaluate(input => input === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => app.photoEditSession.dataUrl), unchanged);
    for (const viewport of [{ width: 915, height: 412 }, { width: 412, height: 915 }]) {
        await page.setViewportSize(viewport);
        for (const template of ['default', 'simple', 'modern', 'professional']) {
            for (const position of ['bottom-left', 'bottom-right', 'bottom-center', 'top-left', 'top-right']) {
                await page.evaluate(({ template, position }) => {
                    app.watermark.updateConfigs({ template, position }); app.renderPhotoEdit();
                }, { template, position });
                const bounds = await page.evaluate(() => {
                    const image = document.getElementById('photo-editor-image'), rect = image.getBoundingClientRect();
                    const { width, height } = app.photoEditSession.canvas;
                    const ratio = Math.min(rect.width / width, rect.height / height);
                    const left = rect.left + (rect.width - width * ratio) / 2;
                    const top = rect.top + (rect.height - height * ratio) / 2;
                    return [...document.querySelectorAll('#photo-editor-text-targets button')].every(button => {
                        const box = button.getBoundingClientRect();
                        return box.left >= left - 1 && box.top >= top - 1 && box.right <= left + width * ratio + 1 && box.bottom <= top + height * ratio + 1;
                    });
                });
                assert.equal(bounds, true, `${template}/${position}: hit targets must follow the photo, excluding letterboxing`);
            }
        }
    }
    await page.evaluate(() => { app.watermark.updateConfigs({ template: 'default', position: 'bottom-left' }); app.renderPhotoEdit(); });
    await page.setViewportSize({ width: 915, height: 412 });
    await page.click('#photo-editor-text-targets [data-field="location"]');
    assert.equal(await page.locator('#watermark-edit-province').inputValue(), '江苏省');
    assert.equal(await page.locator('#watermark-edit-city').inputValue(), '南京市浦口区');
    assert.equal(await page.locator('#watermark-edit-address').inputValue(), '兰新路168号2栋301室');
    const completeButton = await page.locator('#watermark-text-form button[type="submit"]').boundingBox();
    assert.ok(completeButton.y >= 0 && completeButton.y + completeButton.height <= 412, 'address completion remains visible in landscape');
    await page.screenshot({ path: 'artifacts/direct-watermark-text-edit-197.png', animations: 'disabled' });
    await page.click('#btn-cancel-watermark-text');
    await page.click('#btn-save-photo-edit');
    await page.waitForFunction(() => app.photos.length === 2 && !app.photoEditSession);
    const saved = await page.evaluate(() => app.photos[0]);
    assert.equal(saved.originalDataUrl, source.originalDataUrl);
    assert.equal(saved.watermarkConfig.customTime.time, '08:45');
    assert.equal(saved.watermarkConfig.customTime.weekDay, '星期六');
    assert.equal(saved.watermarkConfig.customLocation.province, '江苏省');
    assert.equal(saved.watermarkConfig.customLocation.city, '南京市浦口区');
    assert.equal(saved.watermarkConfig.customLocation.address, '兰新路168号2栋301室');
    assert.equal(saved.watermarkConfig.customLocation.coords, '32.190001,118.715001');
    assert.equal(saved.watermarkConfig.weather.text, '多云');
    assert.equal(saved.watermarkConfig.weatherMode, 'manual');
    assert.equal(saved.watermarkConfig.brandName, '现场记录');
    assert.equal(saved.watermarkConfig.customText, '直接修改备注');
    assert.equal(await page.evaluate(() => app.photos[1].dataUrl), source.dataUrl);
    assert.equal(await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig())), cameraSettings);
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady() && app.photos.length === 2);
    await page.click('#btn-gallery');
    await page.click('.gallery-item:first-child');
    await page.click('#preview-text-targets [data-field="location"]');
    assert.equal(await page.locator('#watermark-edit-province').inputValue(), '江苏省');
    assert.equal(await page.locator('#watermark-edit-city').inputValue(), '南京市浦口区');
    assert.equal(await page.locator('#watermark-edit-address').inputValue(), '兰新路168号2栋301室');
    await page.click('#btn-cancel-watermark-text');
    await page.click('#btn-cancel-photo-edit');
    assert.deepEqual(errors, []);
    await context.close();
});

test('settings and direct text inputs update the photo before blur or completion, and canceled drafts restore it', async () => {
    const { context, page, errors } = await openApp();
    await page.evaluate(() => app.toggleSettingsPanel(true));
    await page.click('#toggle-custom-time + .slider');
    await page.evaluate(() => {
        const date = document.getElementById('custom-date'), time = document.getElementById('custom-time');
        date.value = '2026-10-10'; date.dispatchEvent(new Event('input', { bubbles: true }));
        time.value = '08:46'; time.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#watermark-overlay .wm-time').innerText(), '08:46');
    assert.equal(await page.locator('#watermark-overlay .wm-date').innerText(), '2026-10-10');
    await page.click('#toggle-custom-location + .slider');
    await page.fill('#custom-city', '南京市浦口区');
    await page.fill('#custom-address', '兰新路168号2栋301室');
    await page.fill('#custom-coords', '32.189802,118.714729');
    await page.click('.weather-mode-tab[data-mode="manual"]');
    await page.fill('#custom-weather', '小雨');
    await page.fill('#custom-temp', '18°C');
    await page.click('.template-item[data-template="simple"]');
    assert.match(await page.locator('#watermark-overlay .wm-weather').innerText(), /小雨.*18°C/);
    assert.match(await page.locator('#watermark-overlay .wm-coordinates').innerText(), /32.189802/);
    for (const viewport of [{ width: 412, height: 915 }, { width: 915, height: 412 }]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(50);
        const visible = await page.evaluate(() => {
            const panel = document.getElementById('settings-panel').getBoundingClientRect();
            const watermark = document.getElementById('watermark-overlay').getBoundingClientRect();
            const camera = document.querySelector('.camera-container').getBoundingClientRect();
            const brand = document.getElementById('brand-overlay').getBoundingClientRect();
            return { panel: panel.toJSON(), watermark: watermark.toJSON(), camera: camera.toJSON(), brand: brand.toJSON() };
        });
        assert.ok(visible.watermark.y >= visible.camera.y && visible.watermark.bottom <= visible.camera.bottom + 1, 'live settings watermark stays inside the visible camera');
        assert.ok(visible.watermark.right <= visible.panel.x + 1 || visible.watermark.bottom <= visible.panel.y + 1, 'settings must not cover live changes');
        assert.ok(visible.brand.right <= visible.panel.x + 1 || visible.brand.bottom <= visible.panel.y + 1, 'brand stays visible while typing');
    }
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: 'artifacts/live-watermark-settings-198.png' });
    await page.click('#btn-close-settings');
    await page.click('#btn-capture');
    await page.click('#btn-edit-watermark');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    const before = await page.evaluate(() => app.photoEditSession.dataUrl);
    await page.click('#photo-editor-text-targets [data-field="location"]');
    await page.fill('#watermark-edit-address', '兰新路168号3栋502室');
    assert.match(await page.evaluate(() => app.photoEditSession.manager.getLocation().full), /3栋502室$/);
    assert.notEqual(await page.evaluate(() => app.photoEditSession.dataUrl), before);
    await page.click('#btn-cancel-watermark-text');
    assert.equal(await page.evaluate(() => app.photoEditSession.dataUrl), before);
    await page.click('#photo-editor-text-targets [data-field="location"]');
    await page.fill('#watermark-edit-address', '兰新路168号3栋502室');
    await page.click('#watermark-text-form button[type="submit"]');
    assert.match(await page.evaluate(() => app.photoEditSession.manager.getLocation().full), /3栋502室$/);
    await page.click('#btn-photo-edit-settings');
    const changed = await page.evaluate(() => app.photoEditSession.dataUrl);
    await page.evaluate(() => {
        const input = document.getElementById('custom-time'); input.value = '09:15'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => app.photoEditSession.manager.getCurrentTime().time), '09:15');
    assert.notEqual(await page.evaluate(() => app.photoEditSession.dataUrl), changed);
    assert.deepEqual(errors, []);
    await context.close();
});

test('settings show changed addresses and a fixed save action with legacy viewport support', async () => {
    const { context, page, errors } = await openApp({ legacyViewport: true });
    await page.click('#btn-watermark-edit');
    await page.click('#toggle-custom-location + .slider');
    await page.fill('#custom-province', '江苏省');
    await page.fill('#custom-city', '南京市');
    const layout = await page.evaluate(() => {
        const panel = document.getElementById('settings-panel').getBoundingClientRect();
        const watermark = document.getElementById('watermark-overlay').getBoundingClientRect();
        return { panel: panel.toJSON(), watermark: watermark.toJSON() };
    });
    assert.ok(layout.watermark.bottom <= layout.panel.y + 1, `settings cover the edited watermark: ${JSON.stringify(layout)}`);
    assert.match((await page.locator('#watermark-overlay .wm-location').innerText()).replace(/\n/g, ''), /江苏省南京市/);
    for (const viewport of [{ width: 412, height: 915 }, { width: 412, height: 560 }, { width: 915, height: 412 }]) {
        await page.setViewportSize(viewport);
        await page.locator('.settings-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
        const button = await page.locator('#btn-save-watermark-settings').boundingBox();
        assert.ok(button && button.y >= 0 && button.y + button.height <= viewport.height, 'save stays on screen after scrolling and with keyboard-sized space');
        assert.equal(await page.locator('#btn-save-watermark-settings').innerText(), '保存设置');
    }
    await page.setViewportSize({ width: 412, height: 915 });
    // Read the latest field value on save, even if an IME has not dispatched its final input event.
    await page.locator('#custom-address').evaluate(element => { element.value = '兰新路168号3栋502室'; });
    await page.click('#btn-save-watermark-settings');
    await page.waitForSelector('#settings-panel', { state: 'hidden' });
    assert.match((await page.locator('#watermark-overlay .wm-location').innerText()).replace(/\n/g, ''), /江苏省南京市 · 兰新路168号3栋502室/);
    await page.reload(); await page.waitForFunction(() => app.camera.isReady());
    assert.match((await page.locator('#watermark-overlay .wm-location').innerText()).replace(/\n/g, ''), /兰新路168号3栋502室/);
    await page.click('#btn-capture'); await page.click('#btn-edit-watermark');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    await page.click('#btn-photo-edit-settings');
    assert.equal(await page.locator('#btn-save-watermark-settings').innerText(), '保存图片副本');
    await page.fill('#custom-address', '兰新路168号3栋503室');
    await page.click('#btn-save-watermark-settings');
    await page.waitForFunction(() => !app.photoEditSession && app.photos.length === 1);
    assert.match(await page.evaluate(() => app.photos[0].location), /3栋503室/);
    assert.equal(await page.evaluate(() => app.cameraWatermark.getLocation().address), '兰新路168号3栋502室');
    assert.deepEqual(errors, []); await context.close();
});

test('system photo imports retain their resolution and failed exports leave edits available to retry', async () => {
    const { context, page, errors } = await openApp();
    const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 720, 1280);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.click('.mode-tab[data-mode="edit"]');
    await page.setInputFiles('#edit-photo-file', { name: 'source.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    assert.deepEqual(await page.evaluate(() => [app.photoEditSession.canvas.width, app.photoEditSession.canvas.height]), [720, 1280]);
    await page.click('#btn-photo-edit-settings');
    await page.click('#toggle-custom-text + .slider');
    await page.fill('#custom-text', '导入照片编辑');
    await page.fill('#brand-name', '<img>');
    const escapeSafe = await page.evaluate(() => app.watermark.generateBrandHTML());
    assert.ok(escapeSafe.includes('&lt;img&gt;'));
    await page.fill('#brand-name', '项目记录');
    await page.screenshot({ path: 'artifacts/watermark-editor-settings.png' });
    await page.evaluate(() => {
        window.originalSaveImage = DevicePlatform.saveImage;
        DevicePlatform.saveImage = async () => { throw new Error('storage full'); };
    });
    await page.click('#btn-save-photo-edit');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('保存失败'));
    assert.equal(await page.evaluate(() => app.photos.length), 0);
    assert.equal(await page.locator('#btn-save-photo-edit').isEnabled(), true);
    assert.equal(await page.locator('#custom-text').inputValue(), '导入照片编辑');
    await page.evaluate(() => { DevicePlatform.saveImage = window.originalSaveImage; });
    const download = page.waitForEvent('download');
    await page.click('#btn-save-photo-edit');
    await download;
    await page.waitForFunction(() => app.photos.length === 1 && !app.photoEditSession);
    assert.equal(await page.evaluate(() => app.photos[0].watermarkConfig.customText), '导入照片编辑');
    assert.deepEqual(errors, []);
    await context.close();
});

test('legacy photos prompt for originals and canceling an edit preserves camera settings', async () => {
    const { context, page, errors } = await openApp();
    await page.click('#btn-capture');
    await page.evaluate(() => { app.currentOriginalPhoto = null; app.currentWatermarkConfig = null; });
    const photo = await page.evaluate(() => app.currentPhoto);
    const cameraSettings = await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig()));
    await page.click('#btn-edit-watermark');
    assert.match(await page.locator('#edit-source-description').innerText(), /已有水印无法直接替换/);
    assert.equal(await page.locator('#btn-overlay-legacy-photo').isVisible(), true);
    await page.click('#btn-overlay-legacy-photo');
    await page.waitForSelector('#photo-editor-modal:not(.hidden)');
    assert.equal(await page.evaluate(() => app.photoEditSession.originalDataUrl), photo);
    await page.click('#btn-photo-edit-settings');
    await page.selectOption('#watermark-font-size', 'small');
    await page.fill('#brand-name', '临时品牌');
    await page.click('#toggle-custom-location + .slider');
    await page.fill('#custom-address', '编辑中的地址');
    await page.evaluate(() => app._applyLocationResult('1', '2', { province: '迟到的定位' }));
    assert.equal(await page.locator('#custom-address').inputValue(), '编辑中的地址');
    await page.click('#btn-close-settings');
    await page.click('#btn-cancel-photo-edit');
    assert.equal(await page.evaluate(() => app.currentPhoto), photo);
    assert.equal(await page.evaluate(() => JSON.stringify(app.cameraWatermark.getConfig())), cameraSettings);
    assert.equal(await page.evaluate(() => localStorage.getItem('moxi_settings')), cameraSettings);
    assert.equal(await page.locator('#custom-address').inputValue(), '');
    assert.deepEqual(errors, []);
    await context.close();
});

test('exported watermarks scale with resolution and keep every template inside the image', async () => {
    const { context, page, errors } = await openApp();
    const results = await page.evaluate(() => {
        const watermark = new WatermarkManager();
        watermark.setCustomTime('2026-10-11', '08:45');
        watermark.updateConfig('useCustomTime', true);
        watermark.setCustomLocation('江苏省', '苏州市', '施工现场工程进度记录区域：长地址测试，用于确认导出照片中的位置文字可以自动换行', '31.3,120.6');
        watermark.updateConfig('useCustomLocation', true);
        watermark.setWeather(true, '多云', '26°C');
        watermark.updateConfig('useCustomText', true);
        watermark.updateConfig('customText', '现场记录：今日施工完成');
        const check = (width, height) => {
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            watermark.drawWatermarkOnCanvas(ctx, width, height);
            const pixels = ctx.getImageData(0, 0, width, height).data;
            let minX = width, minY = height, maxX = 0, maxY = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (pixels[(y * width + x) * 4 + 3] > 20) {
                        minX = Math.min(minX, x); minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                    }
                }
            }
            return { minX, minY, maxX, maxY, width, height };
        };
        const bounds = [];
        watermark.updateConfigs({ brandName: '项目施工现场记录', brandSubtitle: '项目施工现场', brandBadge: '现场拍摄记录' });
        for (const template of ['default', 'simple', 'modern', 'professional']) {
            for (const position of ['bottom-left', 'bottom-right', 'bottom-center', 'top-left', 'top-right']) {
                watermark.updateConfig('template', template);
                watermark.updateConfig('position', position);
                watermark.updateConfig('fontSize', 'large');
                bounds.push(check(540, 960), check(960, 540));
            }
        }
        watermark.updateConfig('template', 'default');
        watermark.updateConfig('position', 'bottom-left');
        watermark.updateConfig('fontSize', 'medium');
        watermark.updateConfig('brandEnabled', false);
        const one = check(540, 960);
        const two = check(1080, 1920);
        return { bounds, one, two };
    });
    for (const box of results.bounds) {
        assert.ok(box.minX > 0 && box.minY > 0 && box.maxX < box.width - 1 && box.maxY < box.height - 1, JSON.stringify(box));
    }
    assert.ok(Math.abs(results.one.minY * 2 - results.two.minY) <= 3);
    assert.ok(Math.abs(results.one.maxX * 2 - results.two.maxX) <= 3);
    assert.ok(results.two.maxY < 1890, 'bottom text must retain a margin');
    // Medium exported time should be approximately 100px tall at a 1080px photo width.
    const sizes = await page.evaluate(() => {
        const watermark = new WatermarkManager();
        const overlay = document.createElement('div');
        watermark.updatePreview(overlay);
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        const fontSizes = [];
        const fillText = ctx.fillText.bind(ctx);
        ctx.fillText = (...args) => { fontSizes.push(parseFloat(ctx.font.match(/([\d.]+)px/)[1]) * ctx.getTransform().a); fillText(...args); };
        ctx.fillStyle = '#263238';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        watermark.setCustomLocation('江苏省', '苏州市', '施工现场工程进度记录区域，位置文字自动换行', '31.3,120.6');
        watermark.updateConfig('useCustomLocation', true);
        watermark.setWeather(true, '多云', '26°C');
        watermark.updateConfig('useCustomText', true);
        watermark.updateConfig('customText', '现场记录：今日施工完成');
        watermark.drawWatermarkOnCanvas(ctx, 1080, 1920);
        return { preview: overlay.querySelector('.wm-time').style.fontSize, exported: fontSizes[0], image: canvas.toDataURL() };
    });
    assert.equal(sizes.preview, '52px');
    assert.ok(sizes.exported >= 95, 'exported time must be substantially larger than the old 50px');
    await writeFile('artifacts/watermark-1080-preview.png', Buffer.from(sizes.image.split(',')[1], 'base64'));
    assert.deepEqual(errors, []);
    await context.close();
});

test('long field values stay complete and use the same bounded rows in live and exported watermarks', async () => {
    const { context, page, errors } = await openApp();
    const issues = await page.evaluate(() => {
        const manager = new WatermarkManager();
        manager.setCustomTime('2026-10-10', '09:15');
        const address = '兰新路168号3栋502室，现场施工记录区域及入口位置。'.repeat(6);
        manager.setCustomLocation('江苏省', '南京市浦口区', address, '32.189802,118.714729');
        manager.setWeather(true, '小雨', '18°C');
        manager.updateConfigs({ useCustomTime: true, useCustomLocation: true, useCustomText: true, customText: '现场记录：今日施工完成', fontSize: 'large' });
        const parent = document.createElement('div');
        parent.style.cssText = 'position:fixed;left:0;top:0;z-index:2000;';
        const overlay = document.createElement('div'), brand = document.createElement('div');
        brand.className = 'brand-overlay'; parent.append(overlay, brand); document.body.append(parent);
        const issues = [];
        for (const [w, h] of [[414, 414], [915, 412], [412, 700]]) {
            parent.style.width = `${w}px`; parent.style.height = `${h}px`;
            for (const template of ['default', 'simple', 'modern', 'professional']) {
                for (const position of ['bottom-left', 'bottom-right', 'bottom-center', 'top-left', 'top-right']) {
                    manager.updateConfigs({ template, position }); manager.updatePreview(overlay); manager.updateBrandPreview(brand);
                    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d'), exported = [], fill = ctx.fillText.bind(ctx);
                    ctx.fillText = (text, ...args) => { exported.push(text); fill(text, ...args); };
                    const regions = manager.drawWatermarkOnCanvas(ctx, w, h);
                    const label = `${w}x${h}/${template}/${position}`;
                    if (!exported.join('').includes(address) || !overlay.querySelector('.wm-location').textContent.replace(/\n/g, '').includes(address)) issues.push(`${label}: incomplete address`);
                    for (const field of ['weather', 'location', 'coordinates', 'text']) {
                        const row = overlay.querySelector(`.wm-${field}`).getBoundingClientRect();
                        const region = regions.find(region => region.field === field);
                        if (Math.abs(row.x - region.x) > 1 || Math.abs(row.y - region.y) > 1 || Math.abs(row.width - region.width) > 1 || Math.abs(row.height - region.height) > 1) issues.push(`${label}: ${field} preview differs from export: ${JSON.stringify({ row: row.toJSON(), region })}`);
                    }
                    const badge = brand.getBoundingClientRect();
                    for (const region of regions.filter(region => ['time', 'date', 'weather', 'location', 'coordinates', 'text'].includes(region.field))) {
                        if (region.x < 0 || region.y < 0 || region.x + region.width > w || region.y + region.height > h) issues.push(`${label}: ${region.field} clipped`);
                        if (region.x < badge.right && region.x + region.width > badge.left && region.y < badge.bottom && region.y + region.height > badge.top) issues.push(`${label}: ${region.field} overlaps brand`);
                    }
                }
            }
        }
        parent.remove(); return issues;
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(errors, []);
    await context.close();
});

test('reference watermark content is editable, coordinates persist and preview matches exported rows', async () => {
    const { context, page, errors } = await openApp();
    await page.evaluate(() => app.toggleSettingsPanel(true));
    await page.evaluate(() => {
        app.watermark.updateConfig('useCustomLocation', false);
        app.watermark.setWeatherMode('auto');
        app.watermark.setWeatherFromAuto({ text: '晴', temp: '26°C', humidity: 34, source: 'open-meteo' });
        DevicePlatform.getCurrentPosition = success => { window.pendingAutoPosition = success; };
        app.autoGetLocation();
    });
    await page.click('#btn-reference-watermark');
    await page.evaluate(() => window.pendingAutoPosition({ coords: { latitude: 1.3521, longitude: 103.8198 } }));
    assert.equal(await page.locator('#custom-city').inputValue(), '南京市浦口区', 'late automatic GPS must preserve the edited location');
    await page.evaluate(() => app.watermark.setWeatherFromAuto({ text: '晴', temp: '26°C', humidity: 34 }));
    assert.equal(await page.evaluate(() => app.watermark.getWeather()), '轻度雾霾 17°C', 'late automatic weather must preserve manual weather');
    assert.equal(await page.evaluate(() => app.watermark.getWeatherDetail()), null, 'manual weather must not display stale live weather details');
    await page.click('#btn-close-settings');
    const contents = await page.locator('#watermark-overlay').innerText();
    assert.match(contents, /05:20/);
    assert.match(contents, /2026-10-09/);
    assert.match(contents, /星期五\s+轻度雾霾 17°C/);
    assert.match(contents.replace(/\n/g, ''), /南京市浦口区 · 兰新路-道路停车位/);
    assert.match(contents.replace(/\n/g, ''), /经纬度：\s*32.189802°N,118.714729°E/);
    assert.equal(await page.locator('#brand-overlay .brand-verify-badge').innerText(), '真实可验');
    assert.equal(await page.locator('#brand-overlay .antifake-label').innerText(), '防伪');
    assert.equal(await page.locator('#watermark-overlay svg').count(), 0);
    const checks = await page.evaluate(() => {
        const manager = app.watermark;
        const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        const exported = [];
        const original = ctx.fillText.bind(ctx);
        ctx.fillText = (text, ...args) => { exported.push(text); original(text, ...args); };
        manager.drawWatermarkOnCanvas(ctx, 1080, 1920);
        return {
            exported: exported.join(''),
            invalid: ['91,120', '32,181', '位置未获取', '32,', ',118'].map(value => manager.formatCoordinates(value)),
            southern: manager.formatCoordinates('-32.1,-118.2'),
            formatted: manager.formatCoordinates('32.189802°N,118.714729°E'),
            coordinates: document.querySelector('.wm-coordinates').getBoundingClientRect().toJSON(),
            brand: document.querySelector('#brand-overlay').getBoundingClientRect().toJSON()
        };
    });
    assert.match(checks.exported, /南京市浦口区 · 兰新路-道路停车位/);
    assert.match(checks.exported, /经纬度：\s*32.189802°N,118.714729°E/);
    assert.deepEqual(checks.invalid, ['', '', '', '', '']);
    assert.equal(checks.southern, '32.100000°S,118.200000°W');
    assert.equal(checks.formatted, '32.189802°N,118.714729°E');
    assert.ok(checks.coordinates.right < checks.brand.left, 'coordinate panel must not cover the brand');
    await page.waitForTimeout(2300);
    await page.screenshot({ path: 'artifacts/reference-watermark-camera.png' });
    const sample = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1152;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 2048, 1152);
        gradient.addColorStop(0, '#8b8b80'); gradient.addColorStop(1, '#323633');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2048, 1152);
        app.watermark.drawWatermarkOnCanvas(ctx, 2048, 1152);
        const crop = document.createElement('canvas'); crop.width = 2048; crop.height = 524;
        crop.getContext('2d').drawImage(canvas, 0, -628);
        return { full: canvas.toDataURL(), crop: crop.toDataURL() };
    });
    await writeFile('artifacts/reference-watermark-landscape.png', Buffer.from(sample.full.split(',')[1], 'base64'));
    await writeFile('artifacts/reference-watermark-detail.png', Buffer.from(sample.crop.split(',')[1], 'base64'));
    await page.evaluate(() => app.toggleSettingsPanel(true));
    await page.click('#toggle-coordinates + .slider');
    assert.equal(await page.locator('#watermark-overlay .wm-coordinates').count(), 0);
    await page.fill('#custom-address', '兰新路18号2栋301室');
    await page.fill('#brand-badge', '现场记录');
    await page.fill('#brand-code-label', '编号');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('moxi_settings')).showCoordinates === false);
    await page.reload();
    await page.waitForFunction(() => app.camera.isReady());
    assert.equal(await page.locator('#watermark-overlay .wm-coordinates').count(), 0);
    assert.match((await page.locator('#watermark-overlay .wm-location').innerText()).replace(/\n/g, ''), /兰新路18号2栋301室/);
    assert.equal(await page.locator('#toggle-coordinates').isChecked(), false);
    assert.equal(await page.locator('#brand-overlay .brand-verify-badge').innerText(), '现场记录');
    assert.equal(await page.locator('#brand-overlay .antifake-label').innerText(), '编号');
    assert.deepEqual(errors, []);
    await context.close();
});
