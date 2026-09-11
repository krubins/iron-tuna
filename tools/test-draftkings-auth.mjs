#!/usr/bin/env node
// The DFS admin endpoint accepts GitHub OIDC only from the merged salary
// workflow on main. Exercise the real Worker verifier with an ephemeral key.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const start = source.indexOf('let _GITHUB_OIDC_KEYS = null;');
const end = source.indexOf('const json =', start);
if (start < 0 || end < 0) throw new Error('GitHub OIDC verifier was not found in _worker.js');

let keyFetches = 0;
let publicJwk;
const verifier = new Function('atob', 'TextDecoder', 'TextEncoder', 'crypto', 'fetch',
  source.slice(start, end) + '\nreturn githubDfsWorkflowOk;')(
  atob, TextDecoder, TextEncoder, crypto,
  async () => { keyFetches++; return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } }); }
);

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'fixture-key', use: 'sig', alg: 'RS256' };
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const baseClaims = { iss: 'https://token.actions.githubusercontent.com', aud: 'iron-tuna-dfs-import',
  repository: 'krubins/iron-tuna', ref: 'refs/heads/main',
  workflow_ref: 'krubins/iron-tuna/.github/workflows/draftkings-salaries.yml@refs/heads/main',
  iat: now - 5, nbf: now - 5, exp: now + 300 };
async function jwt(claims = baseClaims) {
  const head = b64({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT' }), body = b64(claims);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + Buffer.from(signature).toString('base64url');
}
const request = token => new Request('https://irontuna.com/api/admin/dfs', { headers: { authorization: 'Bearer ' + token } });

let pass = 0, fail = 0;
const ok = (name, condition) => { if (condition) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('\nthe DraftKings workflow identity');
ok('a signed token from the exact main workflow is accepted', await verifier(request(await jwt())));
ok('the signing keys are fetched from GitHub once', keyFetches === 1);
ok('another repository is rejected', !(await verifier(request(await jwt({ ...baseClaims, repository: 'someone/else' })))));
ok('another workflow is rejected', !(await verifier(request(await jwt({ ...baseClaims, workflow_ref: 'krubins/iron-tuna/.github/workflows/checks.yml@refs/heads/main' })))));
ok('a feature branch is rejected', !(await verifier(request(await jwt({ ...baseClaims, ref: 'refs/heads/feature' })))));
ok('an expired token is rejected', !(await verifier(request(await jwt({ ...baseClaims, exp: now - 1 })))));
ok('a damaged signature is rejected', !(await verifier(request((await jwt()).slice(0, -2) + 'xx'))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
