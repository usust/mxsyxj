/**
 * 今日水印相机 - 主应用逻辑
 * 负责UI交互、事件绑定和整体应用流程
 */

class App {
    constructor() {
        this.camera = new CameraManager();
        this.watermark = new WatermarkManager();
        this.weather = new WeatherManager();
        this.watermarkOverlay = null;
        this.brandOverlay = null;
        this.currentPhoto = null;
        this.photos = [];
        this.watermarkUpdateInterval = null;
        this.settingsPanelOpen = false;
        this.currentZoom = 1;
        this.verifyModalOpen = false;
        this.currentMode = 'photo';
        this.collageLayout = 2;
        this.collagePhotos = [];
        this.reportPhotos = [];
        this.profile = this.loadProfile();

        this.photoStore = new PhotoStore();
    }

    get watermark() {
        return this.photoEditSession?.manager || this.cameraWatermark;
    }

    set watermark(manager) {
        this.cameraWatermark = manager;
    }

    async init() {
        await this.showSplash();
        this.watermarkOverlay = document.getElementById('watermark-overlay');
        this.brandOverlay = document.getElementById('brand-overlay');
        this.bindEvents();
        this.updateWatermarkPreview();
        this.updateProfileUI();

        try {
            await this.camera.init();
            this.showToast('相机已就绪');
        } catch (err) {
            console.error('相机初始化失败:', err);
            this.showToast('相机初始化失败，请检查权限');
        }

        this.startTimeUpdateTimer();

        // 启动时自动获取定位
        if (!this.watermark.config.useCustomLocation) {
            setTimeout(() => { if (!this.photoEditSession) this.autoGetLocation(); }, 1000);
        }

        // 启动时自动获取天气（如果是自动模式）
        if (this.watermark.config.weatherMode !== 'manual') {
            setTimeout(() => { if (!this.photoEditSession && this.cameraWatermark.config.weatherMode !== 'manual') this.refreshAutoWeather(); }, 2000);
        }
    }

    async showSplash() {
        return new Promise((resolve) => {
            setTimeout(() => {
                const splash = document.getElementById('splash-screen');
                const app = document.getElementById('app');
                splash.classList.add('fade-out');
                app.classList.remove('hidden');
                setTimeout(() => {
                    splash.style.display = 'none';
                    resolve();
                }, 500);
            }, 1500);
        });
    }

