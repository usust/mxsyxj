/** Device services for the bundled APK, with browser fallbacks for development. */
class DevicePlatform {
    static get native() {
        return !!window.Capacitor?.isNativePlatform();
    }

    static plugin(name) {
        return window.Capacitor.registerPlugin(name);
    }

    static getCurrentPosition(success, failure, options) {
        if (this.native) {
            this.plugin('Geolocation').getCurrentPosition(options).then(success, err => {
                failure({ code: /permission|denied/i.test(err.message) ? 1 : 2, message: err.message });
            });
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(success, failure, options);
        } else {
            failure({ code: 2, message: '设备不支持定位' });
        }
    }

    static async saveImage(dataUrl, filename) {
        if (this.native) {
            return this.plugin('LocalPhotos').save({ dataUrl, filename });
        }
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
    }

    static async shareImage(dataUrl) {
        if (this.native) {
            const filesystem = this.plugin('Filesystem');
            const path = `shared/photo-${Date.now()}.jpg`;
            const { uri } = await filesystem.writeFile({
                path, directory: 'CACHE', recursive: true, data: dataUrl.split(',')[1]
            });
            // The receiver may read the file after the chooser returns. Android clears cache as needed.
            await this.plugin('Share').share({ title: '今日水印相机', files: [uri], dialogTitle: '分享照片' });
            return;
        }
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'moxi_photo.jpg', { type: 'image/jpeg' });
        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ title: '今日水印相机', files: [file] });
        } else {
            await this.saveImage(dataUrl, `moxi_${Date.now()}.jpg`);
        }
    }
}

/** IndexedDB holds recent photos without localStorage's small string quota. */
class PhotoStore {
    async open() {
        this.db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('moxi-local-photos', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async read() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('photos', 'readonly');
            const request = transaction.objectStore('photos').getAll();
            transaction.oncomplete = () => resolve(request.result.sort((a, b) => b.id - a.id));
            transaction.onabort = () => reject(transaction.error);
        });
    }

    async replace(photos) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('photos', 'readwrite');
            const store = transaction.objectStore('photos');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error('本地相册保存失败'));
            try {
                store.clear();
                photos.forEach(photo => store.put(photo));
            } catch (err) {
                transaction.abort();
                reject(err);
            }
        });
    }
}

window.DevicePlatform = DevicePlatform;
window.PhotoStore = PhotoStore;
