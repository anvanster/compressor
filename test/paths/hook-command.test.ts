import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  copilotHookCommandFrom,
  describeCopilotHookCommand,
  describeHookCommand,
  detectHookCommandStyle,
  isCompressorRoot,
  resolveCopilotHookCommand,
  resolveHookCommand,
} from '../../src/paths.ts';

// PATH-bin resolution shells out to /bin/sh (`command -v`); on Windows that
// always fails and detection falls back to 'absolute' (fail-safe by design),
// so the relocatable-expecting tests are POSIX-only.
const skipSh = process.platform === 'win32';

/** Run with PATH pinned, restoring after — keeps detection hermetic: once the
 *  published package puts compressor-hook on the dev machine's PATH, tests
 *  relying on the ambient PATH would silently flip style. */
async function withPath(value: string, fn: () => void | Promise<void>): Promise<void> {
  const saved = process.env['PATH'];
  process.env['PATH'] = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) {
      delete process.env['PATH'];
    } else {
      process.env['PATH'] = saved;
    }
  }
}

/** An npm-installed layout: dist bundles, no src/. */
async function distOnlyRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-npm-root-'));
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'hook.js'), '// bundle\n', 'utf8');
  await writeFile(path.join(root, 'dist', 'copilot-hook.js'), '// bundle\n', 'utf8');
  return root;
}

/** A source checkout: src/cli/index.ts present (the dev-install heuristic). */
async function sourceCheckoutRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-src-root-'));
  await mkdir(path.join(root, 'src', 'cli'), { recursive: true });
  await writeFile(path.join(root, 'src', 'cli', 'index.ts'), '// cli\n', 'utf8');
  return root;
}

/** Directory with executable shims for the given bin names. */
async function shimDir(...names: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-shim-'));
  for (const name of names) {
    await writeFile(path.join(dir, name), '#!/bin/sh\nexit 0\n', {
      encoding: 'utf8',
      mode: 0o755,
    });
  }
  return dir;
}

/** PATH guaranteed to miss our bins. */
async function emptyPath(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'compressor-empty-path-'));
}

// Regression for the scope rename: packageRoot() identifies our package by the
// `compressor` bin, so '@astudioplus/compressor' (and any future scope) is found.
// Before this, isCompressorRoot hard-coded name === 'compressor' and every CLI
// command threw "could not locate the compressor package root" once published.
// The compressor-hook/compressor-copilot-hook bin entries must not break it.
test('isCompressorRoot matches the package by bin and scoped/unscoped name', async () => {
  const make = async (pkg: unknown): Promise<string> => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-root-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
    return root;
  };
  assert.equal(isCompressorRoot(await make({ name: '@astudioplus/compressor', bin: { compressor: 'dist/cli/index.js' } })), true);
  assert.equal(isCompressorRoot(await make({ name: 'compressor' })), true);
  assert.equal(isCompressorRoot(await make({ name: 'something-else', bin: { compressor: 'x.js' } })), true);
  // current bin map: extra hook-bundle bins alongside `compressor`
  assert.equal(
    isCompressorRoot(
      await make({
        name: '@astudioplus/compressor',
        bin: {
          compressor: 'dist/cli/index.js',
          'compressor-hook': 'dist/hook.js',
          'compressor-copilot-hook': 'dist/copilot-hook.js',
        },
      }),
    ),
    true,
  );
  assert.equal(isCompressorRoot(await make({ name: 'a-consumer-project', dependencies: { '@astudioplus/compressor': '^0.1.0' } })), false);
  const empty = await mkdtemp(path.join(os.tmpdir(), 'compressor-root-'));
  assert.equal(isCompressorRoot(empty), false);
});

test('resolveHookCommand refuses a root without dist/hook.js', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  await withPath(await emptyPath(), () => {
    assert.throws(
      () => resolveHookCommand('optimized', root),
      /npm run build/,
    );
  });
});

test('resolveHookCommand returns the node command when the bundle exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'hook.js'), '// bundle\n', 'utf8');
  await withPath(await emptyPath(), () => {
    assert.equal(
      resolveHookCommand('slim', root),
      `node "${path.join(root, 'dist', 'hook.js')}" --mode slim`,
    );
  });
});

test('describeHookCommand never requires the bundle (uninstall/status path)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  await withPath(await emptyPath(), () => {
    assert.equal(
      describeHookCommand('optimized', root),
      `node "${path.join(root, 'dist', 'hook.js')}" --mode optimized`,
    );
  });
});

