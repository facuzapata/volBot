// Uses the dedicated V2 test database only. Never loads V1 .env.
const { spawnSync } = require('child_process');
const fs = require('fs');
const dotenv = require('dotenv');
const env = fs.existsSync('.env.v2') ? dotenv.parse(fs.readFileSync('.env.v2')) : {};
const url = process.env.V2_TEST_DATABASE_URL || env.V2_DATABASE_URL?.replace(/\/volbot_v2$/, '/volbot_v2_test');
if (!url) throw new Error('Set V2_TEST_DATABASE_URL to a dedicated test database');
const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', '--silent', '--testPathPattern=integration-spec'], {
  stdio: 'inherit', env: { ...process.env, V2_TEST_DATABASE_URL: url, V2_TEST_KAFKA_BROKERS: process.env.V2_TEST_KAFKA_BROKERS || env.V2_KAFKA_BROKERS },
});
process.exitCode = result.status ?? 1;
