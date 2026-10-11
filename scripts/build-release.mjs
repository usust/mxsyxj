import { access, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

execFileSync('npm', ['run', 'android:prepare'], { stdio: 'inherit' });
const signingDir = resolve('.signing');
await mkdir(signingDir, { recursive: true, mode: 0o700 });
const credentialsPath = join(signingDir, 'credentials.json');
let credentials;
try {
    credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (err) {
    if (err.code !== 'ENOENT') throw err;
    credentials = { password: randomBytes(32).toString('hex') };
    await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
}
const env = {
    ...process.env,
    MOXI_KEYSTORE_PATH: join(signingDir, 'moxi-local.jks'),
    MOXI_KEYSTORE_PASSWORD: credentials.password,
    MOXI_KEY_ALIAS: 'moxi-local'
};
try {
    await access(env.MOXI_KEYSTORE_PATH);
} catch {
    const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/keytool') : 'keytool';
    execFileSync(keytool, [
        '-genkeypair', '-keystore', env.MOXI_KEYSTORE_PATH, '-storetype', 'JKS',
        '-alias', env.MOXI_KEY_ALIAS, '-storepass:env', 'MOXI_KEYSTORE_PASSWORD',
        '-keypass:env', 'MOXI_KEYSTORE_PASSWORD', '-keyalg', 'RSA', '-keysize', '3072',
        '-validity', '10000', '-dname', 'CN=Moxi Local Camera, OU=Personal App, O=Moxi, C=CN'
    ], { env, stdio: 'inherit' });
}
execFileSync('./gradlew', ['assembleRelease', 'lintRelease', '--no-daemon'], { cwd: 'android', env, stdio: 'inherit' });
await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const output = `artifacts/moxi-watermark-camera-${version}.apk`;
await cp('android/app/build/outputs/apk/release/app-release.apk', output);
console.log(`Signed APK: ${resolve(output)}`);
