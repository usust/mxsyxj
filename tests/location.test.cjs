const { test } = require('node:test');
const assert = require('node:assert/strict');
const LocationFormatter = require('../js/location.js');

test('address editing retains structured fields and recovers full-only details without changing coordinates', () => {
    const location = { province: '江苏省', city: '南京市浦口区', address: '兰新路168号2栋301室', coords: '32.189802,118.714729' };
    assert.deepEqual(LocationFormatter.editableFields(location), location);
    assert.deepEqual(LocationFormatter.editableFields({ ...location, address: '', full: '江苏省南京市浦口区兰新路168号2栋301室' }), location);
    assert.equal(LocationFormatter.editableFields(location).address, location.address);
    assert.deepEqual(LocationFormatter.editableFields({ full: '坐标 1,2', coords: '1,2' }), { province: '', city: '', address: '', coords: '1,2' });
});

test('older flattened address edits recover explicit areas while retaining all detail text', () => {
    for (const [full, expected] of [
        ['江苏省南京市浦口区兰新路168号2栋301室', ['江苏省', '南京市浦口区', '兰新路168号2栋301室']],
        ['南京市浦口区兰新路168号2栋301室', ['', '南京市浦口区', '兰新路168号2栋301室']],
        ['北京市海淀区中关村大街59号', ['北京市', '海淀区', '中关村大街59号']],
        ['南京市阳光小区2栋301室', ['', '南京市', '阳光小区2栋301室']],
        ['某某大厦2栋301室', ['', '', '某某大厦2栋301室']],
        ['Singapore, 168 Orchard Road, Example Tower', ['', '', 'Singapore, 168 Orchard Road, Example Tower']]
    ]) {
        const fields = LocationFormatter.editableFields({ full, coords: '1,2' });
        assert.deepEqual([fields.province, fields.city, fields.address], expected);
        assert.equal(LocationFormatter.join([fields.province, fields.city, fields.address]), full);
        assert.equal(fields.coords, '1,2');
        assert.deepEqual(LocationFormatter.editableFields({ address: full }), { ...fields, coords: '' });
    }
});

test('street, house number and building survive a response containing neighbourhood details', () => {
    const result = LocationFormatter.fromGeocoder({
        addresstype: 'office', name: '某某商务中心',
        address: { state: '江苏省', city: '苏州市', county: '吴中区', suburb: '长桥街道', road: '东吴北路', house_number: '168', office: '某某商务中心', country: '中国', country_code: 'cn', postcode: '215128' },
        display_name: '某某商务中心, 168, 东吴北路, 长桥街道, 吴中区, 苏州市, 江苏省, 215128, 中国'
    });
    assert.equal(result.address, '吴中区长桥街道东吴北路168号某某商务中心');
    assert.equal(result.full, '江苏省苏州市吴中区长桥街道东吴北路168号某某商务中心');
});

test('display-only venue details are retained and repeated municipality names are removed', () => {
    const result = LocationFormatter.fromGeocoder({
        addresstype: 'road', name: '中关村大街',
        address: { state: '北京市', city: '北京市', city_district: '海淀区', road: '中关村大街', house_number: '59号', country: '中国' },
        display_name: '某某大厦, 中关村大街, 海淀区, 北京市, 中国'
    });
    assert.equal(result.full, '北京市海淀区中关村大街59号某某大厦');
    assert.equal(LocationFormatter.join(['江苏省', '苏州市', '江苏省苏州市吴中区东吴北路168号']), '江苏省苏州市吴中区东吴北路168号');
});

test('full provider text and foreign addresses are usable without fabricated street details', () => {
    assert.equal(LocationFormatter.fromGeocoder({ display_name: '苏州市吴中区东吴北路168号' }).full, '苏州市吴中区东吴北路168号');
    const result = LocationFormatter.fromGeocoder({ address: { city: 'Singapore', road: 'Orchard Road', house_number: '168', building: 'Example Tower' } });
    assert.equal(result.full, 'Singapore, 168 Orchard Road, Example Tower');
    assert.equal(LocationFormatter.fromGeocoder({ error: 'Unable to geocode' }), null);
    assert.equal(LocationFormatter.fromGeocoder({ address: { city: '苏州市' } }).full, '苏州市');
});