    bindEvents() {
        // Save immediately: Android can stop the process without beforeunload.
        for (const event of ['input', 'change', 'click']) {
            document.getElementById('settings-panel').addEventListener(event, () => {
                queueMicrotask(() => this.saveSettings());
            });
        }
        // 侧边菜单
        document.getElementById('btn-menu').addEventListener('click', () => {
            this.openSideMenu();
        });

        document.querySelector('.side-menu-overlay').addEventListener('click', () => {
            this.closeSideMenu();
        });
        document.querySelector('.side-menu-header').addEventListener('click', () => {
            this.closeSideMenu();
            this.openProfile();
        });
        document.getElementById('btn-close-profile').addEventListener('click', () => this.closeProfile());
        document.getElementById('profile-modal').addEventListener('click', event => {
            if (event.target.id === 'profile-modal') this.closeProfile();
        });
        document.getElementById('profile-form').addEventListener('submit', event => {
            event.preventDefault();
            this.saveProfile();
        });

        document.getElementById('menu-watermark').addEventListener('click', () => {
            this.closeSideMenu();
            this.toggleSettingsPanel(true);
        });

        document.getElementById('menu-gallery').addEventListener('click', () => {
            this.closeSideMenu();
            this.openGallery();
        });

        document.getElementById('menu-verify').addEventListener('click', () => {
            this.closeSideMenu();
            this.openVerifyModal();
        });

        document.getElementById('menu-about').addEventListener('click', () => {
            this.closeSideMenu();
            this.openAboutModal();
        });

        // 闪光灯
        document.getElementById('btn-flash').addEventListener('click', () => {
            const mode = this.camera.toggleFlash();
            const btn = document.getElementById('btn-flash');
            const slash = btn.querySelector('.flash-slash');
            const modeText = { off: '已关闭', on: '已开启', auto: '自动' };
            btn.classList.toggle('active', mode !== 'off');
            if (slash) slash.classList.toggle('hidden', mode !== 'off');
            this.showToast(`闪光灯${modeText[mode]}`);
        });

        // 照片验真
        document.getElementById('btn-verify').addEventListener('click', () => {
            this.openVerifyModal();
        });

        // 验真模态框关闭
        document.getElementById('btn-close-verify').addEventListener('click', () => {
            this.closeVerifyModal();
        });

        document.getElementById('verify-modal').addEventListener('click', (e) => {
            if (e.target.id === 'verify-modal') {
                this.closeVerifyModal();
            }
        });

        // 验真输入框
        document.getElementById('btn-verify-code').addEventListener('click', () => {
            this.verifyPhotoByCode();
        });

        document.getElementById('verify-code-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.verifyPhotoByCode();
            }
        });

        // 防伪设置开关
        document.getElementById('toggle-brand').addEventListener('change', (e) => {
            this.watermark.updateConfig('brandEnabled', e.target.checked);
            this.updateWatermarkPreview();
            this.saveSettings();
            this.showToast(e.target.checked ? '品牌水印已开启' : '品牌水印已关闭');
        });

        document.getElementById('toggle-antifake').addEventListener('change', (e) => {
            this.watermark.updateConfig('antiFakeEnabled', e.target.checked);
            this.updateWatermarkPreview();
            this.saveSettings();
            this.showToast(e.target.checked ? '照片编号已开启' : '照片编号已关闭');
        });

        // 切换摄像头
        document.getElementById('btn-switch-camera').addEventListener('click', async () => {
            try {
                await this.camera.switchCamera();
                this.showToast('已切换摄像头');
            } catch (err) {
                this.showToast('切换摄像头失败');
            }
        });

        // 变焦控制
        document.querySelectorAll('.zoom-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.zoom-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const zoom = item.dataset.zoom;
                this.applyZoom(zoom);
            });
        });

        // 拍照按钮
        document.getElementById('btn-capture').addEventListener('click', () => {
            this.capturePhoto();
        });

        // 水印编辑按钮
        document.getElementById('btn-watermark-edit').addEventListener('click', () => {
            this.toggleSettingsPanel(true);
        });

        // 相册按钮
        document.getElementById('btn-gallery').addEventListener('click', () => {
            this.openGallery();
        });

        document.getElementById('btn-close-gallery').addEventListener('click', () => {
            this.closeGallery();
        });

        document.getElementById('btn-clear-gallery').addEventListener('click', () => {
            this.clearGallery();
        });

        // 预览模态框
        document.getElementById('btn-back-camera').addEventListener('click', () => {
            this.closePreview();
        });

        document.getElementById('btn-save').addEventListener('click', () => {
            this.savePhoto();
        });

        document.getElementById('btn-retake').addEventListener('click', () => {
            this.closePreview();
        });

        document.getElementById('btn-share').addEventListener('click', () => {
            this.sharePhoto();
        });

        document.getElementById('btn-edit-watermark').addEventListener('click', () => {
            this.editSelectedPhoto({
                dataUrl: this.currentPhoto, originalDataUrl: this.currentOriginalPhoto,
                watermarkConfig: this.currentWatermarkConfig, ...this.currentPhotoMeta
            });
        });
        document.getElementById('btn-close-edit-source').addEventListener('click', () => this.closeEditSource());
        document.getElementById('btn-import-edit-photo').addEventListener('click', () => document.getElementById('edit-photo-file').click());
        document.getElementById('edit-photo-file').addEventListener('change', event => this.importEditPhoto(event.target));
        document.getElementById('btn-select-local-photo').addEventListener('click', () => {
            this.closeEditSource();
            this.currentMode = 'edit';
            this.openGallery();
        });
        document.getElementById('btn-overlay-legacy-photo').addEventListener('click', () => {
            const photo = this.pendingLegacyPhoto;
            this.closeEditSource();
            if (photo) this.startPhotoEditor({ ...photo, originalDataUrl: photo.dataUrl });
        });
        document.getElementById('btn-cancel-photo-edit').addEventListener('click', () => this.closePhotoEditor());
        document.getElementById('btn-save-photo-edit').addEventListener('click', () => this.saveEditedPhoto());
        document.getElementById('btn-photo-edit-settings').addEventListener('click', () => this.toggleSettingsPanel(true));
        for (const mode of ['preview', 'photo-editor']) {
            const image = document.getElementById(`${mode}-image`);
            const targets = document.getElementById(`${mode}-text-targets`);
            image.addEventListener('load', () => this.updatePhotoTextTargets(mode));
            new ResizeObserver(() => this.updatePhotoTextTargets(mode)).observe(image.parentElement);
            targets.addEventListener('click', event => {
                const field = event.target.closest('[data-field]')?.dataset.field;
                if (!field) return;
                if (mode === 'preview') {
                    this.startPhotoEditor({ dataUrl: this.currentPhoto, originalDataUrl: this.currentOriginalPhoto,
                        watermarkConfig: this.currentWatermarkConfig, ...this.currentPhotoMeta }, field);
                } else this.openWatermarkTextEditor(field);
            });
        }
        document.getElementById('btn-cancel-watermark-text').addEventListener('click', () => this.closeWatermarkTextEditor());
        document.getElementById('watermark-text-modal').addEventListener('click', event => {
            if (event.target.id === 'watermark-text-modal') this.closeWatermarkTextEditor();
        });
        document.getElementById('watermark-text-form').addEventListener('submit', event => {
            event.preventDefault();
            this.applyWatermarkTextEdit();
        });
        document.getElementById('watermark-text-form').addEventListener('input', () => this.applyWatermarkTextEdit(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.editingWatermarkField) this.closeWatermarkTextEditor();
            if (event.key === 'Tab' && this.editingWatermarkField) {
                const fields = [...document.querySelectorAll('#watermark-text-form input, #watermark-text-form textarea, #watermark-text-form button')];
                const next = event.shiftKey ? fields.at(-1) : fields[0];
                if (document.activeElement === (event.shiftKey ? fields[0] : fields.at(-1))) {
                    event.preventDefault(); next.focus();
                }
            }
        });
        for (const [id, key] of [['brand-name', 'brandName'], ['brand-subtitle', 'brandSubtitle'], ['brand-badge', 'brandBadge'], ['brand-code-label', 'brandCodeLabel']]) {
            document.getElementById(id).addEventListener('input', event => {
                this.watermark.updateConfig('brandEnabled', true);
                document.getElementById('toggle-brand').checked = true;
                this.watermark.updateConfig(key, event.target.value);
                this.updateWatermarkPreview();
            });
        }

        new ResizeObserver(() => this.updateWatermarkPreview()).observe(document.querySelector('.camera-container'));

        document.getElementById('settings-panel').addEventListener('compositionend', event => {
            if (event.target.matches('input, textarea')) event.target.dispatchEvent(new Event('input', { bubbles: true }));
        });
        document.getElementById('btn-save-watermark-settings').addEventListener('click', async event => {
            const button = event.currentTarget;
            if (this.savingEditedPhoto) return;
            button.disabled = true;
            try {
                document.activeElement?.blur();
                this.applySettingsInputs();
                if (this.photoEditSession) await this.saveEditedPhoto();
                else if (this.saveSettings()) {
                    this.toggleSettingsPanel(false);
                    this.updateWatermarkPreview();
                    this.showToast('水印设置已保存并应用');
                } else this.showToast('保存设置失败，请检查存储空间后重试');
            } finally { button.disabled = false; }
        });

        // 设置面板关闭
        document.getElementById('btn-close-settings').addEventListener('click', () => {
            this.toggleSettingsPanel(false);
        });

        document.getElementById('settings-panel').addEventListener('click', (e) => {
            if (e.target.id === 'settings-panel') {
                this.toggleSettingsPanel(false);
            }
        });

        // 模板选择
        document.querySelectorAll('.template-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.template-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.watermark.updateConfig('template', item.dataset.template);
                this.updateWatermarkPreview();
            });
        });

        // 时间设置
        document.getElementById('toggle-custom-time').addEventListener('change', (e) => {
            const enabled = e.target.checked;
            document.getElementById('time-settings').classList.toggle('hidden', !enabled);
            this.watermark.updateConfig('useCustomTime', enabled);
            if (!enabled) {
                this.watermark.updateConfig('customTime', null);
            } else {
                const now = new Date();
                const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                document.getElementById('custom-date').value = date;
                document.getElementById('custom-time').value = time;
                this.watermark.setCustomTime(date, time);
            }
            this.updateWatermarkPreview();
        });

        for (const id of ['custom-date', 'custom-time']) {
            for (const event of ['input', 'change']) document.getElementById(id).addEventListener(event, () => {
                const date = document.getElementById('custom-date').value;
                const time = document.getElementById('custom-time').value;
                if (!date || !time) return;
                this.watermark.updateConfig('useCustomTime', true);
                document.getElementById('toggle-custom-time').checked = true;
                this.watermark.setCustomTime(date, time);
                this.updateWatermarkPreview();
            });
        }

        document.getElementById('btn-sync-time').addEventListener('click', () => {
            const { date, time } = this.watermark.syncCurrentTime();
            document.getElementById('custom-date').value = date;
            document.getElementById('custom-time').value = time;
            this.updateWatermarkPreview();
            this.showToast('已同步当前时间');
        });

        // 位置设置
        document.getElementById('btn-reference-watermark').addEventListener('click', () => {
            this.watermark.updateConfigs({
                template: 'default', position: 'bottom-left', fontSize: 'medium',
                useCustomTime: true, useCustomLocation: true, showCoordinates: true,
                useCustomText: false, weatherMode: 'manual',
                brandEnabled: true, brandName: '今日水印', brandSubtitle: '相机',
                brandBadge: '真实可验', brandCodeLabel: '防伪', antiFakeEnabled: true
            });
            this.watermark.setCustomTime('2026-10-09', '05:20');
            this.watermark.setCustomLocation('', '南京市浦口区', '兰新路-道路停车位', '32.189802,118.714729');
            this.watermark.setWeather(true, '轻度雾霾', '17°C');
            this.loadSettings(this.watermark.getConfig());
            this.updateWatermarkPreview();
            this.saveSettings();
            this.showToast('已填入参考图示例，可继续编辑');
        });

        window.addEventListener('resize', () => this.updateWatermarkPreview());

        document.getElementById('toggle-custom-location').addEventListener('change', (e) => {
            const enabled = e.target.checked;
            document.getElementById('location-settings').classList.toggle('hidden', !enabled);
            this.watermark.updateConfig('useCustomLocation', enabled);
            if (enabled) {
                this.updateCustomLocation();
            } else {
                this.watermark.updateConfig('customLocation', null);
                this.updateWatermarkPreview();
            }
        });

        ['custom-province', 'custom-city', 'custom-address', 'custom-coords'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                this.watermark.updateConfig('useCustomLocation', true);
                document.getElementById('toggle-custom-location').checked = true;
                this.updateCustomLocation();
            });
        });

        document.getElementById('toggle-coordinates').addEventListener('change', (e) => {
            this.watermark.updateConfig('showCoordinates', e.target.checked);
            this.updateWatermarkPreview();
        });

        document.getElementById('btn-get-location').addEventListener('click', () => {
            this.getCurrentLocation();
        });

        // 天气设置
        document.getElementById('toggle-custom-weather').addEventListener('change', (e) => {
            const enabled = e.target.checked;
            document.getElementById('weather-settings').classList.toggle('hidden', !enabled);
            this.updateWeather();
        });

        // 天气模式切换
        document.querySelectorAll('.weather-mode-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.weather-mode-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const mode = tab.dataset.mode;
                this.switchWeatherMode(mode);
            });
        });

        // 刷新天气按钮
        document.getElementById('btn-refresh-weather').addEventListener('click', () => {
            this.refreshAutoWeather();
        });

        document.getElementById('custom-weather').addEventListener('input', () => {
            this.updateWeather();
        });

        document.getElementById('custom-temp').addEventListener('input', () => {
            this.updateWeather();
        });

        // 自定义文字
        document.getElementById('toggle-custom-text').addEventListener('change', (e) => {
            const enabled = e.target.checked;
            document.getElementById('text-settings').classList.toggle('hidden', !enabled);
            this.watermark.updateConfig('useCustomText', enabled);
            this.updateWatermarkPreview();
        });

        document.getElementById('custom-text').addEventListener('input', (e) => {
            this.watermark.updateConfig('useCustomText', true);
            document.getElementById('toggle-custom-text').checked = true;
            this.watermark.updateConfig('customText', e.target.value);
            this.updateWatermarkPreview();
        });

        // 水印样式
        document.getElementById('watermark-position').addEventListener('change', (e) => {
            this.watermark.updateConfig('position', e.target.value);
            this.updateWatermarkPreview();
        });

        document.getElementById('watermark-font-size').addEventListener('change', (e) => {
            this.watermark.updateConfig('fontSize', e.target.value);
            this.updateWatermarkPreview();
        });

        document.getElementById('watermark-opacity').addEventListener('input', (e) => {
            this.watermark.updateConfig('opacity', parseInt(e.target.value));
            this.updateWatermarkPreview();
        });

        // 模式标签切换
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentMode = mode;

                switch (mode) {
                    case 'photo':
                        break;
                    case 'collage':
                        this.openCollageModal();
                        break;
                    case 'report':
                        this.openReportModal();
                        break;
                    case 'edit':
                        this.openPhotoEditMode();
                        break;
                }
            });
        });

        // 快捷操作
        document.querySelector('.quick-left').addEventListener('click', () => {
            this.openProfile();
        });

        document.querySelector('.quick-right').addEventListener('click', () => {
            this.toggleSettingsPanel(true);
        });

        // 关于页面模态框
        document.querySelector('.about-close-btn').addEventListener('click', () => {
            this.closeAboutModal();
        });
        document.getElementById('about-modal').addEventListener('click', (e) => {
            if (e.target.id === 'about-modal') this.closeAboutModal();
        });
        document.getElementById('about-link-privacy').addEventListener('click', () => {
            alert('照片和设置仅保存在本机，不上传。自动天气、地址解析和IP定位会向第三方服务发送坐标或IP；断网时可手动输入。清除应用数据会删除照片记录，已导出的系统相册照片不受影响。');
        });
        document.getElementById('about-link-terms').addEventListener('click', () => {
            alert('本应用无需登录和付费。个人资料仅保存在本机，不用于账号认证。本机编号只用于查询保存记录，不证明拍摄时间、地点或照片真实。时间和位置可由用户自定义。');
        });
        document.getElementById('about-link-feedback').addEventListener('click', () => {
            this.showToast('请向提供安装包的项目维护者反馈问题');
        });

        // 拼图模态框
        document.querySelector('.collage-close-btn').addEventListener('click', () => {
            this.closeCollageModal();
        });
        document.querySelectorAll('.collage-layout-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.collage-layout-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.collageLayout = parseInt(item.dataset.layout);
                this.renderCollagePreview();
            });
        });
        document.getElementById('btn-collage-add-photo').addEventListener('click', () => {
            this.addCollagePhoto();
        });
        document.getElementById('btn-collage-export').addEventListener('click', () => {
            this.exportCollage();
        });

        // 汇报模态框
        document.querySelector('.report-close-btn').addEventListener('click', () => {
            this.closeReportModal();
        });
        document.getElementById('btn-report-add-photo').addEventListener('click', () => {
            this.addReportPhoto();
        });
        document.getElementById('btn-report-export').addEventListener('click', () => {
            this.exportReport();
        });
        document.getElementById('report-title').addEventListener('input', () => {
            this.renderReportPreview();
        });
        document.getElementById('report-content').addEventListener('input', () => {
            this.renderReportPreview();
        });
    }

    updateWeather() {
        const enabled = document.getElementById('toggle-custom-weather').checked;
        const mode = this.watermark.config.weatherMode || 'auto';

        if (mode === 'manual') {
            const text = document.getElementById('custom-weather').value;
            const temp = document.getElementById('custom-temp').value;
            this.watermark.setWeather(enabled, text, temp);
        } else {
            // 自动模式：使用已缓存的天气数据
            if (enabled && this.weather.currentWeather) {
                this.watermark.setWeatherFromAuto(this.weather.currentWeather);
                this.watermark.config.weather.enabled = true;
            } else {
                this.watermark.config.weather.enabled = enabled;
            }
        }
        this.updateWatermarkPreview();
    }

    /**
     * 切换天气模式（自动/手动）
     */
    switchWeatherMode(mode) {
        this.watermark.setWeatherMode(mode);

        if (mode === 'auto') {
            document.getElementById('weather-auto-panel').classList.remove('hidden');
            document.getElementById('weather-manual-panel').classList.add('hidden');
            // 如果已有天气数据，直接更新
            if (this.weather.currentWeather) {
                this.updateAutoWeatherDisplay();
                this.updateWeather();
            } else {
                // 尝试获取天气
                this.refreshAutoWeather();
            }
        } else {
            document.getElementById('weather-auto-panel').classList.add('hidden');
            document.getElementById('weather-manual-panel').classList.remove('hidden');
            this.updateWeather();
        }
        this.saveSettings();
    }

    /**
     * 刷新自动天气获取
     */
    async refreshAutoWeather() {
        const manager = this.watermark;
        const descEl = document.getElementById('weather-auto-desc');
        const detailEl = document.getElementById('weather-auto-detail');
        const iconEl = document.getElementById('weather-auto-icon');
        const refreshBtn = document.getElementById('btn-refresh-weather');

        descEl.textContent = '正在获取天气...';
        detailEl.textContent = '请稍候';
        refreshBtn.disabled = true;

        // 尝试从已保存的坐标获取
        let lat, lon;
        const coordsEl = document.getElementById('custom-coords');
        if (coordsEl && coordsEl.value) {
            const parts = coordsEl.value.split(',');
            lat = parseFloat(parts[0]);
            lon = parseFloat(parts[1]);
        }

        // 如果没有坐标，尝试通过定位获取
        if (!lat || !lon) {
            if (DevicePlatform.native || navigator.geolocation) {
                descEl.textContent = '正在获取定位...';
                DevicePlatform.getCurrentPosition(
                    async (position) => {
                        if (manager !== this.watermark) return;
                        lat = position.coords.latitude;
                        lon = position.coords.longitude;
                        await this._fetchAndDisplayWeather(lat, lon, descEl, detailEl, iconEl, refreshBtn);
                    },
                    async (err) => {
                        if (manager !== this.watermark) return;
                        // 定位失败，尝试用wttr.in基于IP获取
                        descEl.textContent = '定位失败，尝试基于IP获取...';
                        await this._fetchWeatherByIP(descEl, detailEl, iconEl, refreshBtn);
                    },
                    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
                );
            } else {
                await this._fetchWeatherByIP(descEl, detailEl, iconEl, refreshBtn);
            }
        } else {
            await this._fetchAndDisplayWeather(lat, lon, descEl, detailEl, iconEl, refreshBtn);
        }
    }

    /**
     * 获取并显示天气
     */
    async _fetchAndDisplayWeather(lat, lon, descEl, detailEl, iconEl, refreshBtn) {
        const manager = this.watermark;
        try {
            const weather = await this.weather.getWeatherByCoords(lat, lon);
            if (manager !== this.watermark) return;
            if (weather) {
                this.watermark.setWeatherFromAuto(weather);
                this.updateAutoWeatherDisplay();
                this.updateWatermarkPreview();
                this.showToast(`天气已更新: ${weather.text} ${weather.temp}`);
            } else {
                descEl.textContent = '获取天气失败';
                detailEl.textContent = '请检查网络后重试';
            }
        } catch (err) {
            console.warn('天气获取失败:', err);
            descEl.textContent = '获取天气失败';
            detailEl.textContent = '请检查网络后重试';
        } finally {
            refreshBtn.disabled = false;
        }
    }

    /**
     * 基于IP获取天气（定位失败时的备用方案）
     */
    async _fetchWeatherByIP(descEl, detailEl, iconEl, refreshBtn) {
        const manager = this.watermark;
        try {
            // 使用wttr.in自动检测位置
            const url = 'https://wttr.in/?format=j1';
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(8000)
            });
            if (!response.ok) throw new Error('IP天气获取失败');
            const data = await response.json();
            if (manager !== this.watermark) return;
            if (data && data.current_condition && data.current_condition[0]) {
                const cur = data.current_condition[0];
                const temp = parseInt(cur.temp_C) || 27;
                const weatherDesc = (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value || '').trim();
                const text = this.weather._translateWttrDesc(weatherDesc, parseInt(cur.weatherCode));
                const weather = {
                    text: text,
                    icon: this.weather._getIconByDesc(text),
                    category: this.weather._getCategoryByDesc(text),
                    temp: `${temp}°C`,
                    tempValue: temp,
                    humidity: parseInt(cur.humidity) || null,
                    apparentTemp: parseInt(cur.FeelsLikeC) || null,
                    isDay: 1,
                    windSpeed: parseInt(cur.windspeedKmph) || null,
                    source: 'wttr.in(ip)',
                    updateTime: new Date().toISOString()
                };
                this.weather.currentWeather = weather;
                this.weather.lastFetchTime = Date.now();
                this.watermark.setWeatherFromAuto(weather);
                this.updateAutoWeatherDisplay();
                this.updateWatermarkPreview();
                this.showToast(`天气已更新: ${weather.text} ${weather.temp}`);
            }
        } catch (err) {
            console.warn('IP天气获取失败:', err);
            descEl.textContent = '获取天气失败';
            detailEl.textContent = '请检查网络或手动输入';
        } finally {
            refreshBtn.disabled = false;
        }
    }

    /**
     * 更新自动天气面板的显示
     */
    updateAutoWeatherDisplay() {
        const w = this.weather.currentWeather;
        if (!w) return;

        const iconEl = document.getElementById('weather-auto-icon');
        const descEl = document.getElementById('weather-auto-desc');
        const detailEl = document.getElementById('weather-auto-detail');

        if (iconEl) iconEl.textContent = w.icon || '🌡️';
        if (descEl) descEl.textContent = `${w.text} ${w.temp}`;

        let detail = '';
        if (w.humidity != null) detail += `湿度${w.humidity}% `;
        if (w.windSpeed != null) detail += `风速${w.windSpeed}km/h `;
        if (w.apparentTemp != null) detail += `体感${w.apparentTemp}°C `;
        detail += `| ${w.source}`;
        if (detailEl) detailEl.textContent = detail.trim();
    }

    /**
     * 定位成功后自动获取天气
     */
    async _fetchWeatherAfterLocation(lat, lon) {
        const manager = this.watermark;
        try {
            const weather = await this.weather.getWeatherByCoords(lat, lon);
            if (manager !== this.watermark) return;
            if (weather) {
                this.watermark.setWeatherFromAuto(weather);
                this.updateAutoWeatherDisplay();
                this.updateWatermarkPreview();
            }
        } catch (err) {
            console.warn('定位后天气获取失败:', err);
        }
    }

    applyZoom(zoom) {
        if (zoom === 'wide') {
            this.currentZoom = 0.5;
            this.showToast('广角模式');
        } else {
            this.currentZoom = parseFloat(zoom);
            this.showToast(`${zoom}x 变焦`);
        }
        
        // 尝试应用变焦到视频流
        if (this.camera.stream) {
            const track = this.camera.stream.getVideoTracks()[0];
            if (track) {
                const constraints = { advanced: [{ zoom: this.currentZoom }] };
                track.applyConstraints(constraints).catch(() => {
                    // 浏览器不支持硬件变焦，使用CSS缩放
                    const video = document.getElementById('camera-video');
                    video.style.transform = `scale(${this.currentZoom})`;
                    video.style.transformOrigin = 'center';
                });
            }
        }
    }

    updateWatermarkPreview() {
        if (this.photoEditSession) {
            this.renderPhotoEdit();
            return;
        }
        if (this.watermarkOverlay) {
            this.watermark.updatePreview(this.watermarkOverlay);
        }
        if (this.brandOverlay) {
            this.watermark.updateBrandPreview(this.brandOverlay);
        }
        // 更新设置面板中的照片编号预览
        const previewEl = document.getElementById('current-antifake-preview');
        if (previewEl) {
            previewEl.textContent = this.watermark.getAntiFakeCode();
        }
    }

    startTimeUpdateTimer() {
        clearInterval(this.watermarkUpdateInterval);
        clearInterval(this.weatherRefreshInterval);
        this.watermarkUpdateInterval = setInterval(() => {
            if (this.photoEditSession) return;
            if (!this.watermark.config.useCustomTime) {
                this.updateWatermarkPreview();
            }
        }, 1000);

        // 每10分钟自动刷新天气
        this.weatherRefreshInterval = setInterval(() => {
            if (this.photoEditSession) return;
            if (this.watermark.config.weatherMode !== 'manual' && 
                this.watermark.config.weather?.enabled !== false) {
                this.refreshAutoWeather();
            }
        }, 10 * 60 * 1000);
    }

    capturePhoto() {
        try {
            const captureBtn = document.getElementById('btn-capture');
            captureBtn.classList.add('capturing');
            this.flashEffect();

            // 拍照前重置变焦
            const video = document.getElementById('camera-video');
            const prevTransform = video.style.transform;
            video.style.transform = '';

            // 为本次拍照生成新的照片编号
            const antiFakeCode = this.watermark.generateAntiFakeCode();
            const captureTime = new Date().toISOString();
            const location = this.watermark.getLocation();
            const timeData = this.watermark.getCurrentTime();

            const dataUrl = this.camera.capture(this.watermark);
            this.currentPhoto = dataUrl;
            this.currentOriginalPhoto = this.camera.lastOriginalPhoto;
            this.currentWatermarkConfig = this.snapshotWatermarkConfig();
            this.currentPhotoMeta = {
                antiFakeCode: antiFakeCode,
                captureTime: captureTime,
                location: location.full || `${location.province}${location.city}${location.address}` || '未知位置',
                watermarkTime: timeData.fullDate || '',
                weather: this.watermark.getWeather(),
                weatherDetail: this.watermark.getWeatherDetail()
            };

            // 恢复变焦
            video.style.transform = prevTransform;

            document.getElementById('preview-image').src = dataUrl;
            document.getElementById('preview-modal').classList.remove('hidden');

            // 更新预览中的防伪信息
            this.updatePreviewAntiFakeInfo();

            setTimeout(() => {
                captureBtn.classList.remove('capturing');
            }, 300);

            // 拍照后生成新的照片编号供下次使用
            this.watermark.generateAntiFakeCode();
            this.updateWatermarkPreview();
        } catch (err) {
            console.error('拍照失败:', err);
            this.showToast('拍照失败: ' + err.message);
        }
    }

    /**
     * 更新预览模态框中的防伪信息
     */
    updatePreviewAntiFakeInfo() {
        const infoEl = document.getElementById('preview-antifake-info');
        if (infoEl && this.currentPhotoMeta) {
            const meta = this.currentPhotoMeta;
            infoEl.innerHTML = `
                <div class="antifake-row">
                    <span class="antifake-icon">✓</span>
                    <span class="antifake-label">真实可验</span>
                    <span class="antifake-code">${meta.antiFakeCode}</span>
                </div>
                <div class="antifake-detail">
                    <span>拍摄时间：${meta.watermarkTime || '—'}</span>
                </div>
                <div class="antifake-detail">
                    <span>拍摄位置：${this.watermark.escapeHTML(meta.location || '—')}</span>
                </div>
                <div class="antifake-detail">
                    <span>天气信息：${meta.weather || '—'}</span>
                </div>
                ${meta.weatherDetail ? `
                <div class="antifake-detail antifake-weather-detail">
                    <span>${meta.weatherDetail.icon || ''} ${meta.weatherDetail.source === 'open-meteo' ? '实时' : '实时'}数据</span>
                    ${meta.weatherDetail.humidity != null ? `<span>湿度${meta.weatherDetail.humidity}%</span>` : ''}
                    ${meta.weatherDetail.windSpeed != null ? `<span>风速${meta.weatherDetail.windSpeed}km/h</span>` : ''}
                    ${meta.weatherDetail.apparentTemp != null ? `<span>体感${meta.weatherDetail.apparentTemp}°C</span>` : ''}
                </div>` : ''}
            `;
        }
    }

    flashEffect() {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #fff; z-index: 999; pointer-events: none;
            opacity: 0.8; transition: opacity 0.3s ease;
        `;
        document.body.appendChild(flash);
        requestAnimationFrame(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 300);
        });
    }

    closePreview() {
        document.getElementById('preview-modal').classList.add('hidden');
        this.currentPhoto = null;
        this.currentPhotoMeta = null;
        this.currentOriginalPhoto = null;
        this.currentWatermarkConfig = null;
    }

    /**
     * 打开照片验真模态框
     */
    openVerifyModal() {
        const modal = document.getElementById('verify-modal');
        const resultEl = document.getElementById('verify-result');
        const inputEl = document.getElementById('verify-code-input');
        if (modal) {
            modal.classList.remove('hidden');
            this.verifyModalOpen = true;
            if (resultEl) resultEl.innerHTML = '';
            if (inputEl) inputEl.value = '';
            setTimeout(() => { if (inputEl) inputEl.focus(); }, 300);
        }
    }

    /**
     * 关闭照片验真模态框
     */
    closeVerifyModal() {
        const modal = document.getElementById('verify-modal');
        if (modal) {
            modal.classList.add('hidden');
            this.verifyModalOpen = false;
        }
    }

    /**
     * 通过照片编号验证照片
     */
    verifyPhotoByCode() {
        const inputEl = document.getElementById('verify-code-input');
        const resultEl = document.getElementById('verify-result');
        const code = inputEl ? inputEl.value.trim().toUpperCase() : '';

        if (!code) {
            this.showVerifyResult('error', '请输入照片编号', '照片编号不能为空');
            return;
        }

        if (!/^[A-Z0-9]{13}$/.test(code)) {
            this.showVerifyResult('error', '照片编号格式错误', '照片编号应为13位字符');
            return;
        }

        // 在已保存的照片中查找匹配的照片编号
        const matchedPhoto = this.photos.find(p => p.antiFakeCode === code);

        if (matchedPhoto) {
            const captureDate = new Date(matchedPhoto.timestamp);
            const dateStr = `${captureDate.getFullYear()}-${String(captureDate.getMonth() + 1).padStart(2, '0')}-${String(captureDate.getDate()).padStart(2, '0')} ${String(captureDate.getHours()).padStart(2, '0')}:${String(captureDate.getMinutes()).padStart(2, '0')}`;
            this.showVerifyResult('success', '找到照片记录', `
                <div class="verify-detail-row"><span class="verify-detail-label">照片编号</span><span class="verify-detail-value">${matchedPhoto.antiFakeCode}</span></div>
                <div class="verify-detail-row"><span class="verify-detail-label">保存时间</span><span class="verify-detail-value">${dateStr}</span></div>
                <div class="verify-detail-row"><span class="verify-detail-label">水印时间</span><span class="verify-detail-value">${matchedPhoto.watermarkTime || '—'}</span></div>
                <div class="verify-detail-row"><span class="verify-detail-label">拍摄位置</span><span class="verify-detail-value">${this.watermark.escapeHTML(matchedPhoto.location || '—')}</span></div>
            `);
            // 显示匹配的照片缩略图
            const thumbEl = document.getElementById('verify-photo-thumb');
            if (thumbEl) {
                thumbEl.innerHTML = `<img src="${matchedPhoto.dataUrl}" alt="验证照片">`;
                thumbEl.classList.remove('hidden');
            }
        } else {
            this.showVerifyResult('error', '未找到照片记录', `未找到照片编号 <strong>${code}</strong> 对应的照片记录。请确认照片编号是否正确，或该照片是否在本设备上拍摄保存。`);
            const thumbEl = document.getElementById('verify-photo-thumb');
            if (thumbEl) {
                thumbEl.innerHTML = '';
                thumbEl.classList.add('hidden');
            }
        }
    }

    /**
     * 显示验真结果
     */
    showVerifyResult(type, title, detail) {
        const resultEl = document.getElementById('verify-result');
        if (!resultEl) return;
        if (type !== 'success') {
            document.getElementById('verify-photo-thumb').classList.add('hidden');
        }
        const icon = type === 'success' ? '✓' : '✗';
        resultEl.innerHTML = `
            <div class="verify-result-card verify-${type}">
                <div class="verify-result-icon">${icon}</div>
                <div class="verify-result-title">${title}</div>
                <div class="verify-result-detail">${detail}</div>
            </div>
        `;
    }

    async savePhoto() {
        if (!this.currentPhoto || this.savingPhoto) return;
        this.savingPhoto = true;
        const button = document.getElementById('btn-save');
        button.disabled = true;
        const photo = {
            id: Date.now(),
            dataUrl: this.currentPhoto,
            originalDataUrl: this.currentOriginalPhoto || null,
            watermarkConfig: this.currentWatermarkConfig || null,
            timestamp: new Date().toISOString(),
            antiFakeCode: this.currentPhotoMeta?.antiFakeCode || '',
            location: this.currentPhotoMeta?.location || '',
            watermarkTime: this.currentPhotoMeta?.watermarkTime || '',
            weather: this.currentPhotoMeta?.weather || '',
            weatherDetail: this.currentPhotoMeta?.weatherDetail || null
        };
        try {
            await this.downloadPhoto(photo.dataUrl);
            const nextPhotos = [photo, ...this.photos].slice(0, 20);
            try {
                await this.photoStore.replace(nextPhotos);
                this.photos = nextPhotos;
                this.updateGalleryThumbnail();
                this.showToast('照片已保存到系统相册和照片记录');
            } catch (err) {
                console.error('照片记录保存失败:', err);
                this.showToast('照片已导出，但照片记录保存失败，请检查存储空间');
            }
            this.closePreview();
        } catch (err) {
            console.error('保存照片失败:', err);
            this.showToast('保存失败，请检查存储空间后重试');
        } finally {
            this.savingPhoto = false;
            button.disabled = false;
        }
    }

    async downloadPhoto(dataUrl) {
        return DevicePlatform.saveImage(dataUrl, `moxi_${Date.now()}.jpg`);
    }

    async sharePhoto() {
        if (!this.currentPhoto) return;
        try {
            await DevicePlatform.shareImage(this.currentPhoto);
        } catch (err) {
            if (err.name !== 'AbortError' && !/cancel/i.test(err.message)) {
                console.error('分享失败:', err);
                this.showToast('分享失败，请保存照片后从系统相册分享');
            }
        }
    }

    openSideMenu() {
        document.getElementById('side-menu').classList.remove('hidden');
    }

    loadProfile() {
        try {
            const saved = JSON.parse(localStorage.getItem('moxi_profile') || 'null');
            if (saved && typeof saved.nickname === 'string' && /^MX\d{6}$/.test(saved.id)) {
                return { id: saved.id, nickname: saved.nickname.slice(0, 20) || '相机用户' };
            }
            const previous = JSON.parse(localStorage.getItem('moxi_user') || 'null');
            const profile = {
                id: `MX${100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000}`,
                nickname: typeof previous?.nickname === 'string' ? previous.nickname.slice(0, 20) : '相机用户'
            };
            localStorage.setItem('moxi_profile', JSON.stringify(profile));
            return profile;
        } catch {
            return { id: 'MX100000', nickname: '相机用户' };
        }
    }

    updateProfileUI() {
        document.querySelector('.quick-left').textContent = `${this.profile.nickname} >`;
        document.querySelector('.side-menu-name').textContent = this.profile.nickname;
        document.querySelector('.side-menu-description').textContent = `用户编号：${this.profile.id}`;
        document.querySelector('.side-menu-avatar').textContent = Array.from(this.profile.nickname)[0];
        document.getElementById('profile-avatar').textContent = Array.from(this.profile.nickname)[0];
        document.getElementById('profile-user-id').textContent = this.profile.id;
    }

    openProfile() {
        document.getElementById('profile-nickname').value = this.profile.nickname;
        document.getElementById('profile-photo-count').textContent = `${this.photos.length} 张`;
        document.getElementById('profile-modal').classList.remove('hidden');
    }

    closeProfile() {
        document.getElementById('profile-modal').classList.add('hidden');
    }

    saveProfile() {
        const nickname = document.getElementById('profile-nickname').value.trim();
        if (!nickname) {
            this.showToast('请输入昵称');
            return;
        }
        const profile = { ...this.profile, nickname: nickname.slice(0, 20) };
        try {
            localStorage.setItem('moxi_profile', JSON.stringify(profile));
            this.profile = profile;
            this.updateProfileUI();
            this.closeProfile();
            this.showToast('个人资料已保存');
        } catch {
            this.showToast('保存失败，请检查设备存储');
        }
    }

    closeSideMenu() {
        document.getElementById('side-menu').classList.add('hidden');
    }

    openGallery() {
        const modal = document.getElementById('gallery-modal');
        const content = document.getElementById('gallery-content');
        
        if (this.photos.length === 0) {
            content.innerHTML = `
                <div class="gallery-empty">
                    <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor" opacity="0.3">
                        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                    </svg>
                    <p>暂无照片</p>
                </div>
            `;
        } else {
            content.innerHTML = '<div class="gallery-grid">' + 
                this.photos.map(photo => `
                    <div class="gallery-item" data-id="${photo.id}">
                        <img src="${photo.dataUrl}" alt="照片">
                        ${photo.antiFakeCode ? `<div class="gallery-antifake-badge">✓ ${photo.antiFakeCode.substring(0, 6)}...</div>` : ''}
                        <div class="delete-icon" data-id="${photo.id}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </div>
                    </div>
                `).join('') + 
            '</div>';

            content.querySelectorAll('.gallery-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-icon')) {
                        e.stopPropagation();
                        this.deletePhoto(parseInt(item.dataset.id));
                    } else {
                        const id = parseInt(item.dataset.id);
                        if (this.currentMode === 'edit') {
                            this.closeGallery();
                            this.editSelectedPhoto(this.photos.find(photo => photo.id === id));
                        } else {
                            this.viewPhoto(id);
                        }
                    }
                });
            });
        }

        modal.classList.remove('hidden');
    }

    closeGallery() {
        document.getElementById('gallery-modal').classList.add('hidden');
        if (this.currentMode === 'edit') this.switchToPhotoMode();
    }

    viewPhoto(id) {
        const photo = this.photos.find(p => p.id === id);
        if (photo) {
            this.currentPhoto = photo.dataUrl;
            this.currentOriginalPhoto = photo.originalDataUrl || null;
            this.currentWatermarkConfig = photo.watermarkConfig || null;
            this.currentPhotoMeta = {
                antiFakeCode: photo.antiFakeCode || '',
                captureTime: photo.timestamp || '',
                location: photo.location || '',
                watermarkTime: photo.watermarkTime || '',
                weather: photo.weather || ''
            };
            document.getElementById('preview-image').src = photo.dataUrl;
            document.getElementById('preview-modal').classList.remove('hidden');
            this.updatePreviewAntiFakeInfo();
            this.closeGallery();
        }
    }

    async deletePhoto(id) {
        const nextPhotos = this.photos.filter(p => p.id !== id);
        try {
            await this.photoStore.replace(nextPhotos);
            this.photos = nextPhotos;
            this.updateGalleryThumbnail();
            this.openGallery();
            this.showToast('已删除照片记录，系统相册照片保留');
        } catch (err) {
            this.showToast('删除失败，请重试');
        }
    }

    async clearGallery() {
        if (this.photos.length === 0) {
            this.showToast('相册已为空');
            return;
        }
        if (!confirm('清空照片记录？系统相册照片仍保留，编号将无法在本机查询。')) return;
        try {
            await this.photoStore.replace([]);
            this.photos = [];
            this.updateGalleryThumbnail();
            this.openGallery();
            this.showToast('已清空照片记录');
        } catch (err) {
            this.showToast('清空失败，请重试');
        }
    }

    updateGalleryThumbnail() {
        const thumbnail = document.querySelector('.gallery-thumbnail');
        if (this.photos.length > 0) {
            thumbnail.innerHTML = `<img src="${this.photos[0].dataUrl}" alt="最近照片">`;
        } else {
            thumbnail.innerHTML = `
                <svg viewBox="0 0 24 24" width="24" height="24" fill="#999">
                    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
            `;
        }
    }

    getCurrentLocation() {
        const manager = this.watermark;
        const statusEl = document.getElementById('location-status');
        
        if (!DevicePlatform.native && !navigator.geolocation) {
            statusEl.textContent = '您的浏览器不支持定位功能';
            statusEl.className = 'location-status error';
            return;
        }

        statusEl.textContent = '正在获取定位...';
        statusEl.className = 'location-status loading';

        DevicePlatform.getCurrentPosition(
            (position) => {
                if (manager !== this.watermark) return;
                const lat = position.coords.latitude.toFixed(6);
                const lon = position.coords.longitude.toFixed(6);
                
                this.reverseGeocode(lat, lon).then(address => {
                    if (manager !== this.watermark) return;
                    this._applyLocationResult(lat, lon, address, manager, position.coords.accuracy);
                }).catch(() => {
                    if (manager !== this.watermark) return;
                    this._applyLocationResult(lat, lon, null, manager, position.coords.accuracy);
                });
            },
            (err) => {
                if (manager !== this.watermark) return;
                let msg = '定位失败';
                switch (err.code) {
                    case 1: msg = '定位权限被拒绝'; break;
                    case 2: msg = '定位不可用'; break;
                    case 3: msg = '定位超时'; break;
                }
                statusEl.textContent = msg + '，请手动输入位置';
                statusEl.className = 'location-status error';
                // 定位失败时尝试IP定位
                this._fallbackIPLocation(manager);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
        );
    }

    /**
     * 应用定位结果到水印（自动模式专用）
     * 关键：自动设置 useCustomLocation = true 并勾选开关
     */
    _applyLocationResult(lat, lon, address, manager = this.cameraWatermark, accuracy = null) {
        if (manager !== this.watermark) return;
        // 填充表单
        document.getElementById('custom-coords').value = `${lat},${lon}`;
        document.getElementById('custom-province').value = address?.province || '';
        document.getElementById('custom-city').value = address?.city || '';
        document.getElementById('custom-address').value = address?.address || '';

        // 关键修复：启用自定义位置，否则 getLocation() 返回空
        this.watermark.updateConfig('useCustomLocation', true);

        // 同步UI开关状态
        const toggle = document.getElementById('toggle-custom-location');
        if (toggle && !toggle.checked) {
            toggle.checked = true;
            document.getElementById('location-settings').classList.remove('hidden');
        }

        this.updateCustomLocation();
        const statusEl = document.getElementById('location-status');
        const precision = Number.isFinite(accuracy) && accuracy > 0 ? `（定位精度约${Math.round(accuracy)}米）` : '';
        statusEl.textContent = address?.source === 'ip'
            ? '仅获取到大致城市，请补充街道、门牌和地点名称。'
            : (address ? `已获取地址${precision}，可继续补充楼栋和房间号。` : '已获取坐标，未查到地址，请手动补充。');
        statusEl.className = address && address.source !== 'ip' ? 'location-status success' : 'location-status';

        // 自动获取天气
        if (this.watermark.config.weatherMode === 'auto') {
            this._fetchWeatherAfterLocation(parseFloat(lat), parseFloat(lon));
        }
    }

    /**
     * 启动时自动获取定位（静默模式，不显示状态）
     */
    autoGetLocation() {
        const manager = this.cameraWatermark;
        if (this.photoEditSession || manager.config.useCustomLocation) return;
        if (!DevicePlatform.native && !navigator.geolocation) {
            // 浏览器不支持定位，直接走IP定位
            this._fallbackIPLocation(manager, true);
            return;
        }

        // 先尝试低精度快速定位
        DevicePlatform.getCurrentPosition(
            (position) => {
                if (manager !== this.watermark || manager.config.useCustomLocation) return;
                const lat = position.coords.latitude.toFixed(6);
                const lon = position.coords.longitude.toFixed(6);

                this.reverseGeocode(lat, lon).then(address => {
                    if (manager !== this.watermark || manager.config.useCustomLocation) return;
                    this._applyLocationResult(lat, lon, address, manager, position.coords.accuracy);
                }).catch(() => {
                    if (manager !== this.watermark || manager.config.useCustomLocation) return;
                    this._applyLocationResult(lat, lon, null, manager, position.coords.accuracy);
                });
            },
            (err) => {
                if (manager !== this.watermark || manager.config.useCustomLocation) return;
                console.warn('自动定位失败:', err.message);
                // 尝试高精度定位
                this._retryHighAccuracyLocation(manager);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
        );
    }

    /**
     * 高精度定位重试
     */
    _retryHighAccuracyLocation(manager = this.cameraWatermark) {
        if (manager !== this.watermark || manager.config.useCustomLocation) return;
        if (!DevicePlatform.native && !navigator.geolocation) {
            this._fallbackIPLocation(manager, true);
            return;
        }

        DevicePlatform.getCurrentPosition(
            (position) => {
                if (manager !== this.watermark || manager.config.useCustomLocation) return;
                const lat = position.coords.latitude.toFixed(6);
                const lon = position.coords.longitude.toFixed(6);

                this.reverseGeocode(lat, lon).then(address => {
                    if (manager !== this.watermark || manager.config.useCustomLocation) return;
                    this._applyLocationResult(lat, lon, address, manager, position.coords.accuracy);
                }).catch(() => {
                    if (manager !== this.watermark || manager.config.useCustomLocation) return;
                    this._applyLocationResult(lat, lon, null, manager, position.coords.accuracy);
                });
            },
            (err) => {
                if (manager !== this.watermark || manager.config.useCustomLocation) return;
                console.warn('高精度定位也失败:', err.message);
                // 最终备用：IP定位
                this._fallbackIPLocation(manager, true);
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
        );
    }

    /**
     * IP定位备用方案（通过免费API获取大致位置）
     */
    async _fallbackIPLocation(manager = this.cameraWatermark, automatic = false) {
        const canApply = () => manager === this.watermark && (!automatic || !manager.config.useCustomLocation);
        if (!canApply()) return;
        // 方案1: ipapi.co
        try {
            const response = await fetch('https://ipapi.co/json/', {
                method: 'GET',
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) throw new Error('ipapi response not ok');
            const data = await response.json();
            if (!canApply()) return;
            if (data && data.latitude && data.longitude) {
                const lat = data.latitude.toFixed(4);
                const lon = data.longitude.toFixed(4);
                const address = data.city ? {
                    province: data.region || '',
                    city: data.city || '',
                    address: '', source: 'ip'
                } : null;
                this._applyLocationResult(lat, lon, address, manager);
                console.log('IP定位成功(ipapi.co):', data.city);
                return;
            }
        } catch (err) {
            console.warn('ipapi.co定位失败:', err.message);
        }

        if (!canApply()) return;
        // 方案2: ipinfo.io
        try {
            const resp2 = await fetch('https://ipinfo.io/json', {
                method: 'GET',
                signal: AbortSignal.timeout(6000)
            });
            if (!resp2.ok) throw new Error('ipinfo response not ok');
            const data2 = await resp2.json();
            if (!canApply()) return;
            if (data2 && data2.loc) {
                const [lat, lon] = data2.loc.split(',');
                const fLat = parseFloat(lat).toFixed(4);
                const fLon = parseFloat(lon).toFixed(4);
                const address = data2.city ? {
                    province: data2.region || '',
                    city: data2.city || '',
                    address: '', source: 'ip'
                } : null;
                this._applyLocationResult(fLat, fLon, address, manager);
                console.log('IP定位成功(ipinfo.io):', data2.city);
                return;
            }
        } catch (err2) {
            console.warn('ipinfo.io定位也失败:', err2.message);
        }

        // 无可用定位时保留手动位置，避免把默认城市当作实测位置。
        this.showToast('无法获取定位，请手动输入位置');
    }

    async reverseGeocode(lat, lon) {
        try {
            const parameters = new URLSearchParams({
                format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '18',
                addressdetails: '1', namedetails: '1', 'accept-language': 'zh-CN'
            });
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?${parameters}`,
                { method: 'GET', headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
            );
            if (!response.ok) return null;
            return LocationFormatter.fromGeocoder(await response.json());
        } catch (err) {
            console.warn('逆地理编码失败:', err);
        }
        return null;
    }

    updateCustomLocation() {
        const province = document.getElementById('custom-province').value;
        const city = document.getElementById('custom-city').value;
        const address = document.getElementById('custom-address').value;
        const coords = document.getElementById('custom-coords').value;
        this.watermark.setCustomLocation(province, city, address, coords);
        this.updateWatermarkPreview();
        this.saveSettings();
    }

    getTodayDate() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    applySettingsInputs() {
        const value = id => document.getElementById(id).value;
        const checked = id => document.getElementById(id).checked;
        this.watermark.updateConfigs({
            template: document.querySelector('.template-item.active')?.dataset.template || this.watermark.config.template,
            position: value('watermark-position'), fontSize: value('watermark-font-size'), opacity: Number(value('watermark-opacity')),
            useCustomTime: checked('toggle-custom-time'), useCustomLocation: checked('toggle-custom-location'),
            showCoordinates: checked('toggle-coordinates'), useCustomText: checked('toggle-custom-text'), customText: value('custom-text'),
            brandEnabled: checked('toggle-brand'), antiFakeEnabled: checked('toggle-antifake'),
            brandName: value('brand-name'), brandSubtitle: value('brand-subtitle'), brandBadge: value('brand-badge'), brandCodeLabel: value('brand-code-label')
        });
        if (checked('toggle-custom-time')) this.watermark.setCustomTime(value('custom-date'), value('custom-time'));
        if (checked('toggle-custom-location')) this.watermark.setCustomLocation(value('custom-province'), value('custom-city'), value('custom-address'), value('custom-coords'));
        this.watermark.config.weather.enabled = checked('toggle-custom-weather');
        if (this.watermark.config.weatherMode === 'manual') this.watermark.setWeather(checked('toggle-custom-weather'), value('custom-weather'), value('custom-temp'));
        this.updateWatermarkPreview();
    }

    toggleSettingsPanel(show) {
        const panel = document.getElementById('settings-panel');
        this.settingsPanelOpen = show;
        document.getElementById('btn-save-watermark-settings').textContent = this.photoEditSession ? '保存图片副本' : '保存设置';
        panel.classList.toggle('hidden', !show);
        panel.classList.toggle('camera-settings', !this.photoEditSession && show);
        document.querySelector('.app').classList.toggle('camera-settings-open', !this.photoEditSession && show);
        document.getElementById('photo-editor-modal').classList.toggle('settings-open', !!this.photoEditSession && show);
    }

    /* ========== 关于页面 ========== */
    openAboutModal() {
        document.getElementById('about-modal').classList.remove('hidden');
    }

    closeAboutModal() {
        document.getElementById('about-modal').classList.add('hidden');
    }

    /* ========== 边拍边拼 ========== */
    openCollageModal() {
        document.getElementById('collage-modal').classList.remove('hidden');
        this.collagePhotos = new Array(this.collageLayout).fill(null);
        this.renderCollagePreview();
    }

    closeCollageModal() {
        document.getElementById('collage-modal').classList.add('hidden');
        this.switchToPhotoMode();
    }

    addCollagePhoto() {
        // 找到第一个空位
        const emptyIndex = this.collagePhotos.indexOf(null);
        if (emptyIndex === -1) {
            this.showToast('已填满，请先移除照片');
            return;
        }
        // 拍照填充
        try {
            const video = document.getElementById('camera-video');
            const prevTransform = video.style.transform;
            video.style.transform = '';
            const dataUrl = this.camera.capture(this.watermark);
            video.style.transform = prevTransform;
            this.collagePhotos[emptyIndex] = dataUrl;
            this.renderCollagePreview();
            this.showToast('已添加照片');
        } catch (err) {
            this.showToast('拍照失败: ' + err.message);
        }
    }

    removeCollagePhoto(index) {
        this.collagePhotos[index] = null;
        this.renderCollagePreview();
    }

    renderCollagePreview() {
        const preview = document.getElementById('collage-preview');
        const count = this.collageLayout;
        // 确保数组长度匹配
        while (this.collagePhotos.length < count) this.collagePhotos.push(null);
        this.collagePhotos = this.collagePhotos.slice(0, count);

        let html = '<div class="collage-grid">';
        for (let i = 0; i < count; i++) {
            const photo = this.collagePhotos[i];
            if (photo) {
                html += `<div class="collage-slot" data-index="${i}">`;
                html += `<img src="${photo}" alt="照片${i + 1}">`;
                html += `<div class="collage-slot-remove" data-index="${i}">&times;</div>`;
                html += `</div>`;
            } else {
                html += `<div class="collage-slot" data-index="${i}"><span class="collage-slot-empty">点击添加</span></div>`;
            }
        }
        html += '</div>';
        preview.innerHTML = html;

        // 绑定移除事件
        preview.querySelectorAll('.collage-slot-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeCollagePhoto(parseInt(btn.dataset.index));
            });
        });
        // 绑定空位点击事件
        preview.querySelectorAll('.collage-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                const idx = parseInt(slot.dataset.index);
                if (this.collagePhotos[idx] === null) {
                    this.addCollagePhoto();
                }
            });
        });
    }

    exportCollage() {
        const filledCount = this.collagePhotos.filter(p => p !== null).length;
        if (filledCount === 0) {
            this.showToast('请先添加照片');
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const targetW = 1080;
        const targetH = 1080;
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, targetW, targetH);

        const count = this.collageLayout;
        const gap = 8;
        const images = [];
        let loaded = 0;

        this.collagePhotos.forEach((photo, i) => {
            if (photo) {
                const img = new Image();
                img.onload = () => {
                    images[i] = img;
                    loaded++;
                    if (loaded === filledCount) {
                        drawCollage();
                    }
                };
                img.src = photo;
            } else {
                loaded++;
                if (loaded === filledCount) {
                    drawCollage();
                }
            }
        });

        const self = this;
        function drawCollage() {
            const slots = self.getCollageSlots(count, targetW, targetH, gap);
            slots.forEach((slot, i) => {
                if (images[i]) {
                    const img = images[i];
                    const imgRatio = img.width / img.height;
                    const slotRatio = slot.w / slot.h;
                    let sx = 0, sy = 0, sw = img.width, sh = img.height;
                    if (imgRatio > slotRatio) {
                        sw = img.height * slotRatio;
                        sx = (img.width - sw) / 2;
                    } else {
                        sh = img.width / slotRatio;
                        sy = (img.height - sh) / 2;
                    }
                    ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
                } else {
                    ctx.fillStyle = '#f0f0f0';
                    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
                }
            });

            // 添加水印
            self.watermark.drawWatermarkOnCanvas(ctx, targetW, targetH);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            self.currentPhoto = dataUrl;
            self.currentOriginalPhoto = null;
            self.currentWatermarkConfig = null;
            self.currentPhotoMeta = {
                antiFakeCode: self.watermark.getAntiFakeCode(),
                captureTime: new Date().toISOString(),
                location: '',
                watermarkTime: '',
                weather: self.watermark.getWeather(),
                weatherDetail: self.watermark.getWeatherDetail()
            };
            document.getElementById('preview-image').src = dataUrl;
            document.getElementById('preview-modal').classList.remove('hidden');
            self.updatePreviewAntiFakeInfo();
            self.closeCollageModal();
            self.showToast('拼图已生成');
        }
    }

    getCollageSlots(count, w, h, gap) {
        const slots = [];
        if (count === 2) {
            const halfW = (w - gap * 3) / 2;
            slots.push({ x: gap, y: gap, w: halfW, h: h - gap * 2 });
            slots.push({ x: gap * 2 + halfW, y: gap, w: halfW, h: h - gap * 2 });
        } else if (count === 3) {
            const halfW = (w - gap * 3) / 2;
            const halfH = (h - gap * 3) / 2;
            slots.push({ x: gap, y: gap, w: w - gap * 2, h: halfH });
            slots.push({ x: gap, y: gap * 2 + halfH, w: halfW, h: halfH });
            slots.push({ x: gap * 2 + halfW, y: gap * 2 + halfH, w: halfW, h: halfH });
        } else if (count === 4) {
            const halfW = (w - gap * 3) / 2;
            const halfH = (h - gap * 3) / 2;
            slots.push({ x: gap, y: gap, w: halfW, h: halfH });
            slots.push({ x: gap * 2 + halfW, y: gap, w: halfW, h: halfH });
            slots.push({ x: gap, y: gap * 2 + halfH, w: halfW, h: halfH });
            slots.push({ x: gap * 2 + halfW, y: gap * 2 + halfH, w: halfW, h: halfH });
        }
        return slots;
    }

    /* ========== 拼图汇报 ========== */
    openReportModal() {
        document.getElementById('report-modal').classList.remove('hidden');
        this.reportPhotos = [];
        this.renderReportPhotos();
        this.renderReportPreview();
    }

    closeReportModal() {
        document.getElementById('report-modal').classList.add('hidden');
        this.switchToPhotoMode();
    }

    addReportPhoto() {
        if (this.photos.length === 0) {
            this.showToast('请先拍照保存到相册');
            return;
        }
        // 添加最近的照片
        const photo = this.photos[this.reportPhotos.length % this.photos.length];
        this.reportPhotos.push(photo.dataUrl);
        this.renderReportPhotos();
        this.renderReportPreview();
    }

    removeReportPhoto(index) {
        this.reportPhotos.splice(index, 1);
        this.renderReportPhotos();
        this.renderReportPreview();
    }

    renderReportPhotos() {
        const grid = document.getElementById('report-photos-grid');
        if (this.reportPhotos.length === 0) {
            grid.innerHTML = '<div class="report-photos-empty">点击"添加"从相册选择照片</div>';
            return;
        }
        let html = '';
        this.reportPhotos.forEach((photo, i) => {
            html += `<div class="report-photo-item">`;
            html += `<img src="${photo}" alt="照片${i + 1}">`;
            html += `<div class="report-photo-remove" data-index="${i}">&times;</div>`;
            html += `</div>`;
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.report-photo-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                this.removeReportPhoto(parseInt(btn.dataset.index));
            });
        });
    }

    renderReportPreview() {
        const canvas = document.getElementById('report-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const title = document.getElementById('report-title').value || '工作汇报';
        const content = document.getElementById('report-content').value || '';
        const photoCount = this.reportPhotos.length;

        const w = 750;
        const headerH = 100;
        const photoSize = 220;
        const photoGap = 10;
        const photosPerRow = 3;
        const photoRows = Math.ceil(Math.max(photoCount, 1) / photosPerRow);
        const photosH = photoRows * photoSize + (photoRows - 1) * photoGap + 20;
        const contentH = content ? 80 : 0;
        const footerH = 60;
        const h = headerH + photosH + contentH + footerH + 40;

        canvas.width = w;
        canvas.height = h;

        // 背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // 标题栏
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, headerH);
        ctx.fillStyle = '#00d4ff';
        ctx.fillRect(0, headerH - 4, w, 4);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, w / 2, headerH / 2 + 8);
        ctx.font = '13px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        ctx.fillText(dateStr, w / 2, headerH / 2 + 32);

        // 照片区
        let y = headerH + 20;
        if (photoCount > 0) {
            const loadedImages = [];
            let loaded = 0;
            this.reportPhotos.forEach((photo, i) => {
                const img = new Image();
                img.onload = () => {
                    loadedImages[i] = img;
                    loaded++;
                    if (loaded === photoCount) {
                        drawPhotos();
                    }
                };
                img.src = photo;
            });

            const self = this;
            function drawPhotos() {
                const photoW = (w - 40 - (photosPerRow - 1) * photoGap) / photosPerRow;
                loadedImages.forEach((img, i) => {
                    const row = Math.floor(i / photosPerRow);
                    const col = i % photosPerRow;
                    const px = 20 + col * (photoW + photoGap);
                    const py = y + row * (photoSize + photoGap);
                    const imgRatio = img.width / img.height;
                    let sx = 0, sy = 0, sw = img.width, sh = img.height;
                    if (imgRatio > photoW / photoSize) {
                        sw = img.height * (photoW / photoSize);
                        sx = (img.width - sw) / 2;
                    } else {
                        sh = img.width / (photoW / photoSize);
                        sy = (img.height - sh) / 2;
                    }
                    ctx.drawImage(img, sx, sy, sw, sh, px, py, photoW, photoSize);
                });
                drawContent();
            }
        } else {
            ctx.fillStyle = '#f5f5f5';
            ctx.fillRect(20, y, w - 40, 150);
            ctx.fillStyle = '#ccc';
            ctx.font = '14px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无照片', w / 2, y + 80);
            drawContent();
        }

        function drawContent() {
            let cy = y + photoRows * (photoSize + photoGap) + 10;
            if (content) {
                ctx.fillStyle = '#333';
                ctx.font = '15px -apple-system, sans-serif';
                ctx.textAlign = 'left';
                self.wrapText(ctx, content, 20, cy + 20, w - 40, 22);
                cy += contentH;
            }

            // 底部
            ctx.fillStyle = '#f5f5f5';
            ctx.fillRect(0, h - footerH, w, footerH);
            ctx.fillStyle = '#999';
            ctx.font = '12px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('今日水印相机 · 真实可验', w / 2, h - footerH / 2 + 4);
            ctx.font = '11px -apple-system, sans-serif';
            ctx.fillStyle = '#ccc';
            ctx.fillText('© 2026 今日水印相机', w / 2, h - 20);
        }
    }

    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const chars = text.split('');
        let line = '';
        let currentY = y;
        for (let i = 0; i < chars.length; i++) {
            const testLine = line + chars[i];
            if (ctx.measureText(testLine).width > maxWidth && line) {
                ctx.fillText(line, x, currentY);
                line = chars[i];
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, currentY);
    }

    exportReport() {
        const canvas = document.getElementById('report-canvas');
        if (!canvas) return;
        const title = document.getElementById('report-title').value.trim();
        if (!title) {
            this.showToast('请输入汇报标题');
            return;
        }
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        this.currentPhoto = dataUrl;
        this.currentOriginalPhoto = null;
        this.currentWatermarkConfig = null;
        this.currentPhotoMeta = {
            antiFakeCode: this.watermark.getAntiFakeCode(),
            captureTime: new Date().toISOString(),
            location: '',
            watermarkTime: '',
            weather: this.watermark.getWeather(),
            weatherDetail: this.watermark.getWeatherDetail()
        };
        document.getElementById('preview-image').src = dataUrl;
        document.getElementById('preview-modal').classList.remove('hidden');
        this.updatePreviewAntiFakeInfo();
        this.closeReportModal();
        this.showToast('汇报图已生成');
    }

    /* ========== 照片编辑模式 ========== */
    snapshotWatermarkConfig(manager = this.watermark) {
        const config = JSON.parse(JSON.stringify(manager.getConfig()));
        config.customTime = { ...manager.getCurrentTime() };
        config.useCustomTime = true;
        config.weatherMode = 'manual';
        return config;
    }

    closeEditSource() {
        document.getElementById('edit-source-modal').classList.add('hidden');
        this.pendingLegacyPhoto = null;
        this.switchToPhotoMode();
    }

    editSelectedPhoto(photo) {
        if (!photo?.dataUrl) return;
        if (!photo.originalDataUrl) {
            this.pendingLegacyPhoto = photo;
            document.getElementById('edit-source-description').textContent = '这张照片未保留无水印原图，已有水印无法直接替换。请选择对应原图，或在这张照片上添加新水印。';
            document.getElementById('btn-select-local-photo').classList.add('hidden');
            document.getElementById('btn-overlay-legacy-photo').classList.remove('hidden');
            document.getElementById('edit-source-modal').classList.remove('hidden');
            return;
        }
        this.startPhotoEditor(photo);
    }

    async importEditPhoto(input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            this.showToast('请选择 JPG、PNG 或 WebP 照片');
            return;
        }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            await this.startPhotoEditor({ originalDataUrl: dataUrl });
        } catch (err) {
            console.error('导入照片失败:', err);
            this.showToast('无法读取照片，请重新选择');
        }
    }

    async startPhotoEditor(photo, field = null) {
        if (this.photoEditSession || this.loadingPhotoEditor) return;
        this.loadingPhotoEditor = true;
        try {
            const image = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('照片无法解码'));
                image.src = photo.originalDataUrl;
            });
            this.closeEditSource();
            const manager = new WatermarkManager();
            manager.updateConfigs(photo.watermarkConfig || this.snapshotWatermarkConfig(this.cameraWatermark));
            this.photoEditSession = {
                image, manager, originalDataUrl: photo.originalDataUrl,
                captureTime: photo.captureTime || photo.timestamp || new Date().toISOString(),
                canvas: document.createElement('canvas')
            };
            this.loadSettings(manager.getConfig());
            document.getElementById('settings-panel').classList.add('photo-edit-settings');
            document.querySelector('#settings-panel h2').textContent = '修改水印';
            document.getElementById('btn-close-settings').textContent = '完成';
            document.getElementById('photo-editor-modal').classList.remove('hidden');
            this.renderPhotoEdit();
            this.toggleSettingsPanel(false);
            if (field) this.openWatermarkTextEditor(field);
        } catch (err) {
            console.error('打开编辑失败:', err);
            this.showToast('无法打开照片，请重新选择');
            if (this.photoEditSession) this.closePhotoEditor();
        } finally {
            this.loadingPhotoEditor = false;
        }
    }

    renderPhotoEdit() {
        const session = this.photoEditSession;
        if (!session) return;
        const { canvas, image, manager } = session;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d', { desynchronized: false, willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        session.textRegions = manager.drawWatermarkOnCanvas(ctx, canvas.width, canvas.height);
        session.dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        document.getElementById('photo-editor-image').src = session.dataUrl;
        document.getElementById('current-antifake-preview').textContent = manager.getAntiFakeCode();
        this.updatePhotoTextTargets('photo-editor');
    }

    updatePhotoTextTargets(mode) {
        const image = document.getElementById(`${mode}-image`);
        const targets = document.getElementById(`${mode}-text-targets`);
        targets.replaceChildren();
        if (!image.getAttribute('src') || image.parentElement.clientHeight === 0) return;
        let width, height, regions;
        if (mode === 'photo-editor') {
            const session = this.photoEditSession;
            if (!session) return;
            ({ width, height } = session.canvas);
            regions = session.textRegions;
        } else {
            if (!this.currentOriginalPhoto || !this.currentWatermarkConfig || !image.naturalWidth) return;
            width = image.naturalWidth; height = image.naturalHeight;
            const manager = new WatermarkManager();
            manager.updateConfigs(this.currentWatermarkConfig);
            manager.currentAntiFakeCode = this.currentPhotoMeta?.antiFakeCode || '';
            regions = manager.drawWatermarkOnCanvas(document.createElement('canvas').getContext('2d'), width, height);
        }
        if (!width || !height) return;
        const rect = image.getBoundingClientRect();
        const parent = image.parentElement.getBoundingClientRect();
        const ratio = Math.min(rect.width / width, rect.height / height);
        const left = rect.left - parent.left + (rect.width - width * ratio) / 2;
        const top = rect.top - parent.top + (rect.height - height * ratio) / 2;
        const labels = { time: '日期和时间', date: '日期和时间', weather: '天气和温度', location: '地址', coordinates: '经纬度',
            text: '备注文字', brandName: '品牌名称', brandSubtitle: '品牌副标题', brandBadge: '徽章文字', brandCodeLabel: '编号前缀' };
        for (const region of regions || []) {
            if (region.width <= 0 || !labels[region.field]) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'watermark-text-target';
            button.dataset.field = region.field;
            button.setAttribute('aria-label', `修改${labels[region.field]}`);
            button.style.cssText = `left:${left + region.x * ratio}px;top:${top + region.y * ratio}px;width:${region.width * ratio}px;height:${region.height * ratio}px;`;
            targets.append(button);
        }
    }

    openWatermarkTextEditor(field) {
        if (!this.photoEditSession || this.savingEditedPhoto) return;
        if (this.editingWatermarkField) this.closeWatermarkTextEditor();
        const manager = this.photoEditSession.manager;
        const config = manager.getConfig(), time = manager.getCurrentTime(), location = manager.getLocation();
        const locationFields = LocationFormatter.editableFields(location);
        const definitions = {
            time: ['日期和时间', [['date', '日期', time.date, 'date'], ['time', '时间', time.time, 'time']]],
            date: ['日期和时间', [['date', '日期', time.date, 'date'], ['time', '时间', time.time, 'time']]],
            weather: ['天气和温度', [['weather', '天气', config.weather.text], ['temp', '温度', config.weather.temp]]],
            location: ['地址', [
                ['province', '省份/直辖市', locationFields.province],
                ['city', '城市/区县', locationFields.city],
                ['address', '街道、门牌和地点名称', locationFields.address, 'textarea']
            ]],
            coordinates: ['经纬度', [['coords', '纬度,经度', location.coords]]],
            text: ['备注文字', [['text', '备注文字', config.useCustomText ? config.customText : '工作记录', 'text', 20]]],
            brandName: ['品牌名称', [['value', '品牌名称', config.brandName, 'text', 8]]],
            brandSubtitle: ['品牌副标题', [['value', '品牌副标题', config.brandSubtitle, 'text', 6]]],
            brandBadge: ['徽章文字', [['value', '徽章文字', config.brandBadge, 'text', 6]]],
            brandCodeLabel: ['编号前缀', [['value', '编号前缀', config.brandCodeLabel, 'text', 4]]]
        };
        const definition = definitions[field];
        if (!definition) return;
        this.watermarkTextDraft = { config: JSON.parse(JSON.stringify(config)), weatherDetail: manager.weatherDetail };
        this.toggleSettingsPanel(false);
        this.editingWatermarkField = field;
        document.getElementById('watermark-text-title').textContent = `修改${definition[0]}`;
        const fields = document.getElementById('watermark-text-fields');
        fields.replaceChildren();
        for (const [name, label, value, type = 'text', maxLength] of definition[1]) {
            const group = document.createElement('div'); group.className = 'input-group';
            const caption = document.createElement('label'); caption.textContent = label;
            const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
            if (type !== 'textarea') input.type = type;
            input.name = name; input.id = `watermark-edit-${name}`; input.value = value || '';
            caption.htmlFor = input.id;
            if (maxLength) input.maxLength = maxLength;
            if (['date', 'time', 'coords'].includes(name)) input.required = true;
            group.append(caption, input); fields.append(group);
        }
        document.getElementById('watermark-text-help').textContent = field === 'brandCodeLabel'
            ? '修改编号前缀；保存副本时自动生成新的照片编号。'
            : field === 'coordinates' ? '例如：32.189802,118.714729，先填纬度，再填经度。'
            : field === 'location' ? '地址分项填写，详细地址可补充楼栋、楼层和房间号；经纬度保持原值。'
            : ['time', 'date', 'weather'].includes(field) ? '星期随日期自动更新。' : '';
        document.getElementById('watermark-text-modal').classList.remove('hidden');
        fields.querySelector('input,textarea')?.focus();
    }

    closeWatermarkTextEditor(commit = false) {
        if (!commit && this.watermarkTextDraft && this.photoEditSession) {
            this.photoEditSession.manager.updateConfigs(this.watermarkTextDraft.config);
            this.photoEditSession.manager.weatherDetail = this.watermarkTextDraft.weatherDetail;
            this.loadSettings(this.watermarkTextDraft.config);
            this.renderPhotoEdit();
        }
        this.watermarkTextDraft = null;
        document.getElementById('watermark-text-modal').classList.add('hidden');
        this.editingWatermarkField = null;
    }

    applyWatermarkTextEdit(commit = true) {
        const session = this.photoEditSession, field = this.editingWatermarkField;
        if (!session || !field) return;
        const values = Object.fromEntries(new FormData(document.getElementById('watermark-text-form')));
        const manager = session.manager;
        if (field === 'time' || field === 'date') {
            if (!values.date || !values.time) return;
            manager.setCustomTime(values.date, values.time);
            manager.updateConfig('useCustomTime', true);
        } else if (field === 'weather') {
            manager.setWeather(true, values.weather.trim(), values.temp.trim());
            manager.setWeatherMode('manual');
        } else if (field === 'location') {
            manager.setCustomLocation(values.province.trim(), values.city.trim(), values.address.trim(), manager.getLocation().coords);
            manager.updateConfig('useCustomLocation', true);
        } else if (field === 'coordinates') {
            if (!manager.formatCoordinates(values.coords)) {
                if (!commit) return;
                document.getElementById('watermark-edit-coords').setCustomValidity('请输入有效的纬度和经度');
                document.getElementById('watermark-edit-coords').reportValidity();
                document.getElementById('watermark-edit-coords').oninput = event => event.target.setCustomValidity('');
                return;
            }
            manager.updateConfigs({ useCustomLocation: true, customLocation: { ...manager.getLocation(), coords: values.coords.trim() } });
        } else if (field === 'text') manager.updateConfigs({ useCustomText: true, customText: values.text });
        else manager.updateConfig(field, values.value);
        this.loadSettings(manager.getConfig());
        this.renderPhotoEdit();
        if (commit) this.closeWatermarkTextEditor(true);
    }

    closePhotoEditor() {
        if (this.savingEditedPhoto) return;
        this.closeWatermarkTextEditor();
        this.photoEditSession = null;
        document.getElementById('photo-editor-modal').classList.add('hidden');
        document.getElementById('photo-editor-image').removeAttribute('src');
        document.getElementById('settings-panel').classList.remove('photo-edit-settings');
        document.querySelector('#settings-panel h2').textContent = '水印设置';
        document.getElementById('btn-close-settings').textContent = '×';
        this.toggleSettingsPanel(false);
        this.loadSettings(this.cameraWatermark.getConfig());
        this.updateWatermarkPreview();
        this.switchToPhotoMode();
    }

    async saveEditedPhoto() {
        const session = this.photoEditSession;
        if (!session || this.savingEditedPhoto) return;
        this.savingEditedPhoto = true;
        const button = document.getElementById('btn-save-photo-edit');
        button.disabled = true;
        document.getElementById('btn-cancel-photo-edit').disabled = true;
        document.getElementById('settings-panel').inert = true;
        document.getElementById('btn-photo-edit-settings').disabled = true;
        try {
            this.renderPhotoEdit();
            const location = session.manager.getLocation();
            const photo = {
                id: Date.now(), dataUrl: session.dataUrl,
                originalDataUrl: session.originalDataUrl,
                watermarkConfig: this.snapshotWatermarkConfig(session.manager),
                timestamp: new Date().toISOString(), captureTime: session.captureTime,
                antiFakeCode: session.manager.getAntiFakeCode(),
                location: location.full || `${location.province}${location.city}${location.address}`,
                watermarkTime: session.manager.getCurrentTime().fullDate || '',
                weather: session.manager.getWeather(), weatherDetail: session.manager.getWeatherDetail()
            };
            await this.downloadPhoto(photo.dataUrl);
            const nextPhotos = [photo, ...this.photos].slice(0, 20);
            try {
                await this.photoStore.replace(nextPhotos);
                this.photos = nextPhotos;
                this.updateGalleryThumbnail();
                this.showToast('编辑后的照片已保存，原照片保留');
            } catch (err) {
                console.error('照片记录保存失败:', err);
                this.showToast('照片已导出，但照片记录保存失败，请检查存储空间');
            }
            this.savingEditedPhoto = false;
            this.closePhotoEditor();
            this.closePreview();
        } catch (err) {
            console.error('编辑照片保存失败:', err);
            this.showToast('保存失败，编辑内容保留，请重试');
        } finally {
            this.savingEditedPhoto = false;
            button.disabled = false;
            document.getElementById('btn-cancel-photo-edit').disabled = false;
            document.getElementById('settings-panel').inert = false;
            document.getElementById('btn-photo-edit-settings').disabled = false;
        }
    }

    openPhotoEditMode() {
        this.pendingLegacyPhoto = null;
        document.getElementById('edit-source-description').textContent = '选择本机照片或无水印原图，修改后保存副本。系统相册照片中已有的水印不会自动去除。';
        document.getElementById('btn-select-local-photo').classList.remove('hidden');
        document.getElementById('btn-select-local-photo').disabled = this.photos.length === 0;
        document.getElementById('btn-overlay-legacy-photo').classList.add('hidden');
        document.getElementById('edit-source-modal').classList.remove('hidden');
    }

    switchToPhotoMode() {
        this.currentMode = 'photo';
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.mode-tab[data-mode="photo"]').classList.add('active');
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.remove('hidden', 'fade-out');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => { toast.classList.add('hidden'); }, 300);
        }, 2000);
    }

    async loadPhotosFromStorage() {
        await this.photoStore.open();
        this.photos = await this.photoStore.read();
        const legacy = localStorage.getItem('moxi_photos');
        if (legacy) {
            const oldPhotos = JSON.parse(legacy);
            const merged = new Map([...oldPhotos, ...this.photos].map(photo => [photo.id, photo]));
            const photos = [...merged.values()].sort((a, b) => b.id - a.id).slice(0, 20);
            await this.photoStore.replace(photos);
            this.photos = photos;
            localStorage.removeItem('moxi_photos');
        }
    }

    saveSettings() {
        try {
            localStorage.setItem('moxi_settings', JSON.stringify(this.cameraWatermark.getConfig()));
            return true;
        } catch (err) {
            console.warn('保存设置失败:', err);
            return false;
        }
    }

    loadSettings(config = null) {
        try {
            const saved = config ? JSON.stringify(config) : localStorage.getItem('moxi_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                const migrateBadge = !settings.brandBadge || settings.brandBadge === '本机记录';
                if (migrateBadge) settings.brandBadge = '真实可验';
                this.watermark.updateConfigs(settings);
                if (!config && migrateBadge) this.saveSettings();
                if (settings.template) {
                    document.querySelectorAll('.template-item').forEach(i => i.classList.remove('active'));
                    const item = document.querySelector(`.template-item[data-template="${settings.template}"]`);
                    if (item) item.classList.add('active');
                }
                if (settings.position) document.getElementById('watermark-position').value = settings.position;
                if (settings.fontSize) document.getElementById('watermark-font-size').value = settings.fontSize;
                if (settings.opacity) document.getElementById('watermark-opacity').value = settings.opacity;
                document.getElementById('toggle-custom-time').checked = !!settings.useCustomTime;
                document.getElementById('time-settings').classList.toggle('hidden', !settings.useCustomTime);
                if (settings.customTime) {
                    document.getElementById('custom-date').value = settings.customTime.date;
                    document.getElementById('custom-time').value = settings.customTime.time;
                }
                document.getElementById('toggle-custom-location').checked = !!settings.useCustomLocation;
                document.getElementById('toggle-coordinates').checked = settings.showCoordinates !== false;
                document.getElementById('location-settings').classList.toggle('hidden', !settings.useCustomLocation);
                if (settings.customLocation) {
                    const locationFields = LocationFormatter.editableFields(settings.customLocation);
                    for (const [field, key] of [['province', 'province'], ['city', 'city'], ['address', 'address'], ['coords', 'coords']]) {
                        document.getElementById(`custom-${field}`).value = locationFields[key] || '';
                    }
                }
                if (!settings.customLocation) {
                    for (const field of ['province', 'city', 'address', 'coords']) {
                        document.getElementById(`custom-${field}`).value = '';
                    }
                }
                document.getElementById('toggle-custom-text').checked = !!settings.useCustomText;
                document.getElementById('text-settings').classList.toggle('hidden', !settings.useCustomText);
                document.getElementById('custom-text').value = settings.customText || '';
                if (settings.weather) {
                    document.getElementById('toggle-custom-weather').checked = settings.weather.enabled;
                    document.getElementById('custom-weather').value = settings.weather.text || '';
                    document.getElementById('custom-temp').value = settings.weather.temp || '';
                }
                // 恢复天气模式
                if (settings.weatherMode) {
                    this.watermark.setWeatherMode(settings.weatherMode);
                    document.querySelectorAll('.weather-mode-tab').forEach(t => t.classList.remove('active'));
                    const tab = document.querySelector(`.weather-mode-tab[data-mode="${settings.weatherMode}"]`);
                    if (tab) tab.classList.add('active');
                    if (settings.weatherMode === 'auto') {
                        document.getElementById('weather-auto-panel')?.classList.remove('hidden');
                        document.getElementById('weather-manual-panel')?.classList.add('hidden');
                    } else {
                        document.getElementById('weather-auto-panel')?.classList.add('hidden');
                        document.getElementById('weather-manual-panel')?.classList.remove('hidden');
                    }
                }
                // 恢复防伪设置
                const brandToggle = document.getElementById('toggle-brand');
                const antifakeToggle = document.getElementById('toggle-antifake');
                if (brandToggle) brandToggle.checked = settings.brandEnabled !== false;
                if (antifakeToggle) antifakeToggle.checked = settings.antiFakeEnabled !== false;
                document.getElementById('brand-name').value = settings.brandName || '今日水印';
                document.getElementById('brand-subtitle').value = settings.brandSubtitle || '相机';
                document.getElementById('brand-badge').value = settings.brandBadge || '真实可验';
                document.getElementById('brand-code-label').value = settings.brandCodeLabel || '编号';
                document.getElementById('weather-settings').classList.toggle('hidden', settings.weather?.enabled === false);
            }
        } catch (err) {
            console.warn('加载设置失败:', err);
        }
    }
}