test('hook command quotes the bundle path (roots containing spaces)', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  const root = path.join(base, 'dir with spaces');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'hook.js'), '// bundle\n', 'utf8');
  await withPath(await emptyPath(), () => {
    assert.equal(
      resolveHookCommand('optimized', root),
      `node "${path.join(root, 'dist', 'hook.js')}" --mode optimized`,
    );
  });
});

test('detectHookCommandStyle: source checkout → absolute, even with the bin on PATH', async () => {
  const root = await sourceCheckoutRoot();
  await withPath(await shimDir('compressor-hook'), () => {
    assert.equal(detectHookCommandStyle(root), 'absolute');
  });
});

test('detectHookCommandStyle: dist-only root + compressor-hook on PATH → relocatable', { skip: skipSh }, async () => {
  const root = await distOnlyRoot();
  await withPath(await shimDir('compressor-hook'), () => {
    assert.equal(detectHookCommandStyle(root), 'relocatable');
  });
});

test('detectHookCommandStyle: dist-only root without the bin on PATH → absolute (fail-safe)', async () => {
  const root = await distOnlyRoot();
  await withPath(await emptyPath(), () => {
    assert.equal(detectHookCommandStyle(root), 'absolute');
  });
});

test('relocatable command builders use the PATH bins, no paths embedded', async () => {
  const root = await distOnlyRoot();
  assert.equal(
    describeHookCommand('slim', root, 'relocatable'),
    'compressor-hook --mode slim',
  );
  assert.equal(
    describeCopilotHookCommand('optimized', root, 'relocatable'),
    'compressor-copilot-hook --mode optimized',
  );
});

test('default style flows through resolveHookCommand: dist-only + bin on PATH → relocatable command', { skip: skipSh }, async () => {
  const root = await distOnlyRoot();
  await withPath(await shimDir('compressor-hook'), () => {
    assert.equal(resolveHookCommand('slim', root), 'compressor-hook --mode slim');
  });
});

test('explicit relocatable: resolves via PATH (no local bundle needed), fails fast off PATH', { skip: skipSh }, async () => {
  // no dist/ at all — the PATH bin carries the bundle
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  await withPath(await shimDir('compressor-hook', 'compressor-copilot-hook'), () => {
    assert.equal(
      resolveHookCommand('slim', root, 'relocatable'),
      'compressor-hook --mode slim',
    );
    assert.equal(
      resolveCopilotHookCommand('slim', root, 'relocatable'),
      'compressor-copilot-hook --mode slim',
    );
  });
  await withPath(await emptyPath(), () => {
    assert.throws(
      () => resolveHookCommand('slim', root, 'relocatable'),
      /npm install -g @astudioplus\/compressor/,
    );
    assert.throws(
      () => resolveCopilotHookCommand('slim', root, 'relocatable'),
      /npm install -g @astudioplus\/compressor/,
    );
  });
});

test('resolveCopilotHookCommand relocatable checks ITS bin, not compressor-hook', { skip: skipSh }, async () => {
  const root = await distOnlyRoot();
  await withPath(await shimDir('compressor-hook'), () => {
    assert.throws(
      () => resolveCopilotHookCommand('slim', root, 'relocatable'),
      /'compressor-copilot-hook' does not resolve on PATH/,
    );
  });
});

test('copilotHookCommandFrom handles both forms (absolute bundle swap, relocatable bin swap)', () => {
  // absolute: sibling bundle name swapped, quoting and root preserved
  assert.equal(
    copilotHookCommandFrom('node "/opt/dir with spaces/dist/hook.js" --mode slim', 'optimized'),
    'node "/opt/dir with spaces/dist/copilot-hook.js" --mode optimized',
  );
  assert.equal(
    copilotHookCommandFrom('node "/opt/compressor/dist/hook.js" --mode slim'),
    'node "/opt/compressor/dist/copilot-hook.js"',
  );
  // relocatable: sibling bin name swapped
  assert.equal(
    copilotHookCommandFrom('compressor-hook --mode slim'),
    'compressor-copilot-hook',
  );
  assert.equal(
    copilotHookCommandFrom('compressor-hook --mode slim', 'slim'),
    'compressor-copilot-hook --mode slim',
  );
  assert.equal(
    copilotHookCommandFrom('compressor-hook --mode optimized', 'optimized'),
    'compressor-copilot-hook --mode optimized',
  );
});
