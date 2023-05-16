import { expect } from 'chai';
import { exec } from 'child_process';
import { promises as fsp } from 'fs';
import { join } from 'path';

import { CONFIG_FILE_NAME, getConfig } from './test-sync-config.js';

const COMMAND_PATH = join(__dirname, './load-kysely-tests.js');
const TEST_DIR_NAME = 'test';
const TEST_DIR = join(process.cwd(), TEST_DIR_NAME);
const TEST_CONFIG_FILE = join(TEST_DIR_NAME, CONFIG_FILE_NAME);
const EXPECTED_TESTS_PATH = join(TEST_DIR, 'expected-tests');

describe('load-kysely-tests', () => {
  it('should produce the expected test files', async () => {
    const config = await getConfig(TEST_CONFIG_FILE);
    const downloadPath = join(process.cwd(), config.downloadedTestsDir);
    try {
      // Ensure that the download path starts empty.
      await fsp.rm(downloadPath, { recursive: true });
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    const command = `node ${COMMAND_PATH} --config=${TEST_CONFIG_FILE}`;
    await new Promise<void>((resolve) => {
      exec(command, (err: any, _stdout, stderr) => {
        expect(err).to.be.null;
        expect(stderr).to.be.empty;
        resolve();
      });
    });

    const expectedFiles = await fsp.readdir(EXPECTED_TESTS_PATH);
    expectedFiles.sort();
    const actualFiles = await fsp.readdir(downloadPath);
    actualFiles.sort();

    expect(actualFiles).to.deep.equal(expectedFiles);

    for (const fileName of expectedFiles) {
      const expectedText = await fsp.readFile(
        join(EXPECTED_TESTS_PATH, fileName),
        'utf-8'
      );
      const actualText = await fsp.readFile(
        join(downloadPath, fileName),
        'utf-8'
      );
      expect(actualText).to.equal(expectedText);
    }
  });
});