const app = new App();

window.addEventListener('DOMContentLoaded', async () => {
    try {
        await app.loadPhotosFromStorage();
    } catch (err) {
        console.error(err);
        app.showToast('本地相册读取失败，请检查设备存储');
    }
    app.loadSettings();
    await app.init();
    app.updateGalleryThumbnail();
    if (DevicePlatform.native) {
        await DevicePlatform.plugin('App').addListener('backButton', () => {
            if (app.savingEditedPhoto) return;
            if (app.editingWatermarkField) {
                app.closeWatermarkTextEditor();
                return;
            }
            if (!document.getElementById('edit-source-modal').classList.contains('hidden')) {
                app.closeEditSource();
                return;
            }
            if (app.settingsPanelOpen) {
                app.toggleSettingsPanel(false);
                return;
            }
            if (app.photoEditSession) {
                app.closePhotoEditor();
                return;
            }
            if (!document.getElementById('preview-modal').classList.contains('hidden')) {
                app.closePreview();
                return;
            }
            if (!document.getElementById('gallery-modal').classList.contains('hidden')) {
                app.closeGallery();
                return;
            }
            const modal = document.querySelector('.preview-modal:not(.hidden), .gallery-modal:not(.hidden), .verify-modal:not(.hidden), .about-modal:not(.hidden), .profile-modal:not(.hidden), .collage-modal:not(.hidden), .report-modal:not(.hidden)');
            if (modal) {
                modal.classList.add('hidden');
                app.verifyModalOpen = false;
            } else if (app.settingsPanelOpen) {
                app.toggleSettingsPanel(false);
            } else if (!document.getElementById('side-menu').classList.contains('hidden')) {
                app.closeSideMenu();
            } else {
                DevicePlatform.plugin('App').exitApp();
            }
        });
    }
});

window.addEventListener('beforeunload', () => {
    app.camera.destroy();
    app.saveSettings();
    if (app.watermarkUpdateInterval) clearInterval(app.watermarkUpdateInterval);
    if (app.weatherRefreshInterval) clearInterval(app.weatherRefreshInterval);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (app.watermarkUpdateInterval) clearInterval(app.watermarkUpdateInterval);
        if (app.weatherRefreshInterval) clearInterval(app.weatherRefreshInterval);
    } else {
        if (app.camera.isReady()) app.startTimeUpdateTimer();
        // 页面恢复可见时，如果天气缓存过期则刷新
        if (!app.photoEditSession && app.watermark.config.weatherMode !== 'manual' &&
            app.weather.currentWeather &&
            (Date.now() - app.weather.lastFetchTime) > app.weather.cacheDuration) {
            app.refreshAutoWeather();
        }
    }
});
