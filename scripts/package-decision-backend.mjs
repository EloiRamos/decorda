import {spawnSync} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const outputRoot = resolve('.tmp/decision-backend');
rmSync(outputRoot, {recursive: true, force: true});
mkdirSync(outputRoot, {recursive: true});

const compile = spawnSync(
  resolve('node_modules/.bin/tsc'),
  [
    '--outDir', outputRoot,
    '--module', 'commonjs',
    '--target', 'ES2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    'src/infrastructure/server/createDecisionHandler.ts',
  ],
  {encoding: 'utf8'},
);
if (compile.status !== 0) {
  process.stderr.write(compile.stdout);
  process.stderr.write(compile.stderr);
  process.exit(compile.status ?? 1);
}

const require = createRequire(import.meta.url);
const entry = require(resolve(outputRoot, 'infrastructure/server/createDecisionHandler.js'));
const handler = entry.createDynamoDecisionHandler({
  tableName: 'offline-test-table',
  expiresAtEpochSeconds: 1,
  client: {send: async () => ({})},
});
const probe = await handler({body: '{"kind":"UNKNOWN"}'});
if (probe.statusCode !== 400) {
  throw new Error('Offline backend entry probe failed');
}
process.stdout.write(`Decision backend prepared and loaded: ${outputRoot}\n`);
