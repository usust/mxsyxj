import { access, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

function cap(...args) {
    execFileSync(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', ...args], { stdio: 'inherit' });
}
try {
    await access('android/app/build.gradle');
} catch {
    cap('add', 'android');
}
cap('sync', 'android');

const wrapperPath = 'android/gradle/wrapper/gradle-wrapper.properties';
let wrapper = await readFile(wrapperPath, 'utf8');
wrapper = wrapper.replace('gradle-8.2.1-all.zip', 'gradle-8.2.1-bin.zip').replace('networkTimeout=10000', 'networkTimeout=120000');
await writeFile(wrapperPath, wrapper);

const javaDir = 'android/app/src/main/java/com/moxi/watermarkcamera';
await mkdir(javaDir, { recursive: true });
for (const name of ['MainActivity.java', 'LocalPhotosPlugin.java']) {
    await cp(`native/android/${name}`, `${javaDir}/${name}`);
}
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = await readFile(manifestPath, 'utf8');
for (const name of ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) {
    if (!manifest.includes(`android.permission.${name}`)) {
        manifest = manifest.replace('</manifest>', `    <uses-permission android:name="android.permission.${name}" />\n</manifest>`);
    }
}
if (!manifest.includes('android.hardware.camera.any')) {
    manifest = manifest.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera.any" android:required="false" />\n</manifest>');
}
if (!manifest.includes('android:usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
}
// The app records contain user photos; keep them on this device instead of Android cloud backup.
manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
if (!manifest.includes('android:dataExtractionRules')) {
    manifest = manifest.replace('<application', '<application android:dataExtractionRules="@xml/data_extraction_rules"');
}
const declarations = [...manifest.matchAll(/^\s*<uses-(?:permission|feature)\b[^>]*\/>/gm)].map(match => match[0].trim());
manifest = manifest.replace(/^\s*<uses-(?:permission|feature)\b[^>]*\/>/gm, '');
manifest = manifest.replace('    <application', declarations.map(value => `    ${value}`).join('\n') + '\n\n    <application');
manifest = manifest.replace(/android:icon="[^"]+"/, 'android:icon="@drawable/moxi_icon"');
manifest = manifest.replace(/android:roundIcon="[^"]+"/, 'android:roundIcon="@drawable/moxi_icon"');
// Follow the device sensor in both landscape directions, including with rotation lock enabled.
manifest = manifest.replace(/\s+android:screenOrientation="[^"]*"/g, '');
manifest = manifest.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="fullSensor"');
await writeFile(manifestPath, manifest);
await cp('native/android/data_extraction_rules.xml', 'android/app/src/main/res/xml/data_extraction_rules.xml');
await mkdir('android/app/src/main/res/drawable-nodpi', { recursive: true });
await cp('assets/icon-512.jpg', 'android/app/src/main/res/drawable-nodpi/moxi_icon.jpg');
const stylesPath = 'android/app/src/main/res/values/styles.xml';
let styles = await readFile(stylesPath, 'utf8');
styles = styles.replace('<item name="android:background">@drawable/splash</item>', '<item name="windowSplashScreenBackground">#1a1a2e</item>\n        <item name="windowSplashScreenAnimatedIcon">@drawable/moxi_icon</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
await writeFile(stylesPath, styles);

const variablesPath = 'android/variables.gradle';
let variables = await readFile(variablesPath, 'utf8');
variables = variables.replace(/minSdkVersion = \d+/, 'minSdkVersion = 29');
await writeFile(variablesPath, variables);
const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
const gradlePath = 'android/app/build.gradle';
let gradle = await readFile(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode \d+/, `versionCode ${packageInfo.androidVersionCode}`).replace(/versionName "[^"]+"/, `versionName "${packageInfo.version}"`);
await writeFile(gradlePath, gradle);
await cp('native/android/local-release.gradle', 'android/app/local-release.gradle');
if (!gradle.includes('local-release.gradle')) {
    await writeFile(gradlePath, gradle + '\napply from: "local-release.gradle"\n');
}
console.log('Android single-device app prepared (Android 10+)');
