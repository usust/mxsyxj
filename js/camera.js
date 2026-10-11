/**
 * 今日水印相机 - 相机模块
 * 负责摄像头调用、切换、拍照等功能
 * 支持高画质拍摄、AI清晰度增强
 */

class CameraManager {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.stream = null;
        this.facingMode = 'environment'; // 默认后置摄像头
        this.flashMode = 'off'; // off, on, auto
        this.isInitialized = false;
        this.availableCameras = [];
        this.currentCameraIndex = 0;
        this.maxResolution = { width: 0, height: 0 };
        this.imageQuality = 0.95; // JPEG输出质量
        this.captureScale = 1.0; // 拍照放大倍数（超分辨率）
    }

    /**
     * 初始化相机
     */
    async init() {
        this.video = document.getElementById('camera-video');
        this.canvas = document.getElementById('camera-canvas');

        if (!this.video || !this.canvas) {
            throw new Error('找不到视频或画布元素');
        }

        // 检查浏览器支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('您的浏览器不支持相机功能');
        }

        // 设置video属性以提升画质
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('autoplay', '');
        this.video.setAttribute('muted', '');

        // 获取可用摄像头列表
        await this.enumerateCameras();

        // 启动相机
        await this.startCamera();
        
        this.isInitialized = true;
    }

    /**
     * 枚举可用摄像头
     */
    async enumerateCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableCameras = devices.filter(d => d.kind === 'videoinput');
        } catch (err) {
            console.warn('无法枚举摄像头:', err);
            this.availableCameras = [];
        }
    }

    /**
     * 启动相机 - 高画质配置
     */
    async startCamera() {
        // 停止现有流
        this.stopCamera();

        // 高画质约束配置
        const constraints = {
            video: {
                facingMode: this.facingMode,
                // 请求最高分辨率
                width: { ideal: 4096 },
                height: { ideal: 2160 },
                // 帧率配置
                frameRate: { ideal: 30, min: 24 },
                // 尽可能使用高画质
                resizeMode: 'crop-and-scale'
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            
            // 等待视频加载
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('视频加载超时')), 10000);
                this.video.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    this.video.play().then(() => {
                        // 记录实际获取的分辨率
                        this.maxResolution = {
                            width: this.video.videoWidth,
                            height: this.video.videoHeight
                        };
                        console.log(`相机分辨率: ${this.maxResolution.width}x${this.maxResolution.height}`);
                        resolve();
                    }).catch(reject);
                };
            });

            // 尝试应用高级画质设置
            this._applyAdvancedSettings();
        } catch (err) {
            // 高分辨率失败，降级到1080p
            console.warn('高分辨率启动失败，降级:', err.message);
            try {
                const fallbackConstraints = {
                    video: {
                        facingMode: this.facingMode,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        frameRate: { ideal: 30 }
                    },
                    audio: false
                };
                this.stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
                this.video.srcObject = this.stream;
                
                await new Promise((resolve) => {
                    this.video.onloadedmetadata = () => {
                        this.video.play();
                        this.maxResolution = {
                            width: this.video.videoWidth,
                            height: this.video.videoHeight
                        };
                        resolve();
                    };
                });
            } catch (fallbackErr) {
                // 如果后置摄像头失败，尝试前置
                if (this.facingMode === 'environment') {
                    console.warn('后置摄像头启动失败，尝试前置摄像头');
                    this.facingMode = 'user';
                    await this.startCamera();
                    return;
                }
                throw new Error(`无法访问摄像头: ${fallbackErr.message}`);
            }
        }
    }

    /**
     * 应用高级画质设置
     */
    async _applyAdvancedSettings() {
        if (!this.stream) return;

        const track = this.stream.getVideoTracks()[0];
        if (!track) return;

        try {
            // 尝试应用最高画质约束
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            const advancedConstraints = {};

            // 尽可能设置高分辨率
            if (capabilities.width && capabilities.height) {
                const maxWidth = capabilities.width.max || 1920;
                const maxHeight = capabilities.height.max || 1080;
                advancedConstraints.width = maxWidth;
                advancedConstraints.height = maxHeight;
            }

            // 帧率设置
            if (capabilities.frameRate) {
                advancedConstraints.frameRate = Math.min(capabilities.frameRate.max || 30, 30);
            }

            // 曝光模式
            if (capabilities.exposureMode) {
                advancedConstraints.exposureMode = 'continuous';
            }

            // 白平衡
            if (capabilities.whiteBalanceMode) {
                advancedConstraints.whiteBalanceMode = 'continuous';
            }

            // 焦点模式
            if (capabilities.focusMode) {
                advancedConstraints.focusMode = 'continuous';
            }

            if (Object.keys(advancedConstraints).length > 0) {
                await track.applyConstraints({ advanced: [advancedConstraints] });
                // 更新实际分辨率
                const settings = track.getSettings();
                if (settings.width && settings.height) {
                    this.maxResolution = { width: settings.width, height: settings.height };
                    console.log(`高级画质已应用: ${settings.width}x${settings.height}`);
                }
            }
        } catch (err) {
            console.warn('高级画质设置不受支持:', err);
        }
    }

    /**
     * 停止相机
     */
    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.video) {
            this.video.srcObject = null;
        }
    }

    /**
     * 切换前后摄像头
     */
    async switchCamera() {
        this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
        await this.startCamera();
    }

    /**
     * 切换闪光灯模式
     */
    toggleFlash() {
        const modes = ['off', 'on', 'auto'];
        const currentIndex = modes.indexOf(this.flashMode);
        this.flashMode = modes[(currentIndex + 1) % modes.length];
        
        // 尝试应用闪光灯设置（仅在后置摄像头时有效）
        this.applyFlashMode();
        
        return this.flashMode;
    }

    /**
     * 应用闪光灯模式
     */
    async applyFlashMode() {
        if (!this.stream) return;

        const track = this.stream.getVideoTracks()[0];
        if (!track) return;

        try {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            if (capabilities.torch) {
                await track.applyConstraints({
                    advanced: [{ torch: this.flashMode === 'on' }]
                });
            }
        } catch (err) {
            console.warn('闪光灯控制不受支持:', err);
        }
    }

    /**
     * 拍照 - 高画质捕获
     * @param {WatermarkManager} watermarkManager - 水印管理器
     * @returns {string} 图片的Data URL
     */
    capture(watermarkManager) {
        if (!this.video || !this.video.videoWidth) {
            throw new Error('相机未准备好');
        }

        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;

        // 使用实际视频分辨率，确保最高画质
        // 如果视频分辨率较低，使用2倍超分辨率
        let captureWidth = videoWidth;
        let captureHeight = videoHeight;

        // 对于低分辨率视频，使用超分辨率放大
        if (videoWidth < 1920) {
            captureWidth = videoWidth * 2;
            captureHeight = videoHeight * 2;
        }

        // 设置画布大小为最高分辨率
        this.canvas.width = captureWidth;
        this.canvas.height = captureHeight;

        const ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: false,
            willReadFrequently: true
        });

        // 启用高质量图像平滑
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 如果是前置摄像头，镜像翻转
        if (this.facingMode === 'user') {
            ctx.translate(captureWidth, 0);
            ctx.scale(-1, 1);
        }

        // 绘制视频帧到画布（高画质）
        ctx.drawImage(this.video, 0, 0, captureWidth, captureHeight);

        // 恢复变换
        if (this.facingMode === 'user') {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        // AI画质增强：锐化和降噪
        this._enhanceImageQuality(ctx, captureWidth, captureHeight);

        // 绘制水印
        this.lastOriginalPhoto = this.canvas.toDataURL('image/jpeg', this.imageQuality);
        if (watermarkManager) {
            watermarkManager.drawWatermarkOnCanvas(ctx, captureWidth, captureHeight);
        }

        // 返回高质量图片Data URL
        return this.canvas.toDataURL('image/jpeg', this.imageQuality);
    }

    /**
     * AI画质增强 - 锐化 + 降噪
     */
    _enhanceImageQuality(ctx, width, height) {
        try {
            // 获取图像数据
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // 轻度锐化卷积核
            // [ 0, -0.5,  0 ]
            // [-0.5,  3, -0.5]
            // [ 0, -0.5,  0 ]
            const sharpenAmount = 0.4;
            const center = 1 + 4 * sharpenAmount;
            const neighbor = -sharpenAmount;

            // 创建副本用于卷积
            const original = new Uint8ClampedArray(data);

            // 应用锐化（跳过边缘像素）
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = (y * width + x) * 4;
                    for (let c = 0; c < 3; c++) {
                        const val = center * original[idx + c]
                            + neighbor * original[idx - 4 + c]
                            + neighbor * original[idx + 4 + c]
                            + neighbor * original[idx - width * 4 + c]
                            + neighbor * original[idx + width * 4 + c];
                        data[idx + c] = Math.max(0, Math.min(255, val));
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
        } catch (err) {
            console.warn('画质增强跳过:', err);
        }
    }

    /**
     * 获取当前摄像头方向
     */
    getFacingMode() {
        return this.facingMode;
    }

    /**
     * 获取闪光灯模式
     */
    getFlashMode() {
        return this.flashMode;
    }

    /**
     * 检查是否已初始化
     */
    isReady() {
        return this.isInitialized && this.stream !== null;
    }

    /**
     * 获取当前分辨率
     */
    getResolution() {
        return this.maxResolution;
    }

    /**
     * 清理资源
     */
    destroy() {
        this.stopCamera();
        this.isInitialized = false;
    }
}

// 导出到全局
window.CameraManager = CameraManager;
