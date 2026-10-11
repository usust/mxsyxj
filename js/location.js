/** Format the existing geocoder's address without discarding street or building details. */
class LocationFormatter {
    static clean(value) {
        return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    }

    static unique(values) {
        const parts = [];
        for (const value of values.map(value => this.clean(value)).filter(Boolean)) {
            if (!parts.includes(value)) parts.push(value);
        }
        return parts;
    }

    static join(values) {
        const parts = this.unique(values);
        if (!parts.some(part => /[\u3400-\u9fff]/.test(part))) return parts.join(', ');
        return parts.reduce((full, part) => {
            if (!full || part.startsWith(full)) return part;
            if (full.endsWith(part)) return full;
            for (let length = Math.min(full.length, part.length); length >= 2; length--) {
                if (full.endsWith(part.slice(0, length))) return full + part.slice(length);
            }
            return full + part;
        }, '');
    }

    /** Keep structured fields; recover clear administrative prefixes in older flat edits. */
    static editableFields(location = {}) {
        const result = { province: location.province || '', city: location.city || '', address: location.address || '', coords: location.coords || '' };
        if (result.province || result.city) {
            if (!result.address && location.full) {
                const prefix = this.join([result.province, result.city]);
                result.address = location.full.startsWith(prefix) ? location.full.slice(prefix.length) : location.full;
            }
            return result;
        }
        if (!result.address && location.full === `坐标 ${result.coords}`) return result;
        let remaining = result.address || location.full || '';
        const province = remaining.match(/^(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/)?.[0];
        if (province) { result.province = province; remaining = remaining.slice(province.length); }
        const city = remaining.match(/^([\u3400-\u9fff]{2,10}?(?:自治州|地区|市|盟))/)?.[0];
        if (city && !/[路街号]/.test(city)) { result.city = city; remaining = remaining.slice(city.length); }
        if (result.city || /^(北京|天津|上海|重庆)市$/.test(result.province)) {
            const district = remaining.match(/^([\u3400-\u9fff]{1,10}?(?:自治县|自治旗|区|县|旗))/)?.[0];
            if (district && !/(路|街|号|小区|社区)/.test(district)) { result.city += district; remaining = remaining.slice(district.length); }
        }
        result.address = remaining;
        return result;
    }

    static fromGeocoder(data) {
        if (!data || data.error) return null;
        const a = data.address || {};
        const province = this.clean(a.state || a.province || a.region);
        const city = this.clean(a.city || a.municipality || a.town || a.county || a.district);
        const area = this.unique([
            a.state_district, a.county, a.city_district, a.borough, a.district,
            a.town, a.suburb, a.quarter, a.neighbourhood, a.village, a.hamlet, a.residential
        ]).filter(part => ![province, city].some(parent => parent && parent.includes(part)));
        const road = this.clean(a.road || a.pedestrian || a.footway || a.path || a.cycleway || a.square);
        const number = this.clean(a.house_number);
        const chinese = a.country_code === 'cn' || /[\u3400-\u9fff]/.test(province + city + road + this.clean(data.display_name));
        const street = chinese
            ? road + (number && /^[\dA-Za-z\-/]+$/.test(number) ? `${number}号` : number)
            : [number, road].filter(Boolean).join(' ');
        const names = [a.house_name, a.building, a.amenity, a.shop, a.office, a.tourism, a.leisure, a.industrial, a.commercial];
        // Administrative and street names are already represented above.
        const administrativeTypes = ['state', 'province', 'region', 'state_district', 'city', 'municipality', 'county', 'district', 'city_district', 'borough', 'town', 'suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'road', 'pedestrian', 'footway', 'path', 'cycleway', 'square', 'house_number'];
        if (!administrativeTypes.includes(data.addresstype)) {
            names.push(data.namedetails?.['name:zh'] || data.name || data.namedetails?.name);
        }
        const known = [province, city, ...area, road, number, street, ...names, a.country, a.postcode];
        const displayParts = this.clean(data.display_name).split(/[,，]/).map(part => part.trim()).filter(Boolean);
        const isKnown = part => known.some(value => this.clean(value) && this.clean(value).includes(part));
        if (!province && !city && !area.length && !street && !names.some(name => this.clean(name))) {
            const full = this.clean(data.display_name);
            return full ? { province: '', city: '', address: full, full } : null;
        }
        // The provider orders display_name from the venue outwards, so reverse extra
        // Chinese components to keep street / house / venue ordering in the watermark.
        const extra = displayParts.filter(part => !isKnown(part) &&
            !['中国', '中华人民共和国', 'China'].includes(part) && !/^\d{5,6}$/.test(part));
        if (chinese) extra.reverse();
        const detail = this.unique([...area, street, ...extra, ...names]).filter(part =>
            !['yes', 'no'].includes(part) && ![province, city].some(parent => parent && parent.includes(part))
        );
        const address = this.join(detail);
        return { province, city, address, full: this.join([province, city, address]) };
    }
}

if (typeof window !== 'undefined') window.LocationFormatter = LocationFormatter;
if (typeof module !== 'undefined') module.exports = LocationFormatter;
