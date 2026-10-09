// iOS の署名の材料(配布用の証明書と、App Store 用のプロビジョニングプロファイル)を、
// App Store Connect API キーで作り、EAS Build に渡せる形(credentials.json)で書き出す。
// GitHub Actions の中だけで動かす(キーは環境変数・一時ファイルで受け取り、ログには出さない)。
//
// 必要な環境変数:
//   ASC_KEY_PATH     ... App Store Connect API キー(.p8)のファイルの場所
//   ASC_KEY_ID       ... そのキーのID
//   ASC_ISSUER_ID    ... 発行者ID
//   BUNDLE_ID        ... 例: jp.cms-manager.beyondline
//   OUT_DIR          ... 書き出し先(既定 ./.ios-credentials)
//
// 配布用証明書: チームに1つだけ持てるので、毎回、古いものを失効させてから作り直す。
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`環境変数 ${k} がありません`);
  return v;
};
const keyPath = env('ASC_KEY_PATH');
const keyId = env('ASC_KEY_ID');
const issuerId = env('ASC_ISSUER_ID');
const bundleId = env('BUNDLE_ID');
const outDir = process.env.OUT_DIR || '.ios-credentials';
mkdirSync(outDir, { recursive: true });

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt() {
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${header}.${payload}`).sign({ key: createPrivateKey(readFileSync(keyPath)), dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64u(sig)}`;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 本文が JSON でないとき */
  }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail ?? e.title}`).join(' / ') ?? text.slice(0, 300);
    throw new Error(`App Store Connect API ${method} ${path} → ${res.status} ${detail}`);
  }
  return json;
}

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

// 1) 秘密鍵と CSR(証明書の申請書)を作る
const keyFile = join(outDir, 'dist.key');
const csrFile = join(outDir, 'dist.csr');
sh('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', csrFile, '-subj', '/CN=beyond line distribution/O=BEYOND BEAUTY HOLDING K.K./C=JP']);

// 2) 配布用証明書の枠を確保して、作る
// Apple は、チームに有効な「iOS配布用証明書」を1つしか持たせない。毎回の署名の材料は、このスクリプトが作り直すので、
// 既存のものは失効させる(すでに App Store に出ているアプリには影響しない。新しい証明書とプロファイルで署名し直すだけ)。
const certs = await api('GET', '/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=50');
for (const old of certs.data ?? []) {
  console.log(`既存の配布用証明書を失効させます(${old.id})`);
  await api('DELETE', `/v1/certificates/${old.id}`);
}
const created = await api('POST', '/v1/certificates', {
  data: { type: 'certificates', attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: readFileSync(csrFile, 'utf8') } },
});
const certId = created.data.id;
const certDer = Buffer.from(created.data.attributes.certificateContent, 'base64');
const certFile = join(outDir, 'dist.cer');
writeFileSync(certFile, certDer);
console.log(`配布用証明書を作りました(${certId})`);

// 3) .p12 にまとめる(EAS・macOS が読める古い形式で)
const p12Password = randomBytes(18).toString('base64url');
const certPem = join(outDir, 'dist.pem');
sh('openssl', ['x509', '-inform', 'DER', '-in', certFile, '-out', certPem]);
const p12File = join(outDir, 'dist.p12');
sh('openssl', ['pkcs12', '-export', '-inkey', keyFile, '-in', certPem, '-out', p12File, '-passout', `pass:${p12Password}`, '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);

// 4) App Store 用のプロファイルを作る
const bundles = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&limit=5`);
const bundle = (bundles.data ?? []).find((b) => b.attributes.identifier === bundleId);
if (!bundle) throw new Error(`Bundle ID ${bundleId} が Apple に登録されていません`);
const name = `beyond line AppStore ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
const profile = await api('POST', '/v1/profiles', {
  data: {
    type: 'profiles',
    attributes: { name, profileType: 'IOS_APP_STORE' },
    relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: certId }] } },
  },
});
const profileFile = join(outDir, 'profile.mobileprovision');
writeFileSync(profileFile, Buffer.from(profile.data.attributes.profileContent, 'base64'));
console.log(`プロビジョニングプロファイルを作りました(${name})`);

// 5) EAS Build が読む credentials.json
writeFileSync(
  'credentials.json',
  JSON.stringify({ ios: { provisioningProfilePath: profileFile, distributionCertificate: { path: p12File, password: p12Password } } }, null, 2),
);
console.log('credentials.json を書き出しました');
