const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');

function createStore() {
    const context = { window: {}, indexedDB: new IDBFactory() };
    vm.runInNewContext(readFileSync('js/platform.js', 'utf8'), context);
    return new context.window.PhotoStore();
}

test('large photos persist across reads and deleted records stay removed', async () => {
    const store = createStore();
    await store.open();
    const largePhoto = { id: 1, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(6 * 1024 * 1024), antiFakeCode: 'ABCD1234EFGH5' };
    await store.replace([largePhoto, { id: 2, dataUrl: 'newest' }]);
    const photos = await store.read();
    assert.equal(photos[0].id, 2);
    assert.equal(photos[1].dataUrl, largePhoto.dataUrl);
    await store.replace([photos[0]]);
    assert.equal((await store.read()).length, 1);
    await store.replace([]);
    assert.equal((await store.read()).length, 0);
});

test('a failed write preserves the previous gallery transaction', async () => {
    const store = createStore();
    await store.open();
    await store.replace([{ id: 1, dataUrl: 'original' }]);
    await assert.rejects(store.replace([{ id: 2, dataUrl: () => {} }]));
    // A synchronous clone failure must abort the whole transaction, including clear().
    assert.equal((await store.read())[0]?.dataUrl, 'original');
});
