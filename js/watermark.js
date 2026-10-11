/**
 * 今日水印相机 - 水印模块
 * 负责水印的生成、渲染和管理
 */

class WatermarkManager {
    constructor() {
        this.config = {
            template: 'default',
            position: 'bottom-left',
            fontSize: 'medium',
            opacity: 90,
            customTime: null,
            customLocation: null,
            customText: '',
            weather: { enabled: true, text: '', temp: '' },
            weatherMode: 'auto',
            useCustomTime: false,
            useCustomLocation: false,
            showCoordinates: true,
            useCustomText: false,
            brandEnabled: true,
            brandName: '今日水印',
            brandSubtitle: '相机',
            brandBadge: '真实可验',
            brandCodeLabel: '编号',
            antiFakeEnabled: true
        };

        this.currentAntiFakeCode = '';
        this.locationIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle; margin-right: 3px; flex-shrink: 0;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
        this.shieldIcon = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" style="flex-shrink: 0;"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>`;

        // 初始生成防伪码
        this.generateAntiFakeCode();
    }

    updateConfig(key, value) {
        this.config[key] = value;
    }

    updateConfigs(updates) {
        Object.assign(this.config, updates);
    }

    /**
     * 生成13位防伪码（大写字母+数字混合）
     * 格式: 13位随机字符
     */
    generateAntiFakeCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 13; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.currentAntiFakeCode = code;
        return code;
    }

    /**
     * 获取当前防伪码
     */
    getAntiFakeCode() {
        return this.currentAntiFakeCode;
    }

    /**
     * 生成品牌防伪水印HTML（右下角）
     * 今日水印 → 相机 [真实可验] → 编号 XXXXXXXXXXXXX
     */
    generateBrandHTML() {
        if (!this.config.brandEnabled) return '';

        let html = '';
        // 品牌名称
        html += `<div class="brand-name">${this.escapeHTML(this.config.brandName || '今日水印')}</div>`;
        // 本地编号不提供真实性验证。
        html += `<div class="brand-subtitle">${this.escapeHTML(this.config.brandSubtitle || '相机')} <span class="brand-verify-badge">${this.escapeHTML(this.config.brandBadge || '真实可验')}</span></div>`;
        
        // 防伪码
        if (this.config.antiFakeEnabled) {
            html += `<div class="brand-antifake"><span class="antifake-label">${this.escapeHTML(this.config.brandCodeLabel || '编号')}</span> ${this.currentAntiFakeCode}</div>`;
        }
        
        return html;
    }

    /**
     * 更新品牌防伪水印预览
     */
    updateBrandPreview(brandElement) {
        if (!brandElement) return;
        if (this.config.brandEnabled) {
            brandElement.classList.remove('hidden');
            brandElement.style.opacity = this.config.opacity / 100;
            brandElement.innerHTML = this.generateBrandHTML();
            const top = ['bottom-right', 'bottom-center'].includes(this.config.position);
            const padding = this.config.template === 'default' ? 10 : 20;
            const parent = brandElement.parentElement;
            const ratio = parent?.clientWidth && parent?.clientHeight
                ? Math.min(parent.clientWidth, parent.clientHeight) / 414 : 1;
            const scale = this.getFontScale() * ratio;
            brandElement.style.right = `${padding * ratio}px`;
            brandElement.style.top = top ? `${padding * ratio}px` : 'auto';
            brandElement.style.bottom = top ? 'auto' : `${padding * ratio}px`;
            for (const [selector, size] of [['.brand-name', 20], ['.brand-subtitle', 13], ['.brand-verify-badge', 13], ['.brand-antifake', 8]]) {
                brandElement.querySelector(selector)?.style.setProperty('font-size', `${size * scale}px`);
            }
            const ctx = document.createElement('canvas').getContext('2d');
            for (const [selector, text, size, limit] of [
                ['.brand-name', this.config.brandName || '今日水印', 20, 130],
                ['.brand-subtitle', this.config.brandSubtitle || '相机', 13, 75]
            ]) {
                ctx.font = `700 ${size}px Arial, sans-serif`;
                brandElement.querySelector(selector).style.fontSize = `${size * scale * Math.min(1, limit / ctx.measureText(text).width)}px`;
            }
            brandElement.style.setProperty('--brand-scale', scale);
        } else {
            brandElement.classList.add('hidden');
        }
    }

    /**
     * 获取星期几
     */
    getWeekDay(date) {
        const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return weekDays[date.getDay()];
    }

    /**
     * 获取当前时间字符串
     */
    getCurrentTime() {
        if (this.config.useCustomTime && this.config.customTime) {
            return this.config.customTime;
        }
        const now = new Date();
        return {
            time: this.formatTime(now),
            date: this.formatDate(now),
            fullDate: this.formatFullDate(now),
            weekDay: this.getWeekDay(now)
        };
    }

    formatTime(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }

    formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    formatFullDate(date) {
        return `${this.formatDate(date)} ${this.formatTime(date)}`;
    }

    /**
     * 获取天气信息
     */
    getWeather() {
        if (this.config.weather.enabled) {
            const w = this.config.weather;
            return `${w.text} ${w.temp}`.trim();
        }
        return '';
    }

    /**
     * 获取位置信息
     */
    getLocation() {
        if (this.config.useCustomLocation && this.config.customLocation) {
            return this.config.customLocation;
        }
        return {
            province: '',
            city: '',
            address: '',
            full: '',
            coords: ''
        };
    }

    /**
     * 生成水印HTML
     */
    generateWatermarkHTML() {
        const timeData = this.getCurrentTime();
        const location = this.getLocation();
        const weather = this.getWeather();
        const template = this.config.template;

        switch (template) {
            case 'default':
                return this.generateDefaultTemplate(timeData, location, weather);
            case 'simple':
                return this.generateSimpleTemplate(timeData, location, weather);
            case 'modern':
                return this.generateModernTemplate(timeData, location, weather);
            case 'professional':
                return this.generateProfessionalTemplate(timeData, location, weather);
            default:
                return this.generateDefaultTemplate(timeData, location, weather);
        }
    }

    /**
     * 经典模板 - 匹配截图样式
     * 大号时间 | 日期 \n 星期 天气 温度 \n 地点
     */
    generateDefaultTemplate(timeData, location, weather) {
        return this.classicPreviewHTML(this.getClassicLayout(414, timeData, location, weather));
    }

    formatCoordinates(coords) {
        const match = String(coords || '').trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
        if (!match) return '';
        let lat = Number(match[1]), lon = Number(match[3]);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return '';
        if (match[2]) lat = Math.abs(lat) * (match[2].toUpperCase() === 'S' ? -1 : 1);
        if (match[4]) lon = Math.abs(lon) * (match[4].toUpperCase() === 'W' ? -1 : 1);
        return `${Math.abs(lat).toFixed(6)}°${lat < 0 ? 'S' : 'N'},${Math.abs(lon).toFixed(6)}°${lon < 0 ? 'W' : 'E'}`;
    }

    classicLocation(location) {
        const full = location.full || LocationFormatter.join([location.province, location.city, location.address]);
        const area = LocationFormatter.join([location.province, location.city]);
        if (area && full.startsWith(area) && full.length > area.length) return `${area} · ${full.slice(area.length)}`;
        return full;
    }

    /** Shared measured layout keeps the live preview and saved photo in the same proportions. */
    getClassicLayout(w, time = this.getCurrentTime(), location = this.getLocation(), weather = this.getWeather(), h = Infinity, scale = this.getFontScale()) {
        const ctx = document.createElement('canvas').getContext('2d');
        const maxWidth = Math.max(40, w - 20);
        const font = (size, weight = 400) => `${weight} ${size}px Arial, sans-serif`;
        const measure = (text, size, weight = 400) => {
            ctx.font = font(size, weight);
            return ctx.measureText(text).width;
        };
        const weatherText = `${time.weekDay}${weather ? '  ' + weather : ''}`;
        const stretch = 0.88;
        const headerNaturalWidth = measure(time.time, 52) * stretch + 18 + Math.max(measure(time.date, 20), measure(weatherText, 20));
        const headerScale = Math.min(scale, maxWidth / headerNaturalWidth);
        const timeWidth = measure(time.time, 52 * headerScale) * stretch;
        const detailX = timeWidth + 18 * headerScale;
        const headerWidth = headerNaturalWidth * headerScale;
        const headerHeight = 52 * headerScale;
        const rows = [
            { kind: 'time', text: time.time, x: 0, y: 0, width: timeWidth, height: headerHeight, size: 52 * headerScale, stretch },
            { kind: 'divider', x: timeWidth + 9 * headerScale, y: 0, width: 3 * headerScale, height: headerHeight },
            { kind: 'date', text: time.date, x: detailX, y: 0, width: headerWidth - detailX, height: 26 * headerScale, size: 20 * headerScale },
            { kind: 'weather', text: weatherText, x: detailX, y: 28 * headerScale, width: headerWidth - detailX, height: 24 * headerScale, size: 20 * headerScale }
        ];
        let height = headerHeight;
        let width = headerWidth;
        const addParagraph = (kind, text, size, available, gap) => {
            if (!text) return 0;
            ctx.font = font(size);
            const lines = this.wrapCanvasText(ctx, text, available);
            const rowWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
            const rowHeight = lines.length * size * 1.3;
            height += gap;
            rows.push({ kind, text, lines, x: 0, y: height, width: rowWidth, height: rowHeight, size });
            height += rowHeight;
            width = Math.max(width, rowWidth);
            return rowHeight + gap;
        };
        addParagraph('location', this.classicLocation(location), 18 * scale, maxWidth, 12 * scale);
        const reserveBrand = this.config.brandEnabled && this.config.position === 'bottom-left';
        const footerWidth = Math.max(40, maxWidth - (reserveBrand ? this.getBrandReserve() : 0));
        const footerStart = height;
        const coordinates = this.config.showCoordinates !== false ? this.formatCoordinates(location.coords) : '';
        if (coordinates) {
            const padding = 8 * scale;
            let text = `经纬度： ${coordinates}`;
            if (measure(text, 18 * scale) > footerWidth - padding * 2) text = text.replace(',', ',\n');
            addParagraph('coordinates', text, 18 * scale, footerWidth - padding * 2, 12 * scale);
            const row = rows[rows.length - 1];
            row.width += padding * 2;
            row.height += padding * 2;
            row.padding = padding;
            height += padding * 2;
            width = Math.max(width, row.width);
        }
        if (this.config.useCustomText) addParagraph('text', this.config.customText, 12 * scale, footerWidth, 6 * scale);
        if (reserveBrand) height = Math.max(height, footerStart + 54 * this.getFontScale());
        const right = this.config.position.endsWith('right');
        const center = this.config.position.endsWith('center');
        for (const row of rows) {
            if (['time', 'divider', 'date', 'weather'].includes(row.kind)) {
                row.x += right ? width - headerWidth : center ? (width - headerWidth) / 2 : 0;
            } else {
                row.x = right ? width - row.width : center ? (width - row.width) / 2 : 0;
            }
        }
        const brandHeight = this.config.brandEnabled && this.config.position !== 'bottom-left' ? 54 * this.getFontScale() + 10 : 0;
        if (height > h - 20 - brandHeight && scale > 0.05) {
            return this.getClassicLayout(w, time, location, weather, h, scale * 0.8);
        }
        return { rows, width, height };
    }

    classicPreviewHTML(layout, ratio = 1) {
        return layout.rows.map(row => {
            const style = `left:${row.x * ratio}px;top:${row.y * ratio}px;width:${row.width * ratio / (row.stretch || 1)}px;height:${row.height * ratio}px;`;
            if (row.kind === 'divider') return `<span class="wm-divider" style="${style}"></span>`;
            const lines = row.lines || [row.text];
            const padding = (row.padding || 0) * ratio;
            const transform = row.stretch ? `transform:scaleX(${row.stretch});transform-origin:left top;` : '';
            return `<div class="wm-${row.kind}" style="${style}${transform}font-size:${row.size * ratio}px;line-height:${row.size * 1.3 * ratio}px;padding:${padding}px;">${this.escapeHTML(lines.join('\n'))}</div>`;
        }).join('');
    }

    drawClassicOnCanvas(ctx, w, h, regions) {
        const layout = this.getClassicLayout(w, this.getCurrentTime(), this.getLocation(), this.getWeather(), h);
        const right = this.config.position.endsWith('right');
        const center = this.config.position.endsWith('center');
        const x = right ? w - 10 - layout.width : center ? (w - layout.width) / 2 : 10;
        const y = this.config.position.startsWith('bottom') ? h - 10 - layout.height : 10;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (const row of layout.rows) {
            if (row.kind !== 'divider') regions?.push({ field: row.kind, x: x + row.x, y: y + row.y, width: row.width, height: row.height });
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 2;
            ctx.shadowOffsetY = 1;
            if (row.kind === 'divider') {
                ctx.shadowColor = 'transparent';
                ctx.fillStyle = '#ffd23f';
                ctx.fillRect(x + row.x, y + row.y, row.width, row.height);
                continue;
            }
            if (row.kind === 'coordinates') {
                ctx.shadowColor = 'transparent';
                ctx.fillStyle = 'rgba(190,190,180,0.24)';
                this._drawRoundRect(ctx, x + row.x, y + row.y, row.width, row.height, 3 * this.getFontScale());
                ctx.fill();
                ctx.shadowColor = 'rgba(0,0,0,0.55)';
            }
            ctx.font = `400 ${row.size}px Arial, sans-serif`;
            ctx.fillStyle = '#fff';
            const padding = row.padding || 0;
            const lines = row.lines || [row.text];
            if (row.kind === 'time') {
                ctx.save();
                ctx.translate(x + row.x, y + row.y);
                ctx.scale(row.stretch, 1);
                ctx.fillText(row.text, 0, 0);
                ctx.shadowColor = 'transparent';
                const pattern = this.getTimePattern(row.text, row.size);
                ctx.drawImage(pattern, 0, 0, pattern.width / 3, pattern.height / 3);
                ctx.restore();
                continue;
            }
            lines.forEach((line, i) => {
                ctx.fillText(line, x + row.x + padding, y + row.y + padding + i * row.size * 1.3);
            });
        }
    }

    getTimePattern(text, size) {
        const key = `${text}:${size}`;
        if (this.timePattern?.key === key) return this.timePattern.canvas;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.font = `400 ${size}px Arial, sans-serif`;
        canvas.width = Math.ceil((ctx.measureText(text).width + 2) * 3);
        canvas.height = Math.ceil(size * 1.3 * 3);
        ctx.scale(3, 3);
        ctx.strokeStyle = 'rgba(178,235,242,.7)';
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        for (let y = 0; y < size * 1.3; y += 1.6) {
            ctx.moveTo(0, y);
            for (let x = 0; x < canvas.width / 3; x += 6) {
                ctx.bezierCurveTo(x + 2, y - .6, x + 4, y + .6, x + 6, y);
            }
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.font = `400 ${size}px Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(text, 0, 0);
        this.timePattern = { key, canvas };
        return canvas;
    }

    getStackedLayout(w, h = Infinity, time = this.getCurrentTime(), location = this.getLocation(), weather = this.getWeather(), template = this.config.template, scale = this.getFontScale()) {
        const ctx = document.createElement('canvas').getContext('2d');
        const reserve = this.config.brandEnabled && this.config.position === 'bottom-left' ? this.getBrandReserve() : 0;
        const inset = template === 'professional' ? 9 : 0;
        const maxWidth = Math.max(40, w - 40 - reserve - inset);
        const rows = [];
        let height = 0, width = 0;
        const addText = (kind, text, size, weight = 400, color = '#fff') => {
            if (!text) return;
            size *= scale;
            ctx.font = `${weight} ${size}px Arial, sans-serif`;
            const lines = this.wrapCanvasText(ctx, text, maxWidth);
            const rowWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
            const rowHeight = lines.length * size * 1.3;
            rows.push({ kind, text, lines, size, weight, color, x: inset, y: height, width: rowWidth, height: rowHeight });
            height += rowHeight + 3 * scale;
            width = Math.max(width, rowWidth);
        };
        if (template === 'modern') {
            rows.push({ kind: 'badge', text: '今日', size: 13 * scale, weight: 700, color: '#000', x: inset, y: 0, width: 42 * scale, height: 21 * scale });
            height += 25 * scale;
            width = 42 * scale;
        }
        addText('time', template === 'professional' ? time.fullDate : time.time,
            template === 'professional' ? 16 : template === 'simple' ? 34 : 30,
            template === 'professional' ? 600 : template === 'simple' ? 300 : 700);
        if (template !== 'professional') addText('date', time.date, 15);
        if (weather) addText('weather', `${time.weekDay} ${weather}`, 13);
        addText('location', location.full || LocationFormatter.join([location.province, location.city, location.address]), 13);
        const coordinates = this.config.showCoordinates !== false ? this.formatCoordinates(location.coords) : '';
        if (coordinates) addText('coordinates', `经纬度： ${coordinates}`, 13);
        const note = this.config.useCustomText ? this.config.customText : '';
        addText('text', note || (template === 'professional' ? '工作记录' : ''), 12, template === 'professional' ? 500 : 400, template === 'professional' ? '#00d4ff' : '#fff');
        const brandHeight = this.config.brandEnabled && this.config.position !== 'bottom-left' ? 54 * this.getFontScale() + 10 : 0;
        if (height > h - 40 - brandHeight && scale > 0.05) return this.getStackedLayout(w, h, time, location, weather, template, scale * 0.8);
        const right = this.config.position.endsWith('right'), center = this.config.position.endsWith('center');
        for (const row of rows) row.x += right ? width - row.width : center ? (width - row.width) / 2 : 0;
        if (inset) rows.push({ kind: 'divider', x: 0, y: 0, width: 2, height, color: '#00d4ff' });
        return { rows, width: width + inset, height };
    }

    stackedPreviewHTML(layout, ratio = 1) {
        return layout.rows.map(row => {
            const badge = row.kind === 'badge';
            const style = `left:${row.x * ratio}px;top:${row.y * ratio}px;width:${row.width * ratio}px;height:${row.height * ratio}px;font-size:${(row.size || 0) * ratio}px;line-height:${(row.size || 0) * 1.3 * ratio}px;font-weight:${row.weight || 400};color:${row.color || '#fff'};`;
            if (row.kind === 'divider') return `<span class="wm-divider" style="${style}background:${row.color};"></span>`;
            return `<div class="wm-${row.kind}" style="${style}${badge ? `background:#00d4ff;padding:${3 * ratio}px ${7 * ratio}px;` : ''}">${this.escapeHTML((row.lines || [row.text]).join('\n'))}</div>`;
        }).join('');
    }

    generateSimpleTemplate(time, location, weather) {
        return this.stackedPreviewHTML(this.getStackedLayout(414, Infinity, time, location, weather, 'simple'));
    }

    generateModernTemplate(time, location, weather) {
        return this.stackedPreviewHTML(this.getStackedLayout(414, Infinity, time, location, weather, 'modern'));
    }

    generateProfessionalTemplate(time, location, weather) {
        return this.stackedPreviewHTML(this.getStackedLayout(414, Infinity, time, location, weather, 'professional'));
    }

    /**
     * 更新水印预览
     */
    updatePreview(overlayElement) {
        if (!overlayElement) return;

        overlayElement.className = `watermark-overlay template-${this.config.template} measured-watermark`;
        this.applyPosition(overlayElement);
        const parent = overlayElement.parentElement;
        const ratio = parent?.clientWidth && parent?.clientHeight ? Math.min(parent.clientWidth, parent.clientHeight) / 414 : 1;
        const w = (parent?.clientWidth || 414) / ratio, h = (parent?.clientHeight || Infinity) / ratio;
        const classic = this.config.template === 'default';
        const layout = classic ? this.getClassicLayout(w, this.getCurrentTime(), this.getLocation(), this.getWeather(), h) : this.getStackedLayout(w, h);
        const padding = (classic ? 10 : 20) * ratio;
        overlayElement.style.maxWidth = 'none';
        overlayElement.style.width = `${layout.width * ratio}px`;
        overlayElement.style.height = `${layout.height * ratio}px`;
        overlayElement.style.opacity = this.config.opacity / 100;
        if (this.config.position.startsWith('top')) overlayElement.style.top = `${padding}px`;
        else overlayElement.style.bottom = `${padding}px`;
        if (this.config.position.endsWith('left')) overlayElement.style.left = `${padding}px`;
        if (this.config.position.endsWith('right')) overlayElement.style.right = `${padding}px`;
        overlayElement.innerHTML = classic ? this.classicPreviewHTML(layout, ratio) : this.stackedPreviewHTML(layout, ratio);
    }

    applyPosition(overlayElement) {
        overlayElement.style.top = 'auto';
        overlayElement.style.bottom = 'auto';
        overlayElement.style.left = 'auto';
        overlayElement.style.right = 'auto';
        overlayElement.style.textAlign = '';
        overlayElement.style.transform = '';

        const positionMap = {
            'bottom-left': { bottom: '20px', left: '20px', right: '', top: '', textAlign: 'left' },
            'bottom-right': { bottom: '20px', right: '20px', left: '', top: '', textAlign: 'right' },
            'bottom-center': { bottom: '20px', left: '50%', right: '', top: '', transform: 'translateX(-50%)', textAlign: 'center' },
            'top-left': { top: '70px', left: '20px', bottom: '', right: '', textAlign: 'left' },
            'top-right': { top: '70px', right: '20px', bottom: '', left: '', textAlign: 'right' }
        };

        const pos = positionMap[this.config.position];
        if (pos) {
            Object.keys(pos).forEach(key => {
                if (pos[key] !== '') {
                    overlayElement.style[key] = pos[key];
                }
            });
        }
    }

    applyFontSize(overlayElement) {
        const sizeMap = { small: 0.8, medium: 1.0, large: 1.25 };
        const scale = sizeMap[this.config.fontSize] || 1.0;

        const timeEl = overlayElement.querySelector('.wm-time');
        const dateEl = overlayElement.querySelector('.wm-date');
        const weatherEl = overlayElement.querySelector('.wm-weather');
        const locEl = overlayElement.querySelector('.wm-location');
        const textEl = overlayElement.querySelector('.wm-text');
        const dividerEl = overlayElement.querySelector('.wm-divider');

        const template = this.config.template;
        const baseTimeSize = template === 'professional' ? 16 : (template === 'simple' ? 34 : (template === 'modern' ? 30 : 38));

        if (timeEl) timeEl.style.fontSize = `${baseTimeSize * scale}px`;
        if (dateEl) dateEl.style.fontSize = `${15 * scale}px`;
        if (weatherEl) weatherEl.style.fontSize = `${13 * scale}px`;
        if (locEl) locEl.style.fontSize = `${13 * scale}px`;
        if (textEl) textEl.style.fontSize = `${12 * scale}px`;
        if (dividerEl) dividerEl.style.height = `${28 * scale}px`;
    }

    /** Use the same visual scale as a 414px-wide camera preview, at any photo resolution. */
    drawWatermarkOnCanvas(ctx, canvasWidth, canvasHeight) {
        const ratio = Math.min(canvasWidth, canvasHeight) / 414;
        const w = canvasWidth / ratio;
        const h = canvasHeight / ratio;
        ctx.save();
        ctx.scale(ratio, ratio);
        ctx.globalAlpha = this.config.opacity / 100;
        const regions = [];
        this.drawMainOnCanvas(ctx, w, h, regions);
        if (this.config.brandEnabled) this.drawBrandOnCanvas(ctx, w, h, regions);
        ctx.restore();
        return regions.map(region => ({ ...region, x: region.x * ratio, y: region.y * ratio, width: region.width * ratio, height: region.height * ratio }));
    }

    getFontScale() {
        return { small: 0.8, medium: 1, large: 1.25 }[this.config.fontSize] || 1;
    }

    getBrandReserve() {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '700 13px Arial, sans-serif';
        const badgeWidth = ctx.measureText(this.config.brandBadge || '真实可验').width + 10;
        const subtitleWidth = Math.min(75, ctx.measureText(this.config.brandSubtitle || '相机').width);
        return (Math.max(130, badgeWidth + subtitleWidth + 5) + 10) * this.getFontScale();
    }

    escapeHTML(text) {
        const element = document.createElement('span');
        element.textContent = text;
        return element.innerHTML;
    }

    wrapCanvasText(ctx, text, maxWidth) {
        const lines = [];
        for (const paragraph of String(text).split('\n')) {
            let line = '';
            for (const character of paragraph) {
                if (line && ctx.measureText(line + character).width > maxWidth) {
                    lines.push(line);
                    line = character;
                } else {
                    line += character;
                }
            }
            lines.push(line);
        }
        return lines;
    }

    drawMainOnCanvas(ctx, w, h, regions) {
        if (this.config.template === 'default') return this.drawClassicOnCanvas(ctx, w, h, regions);
        const layout = this.getStackedLayout(w, h);
        const right = this.config.position.endsWith('right'), center = this.config.position.endsWith('center');
        const x = right ? w - 20 - layout.width : center ? (w - layout.width) / 2 : 20;
        const y = this.config.position.startsWith('bottom') ? h - 20 - layout.height : 20;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        for (const row of layout.rows) {
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            if (row.kind === 'divider' || row.kind === 'badge') {
                ctx.shadowColor = 'transparent';
                ctx.fillStyle = '#00d4ff';
                ctx.fillRect(x + row.x, y + row.y, row.width, row.height);
                if (row.kind === 'divider') continue;
            } else regions?.push({ field: row.kind, x: x + row.x, y: y + row.y, width: row.width, height: row.height });
            ctx.font = `${row.weight} ${row.size}px Arial, sans-serif`;
            ctx.fillStyle = row.color;
            const badgeScale = row.size / 13;
            (row.lines || [row.text]).forEach((line, i) => ctx.fillText(line,
                x + row.x + (row.kind === 'badge' ? 7 * badgeScale : 0),
                y + row.y + (row.kind === 'badge' ? 3 * badgeScale : 0) + i * row.size * 1.3));
        }
    }

    drawBrandOnCanvas(ctx, w, h, regions) {
        const scale = this.getFontScale();
        const padding = this.config.template === 'default' ? 10 : 20;
        const rightX = w - padding;
        const moveToTop = ['bottom-right', 'bottom-center'].includes(this.config.position);
        const height = 24 * scale + 20 * scale + (this.config.antiFakeEnabled ? 10 * scale : 0);
        let y = moveToTop ? padding : h - padding - height;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        const name = this.config.brandName || '今日水印';
        ctx.font = '700 20px Arial, sans-serif';
        const nameSize = 20 * Math.min(1, 130 / ctx.measureText(name).width);
        ctx.font = `700 ${nameSize * scale}px Arial, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(name, rightX, y);
        regions?.push({ field: 'brandName', x: rightX - ctx.measureText(name).width, y, width: ctx.measureText(name).width, height: 24 * scale });
        y += 24 * scale;
        ctx.font = `700 ${13 * scale}px Arial, sans-serif`;
        const badgeText = this.config.brandBadge || '真实可验';
        const badgeWidth = ctx.measureText(badgeText).width + 10 * scale;
        const badgeHeight = 18 * scale;
        const badgeX = rightX - badgeWidth;
        const subtitle = this.config.brandSubtitle || '相机';
        ctx.font = '700 13px Arial, sans-serif';
        const subtitleSize = 13 * Math.min(1, 75 / ctx.measureText(subtitle).width);
        ctx.font = `700 ${subtitleSize * scale}px Arial, sans-serif`;
        ctx.fillText(subtitle, badgeX - 5 * scale, y + 2 * scale);
        regions?.push({ field: 'brandSubtitle', x: badgeX - 5 * scale - ctx.measureText(subtitle).width, y, width: ctx.measureText(subtitle).width, height: badgeHeight });
        regions?.push({ field: 'brandBadge', x: badgeX, y, width: badgeWidth, height: badgeHeight });
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#d0d4d4';
        this._drawRoundRect(ctx, badgeX, y, badgeWidth, badgeHeight, 1 * scale);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#354146';
        ctx.font = `700 ${13 * scale}px Arial, sans-serif`;
        ctx.fillText(badgeText, badgeX + badgeWidth / 2, y + 2 * scale);
        y += 20 * scale;
        if (this.config.antiFakeEnabled) {
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.textAlign = 'right';
            ctx.font = `700 ${8 * scale}px Arial, sans-serif`;
            ctx.fillStyle = '#fff';
            ctx.fillText(`${this.config.brandCodeLabel || '编号'} ${this.currentAntiFakeCode}`, rightX, y);
            const width = ctx.measureText(`${this.config.brandCodeLabel || '编号'} ${this.currentAntiFakeCode}`).width;
            regions?.push({ field: 'brandCodeLabel', x: rightX - width, y, width, height: 10 * scale });
        }
    }

    _drawRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    setCustomTime(date, time) {
        if (date && time) {
            const dt = new Date(`${date}T${time}`);
            this.config.customTime = {
                time: time,
                date: this.formatDate(dt),
                fullDate: this.formatFullDate(dt),
                weekDay: this.getWeekDay(dt)
            };
        } else {
            this.config.customTime = null;
        }
    }

    setCustomLocation(province, city, address, coords) {
        if (province || city || address || coords) {
            this.config.customLocation = {
                province: province || '',
                city: city || '',
                address: address || '',
                full: LocationFormatter.join([province, city, address]) || `坐标 ${coords}`,
                coords: coords || ''
            };
        } else {
            this.config.customLocation = null;
        }
    }

    setWeather(enabled, text, temp) {
        this.config.weather = { enabled, text, temp };
        this.weatherDetail = null;
    }

    /**
     * 设置天气模式
     * @param {string} mode - 'auto' 或 'manual'
     */
    setWeatherMode(mode) {
        this.config.weatherMode = mode;
    }

    /**
     * 从WeatherManager自动获取的天气数据更新水印天气
     * @param {Object} weatherData - WeatherManager返回的天气对象
     */
    setWeatherFromAuto(weatherData) {
        if (!weatherData || this.config.weatherMode === 'manual') return;
        this.config.weather = {
            enabled: true,
            text: weatherData.text || '晴',
            temp: weatherData.temp || '27°C'
        };
        // 存储完整天气数据供详情展示
        this.weatherDetail = weatherData;
    }

    /**
     * 获取天气详情数据
     */
    getWeatherDetail() {
        return this.config.weather.enabled && this.config.weatherMode !== 'manual' ? this.weatherDetail || null : null;
    }

    syncCurrentTime() {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        this.setCustomTime(date, time);
        return { date, time };
    }

    getConfig() {
        return { ...this.config };
    }
}

window.WatermarkManager = WatermarkManager;
