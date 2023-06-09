import { promises as fsp } from 'fs';
import { join } from 'path';

import {
  TestSyncConfig,
  getConfig,
  InvalidConfigException,
} from './test-sync-config.js';
import { KYSELY_TREE_URL, getBaseDownloadUrl } from './kysely-versions.js';

const VERSION_FILE_NAME = '_kysely-version.txt';
const HEADER_LINE =
  '// Copied from Kysely | MIT License | Copyright (c) 2022 Sami Koskimäki\n';

(async () => {
  try {
    await installKyselyTests();
  } catch (e: any) {
    if (!(e instanceof InvalidConfigException)) throw e;
    console.error(`Failed to install Kysely tests\n${e.message}\n`);
    process.exit(1);
  }
})();

async function installKyselyTests() {
  // Load the configuration file.

  const config = await getConfig();
  if (!config.kyselyTestFiles) {
    throw new InvalidConfigException(
      "Config file doesn't provide 'kyselyTestFiles'"
    );
  }

  // Create the directory for the downloaded tests, initially empty.

  const kyselySourceDir = join(process.cwd(), config.downloadDir);
  try {
    await fsp.rm(kyselySourceDir, { recursive: true });
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  await fsp.mkdir(kyselySourceDir);

  // Dowload the test files.

  const baseDownloadUrl = await getBaseDownloadUrl(config);
  for (const fileEntry of Object.entries(config.kyselyTestFiles)) {
    const fileName = fileEntry[0];
    const downloadUrl = `${baseDownloadUrl}${config.kyselyTestDir}${fileName}`;
    const localFilePath = join(kyselySourceDir, `${fileName}`);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new InvalidConfigException(
        `Failed to load ${downloadUrl}: ${response.statusText}`
      );
    }
    const kyselySource = tweakKyselySource(
      config,
      downloadUrl,
      fileName,
      await response.text(),
      fileEntry[1]
    );
    await fsp.writeFile(localFilePath, kyselySource);
  }

  // Add a file indicating the version and base URL.

  const version = baseDownloadUrl.split('/')[5];
  const versionFile = join(kyselySourceDir, VERSION_FILE_NAME);
  await fsp.writeFile(
    versionFile,
    `kysely version: ${version}\n${KYSELY_TREE_URL}${version}`
  );
}

function tweakKyselySource(
  config: TestSyncConfig,
  downloadUrl: string,
  fileName: string,
  source: string,
  excludedTests: string[]
): string {
  // Import from kysely.

  source = source.replaceAll(/from '\.\.[./]*'/g, (match) => "from 'kysely'");

  // Use the custom test setup.

  source = source.replaceAll('./test-setup.js', config.customSetupFile);

  // Add an import for `reportMochaContext` from the custom setup.

  const IMPORT_START = 'import ';
  const importStartOffset = source.indexOf(IMPORT_START);
  if (importStartOffset >= 0) {
    source =
      source.substring(0, importStartOffset) +
      `import { reportMochaContext } from '${config.customSetupFile}';\n` +
      source.substring(importStartOffset);
  }

  // Call `reportMochaContext` from each `describe` block.

  const DESCRIBE_START_REGEX = /[ \t\n]describe\(/gm;
  const DESCRIBE_END_OF_OPENING = '{\n';
  const describeMatches = source.matchAll(DESCRIBE_START_REGEX);
  // replace in reverse order to avoid changing offsets
  const reverseMatches = [...describeMatches].reverse();
  for (const match of reverseMatches) {
    const describeStartOffset = match.index! + 1;
    const endOfPriorLine =
      source.lastIndexOf('\n', describeStartOffset + 1) + 1;
    const indent = source.substring(endOfPriorLine, describeStartOffset);
    const endOfOpeningOffset =
      source.indexOf(DESCRIBE_END_OF_OPENING, describeStartOffset) +
      DESCRIBE_END_OF_OPENING.length;
    source =
      source.substring(0, endOfOpeningOffset) +
      `${indent}  beforeEach(function () {\n` +
      `${indent}    reportMochaContext(this);\n` +
      `${indent}  });\n\n` +
      source.substring(endOfOpeningOffset);
  }

  // Skip excluded tests.

  for (const excludedTest of excludedTests) {
    const TEST_START = 'it(';
    const testNameOffset = source.indexOf(excludedTest);
    if (testNameOffset < 0) {
      throw new InvalidConfigException(
        `Test '${excludedTest}' not found in ${fileName}`
      );
    }
    const testStartOffset = source.lastIndexOf(TEST_START, testNameOffset);
    if (testStartOffset < 0) {
      throw new InvalidConfigException(
        `Start of test '${excludedTest}' not found in ${fileName}`
      );
    }
    const space = source.substring(
      testStartOffset + TEST_START.length,
      testNameOffset
    );
    if (/^[\s'"`]+$/.test(space)) {
      const splitOffset = testStartOffset + TEST_START.length - 1;
      source =
        source.substring(0, splitOffset) +
        '.skip(' +
        source.substring(testNameOffset - 1);
    }
  }

  // Add header lines.

  const version = downloadUrl.split('/')[5];
  source =
    HEADER_LINE +
    `// ${config.__baseSyncRefUrl}${version}/${config.kyselyTestDir}${fileName}\n\n` +
    source;
  return source;
}
