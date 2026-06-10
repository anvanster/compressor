function defineCommand(def) {
  if (typeof def.name !== 'string' || !def.name.includes(':')) {
    throw new TypeError('command name must look like group:verb');
  }
  return Object.freeze({ aliases: [], options: [], ...def });
}

export const commands = [
  defineCommand({
    name: 'cache:list',
    group: 'cache',
    summary: 'List cache entries tracked by the workspace',
    aliases: ['cache:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing cache entries' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of cache entries printed' },
    ],
    handler(ctx, args) {
      ctx.log('cache:list', args);
      return { ok: true, command: 'cache:list' };
    },
  }),
  defineCommand({
    name: 'cache:show',
    group: 'cache',
    summary: 'Show one record from the cache entries',
    aliases: ['cache:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the cache record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the cache record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('cache:show', args);
      return { ok: true, command: 'cache:show' };
    },
  }),
  defineCommand({
    name: 'cache:create',
    group: 'cache',
    summary: 'Create a new entry among the cache entries',
    aliases: ['cache:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new cache record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new cache record' },
    ],
    handler(ctx, args) {
      ctx.log('cache:create', args);
      return { ok: true, command: 'cache:create' };
    },
  }),
  defineCommand({
    name: 'cache:delete',
    group: 'cache',
    summary: 'Delete one entry from the cache entries',
    aliases: ['cache:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the cache record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting cache entries' },
    ],
    handler(ctx, args) {
      ctx.log('cache:delete', args);
      return { ok: true, command: 'cache:delete' };
    },
  }),
  defineCommand({
    name: 'cache:sync',
    group: 'cache',
    summary: 'Synchronise cache entries with the configured remote',
    aliases: ['cache:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync cache entries' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing cache entries' },
    ],
    handler(ctx, args) {
      ctx.log('cache:sync', args);
      return { ok: true, command: 'cache:sync' };
    },
  }),
  defineCommand({
    name: 'cache:prune',
    group: 'cache',
    summary: 'Prune stale entries from the cache entries',
    aliases: ['cache:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of cache entries to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning cache entries would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('cache:prune', args);
      return { ok: true, command: 'cache:prune' };
    },
  }),
  defineCommand({
    name: 'db:list',
    group: 'db',
    summary: 'List database migrations tracked by the workspace',
    aliases: ['db:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing database migrations' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of database migrations printed' },
    ],
    handler(ctx, args) {
      ctx.log('db:list', args);
      return { ok: true, command: 'db:list' };
    },
  }),
  defineCommand({
    name: 'db:show',
    group: 'db',
    summary: 'Show one record from the database migrations',
    aliases: ['db:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the db record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the db record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('db:show', args);
      return { ok: true, command: 'db:show' };
    },
  }),
  defineCommand({
    name: 'db:create',
    group: 'db',
    summary: 'Create a new entry among the database migrations',
    aliases: ['db:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new db record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new db record' },
    ],
    handler(ctx, args) {
      ctx.log('db:create', args);
      return { ok: true, command: 'db:create' };
    },
  }),
  defineCommand({
    name: 'db:delete',
    group: 'db',
    summary: 'Delete one entry from the database migrations',
    aliases: ['db:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the db record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting database migrations' },
    ],
    handler(ctx, args) {
      ctx.log('db:delete', args);
      return { ok: true, command: 'db:delete' };
    },
  }),
  defineCommand({
    name: 'db:sync',
    group: 'db',
    summary: 'Synchronise database migrations with the configured remote',
    aliases: ['db:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync database migrations' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing database migrations' },
    ],
    handler(ctx, args) {
      ctx.log('db:sync', args);
      return { ok: true, command: 'db:sync' };
    },
  }),
  defineCommand({
    name: 'db:prune',
    group: 'db',
    summary: 'Prune stale entries from the database migrations',
    aliases: ['db:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of database migrations to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning database migrations would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('db:prune', args);
      return { ok: true, command: 'db:prune' };
    },
  }),
  defineCommand({
    name: 'auth:list',
    group: 'auth',
    summary: 'List authentication sessions tracked by the workspace',
    aliases: ['auth:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing authentication sessions' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of authentication sessions printed' },
    ],
    handler(ctx, args) {
      ctx.log('auth:list', args);
      return { ok: true, command: 'auth:list' };
    },
  }),
  defineCommand({
    name: 'auth:show',
    group: 'auth',
    summary: 'Show one record from the authentication sessions',
    aliases: ['auth:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the auth record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the auth record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('auth:show', args);
      return { ok: true, command: 'auth:show' };
    },
  }),
  defineCommand({
    name: 'auth:create',
    group: 'auth',
    summary: 'Create a new entry among the authentication sessions',
    aliases: ['auth:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new auth record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new auth record' },
    ],
    handler(ctx, args) {
      ctx.log('auth:create', args);
      return { ok: true, command: 'auth:create' };
    },
  }),
  defineCommand({
    name: 'auth:delete',
    group: 'auth',
    summary: 'Delete one entry from the authentication sessions',
    aliases: ['auth:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the auth record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting authentication sessions' },
    ],
    handler(ctx, args) {
      ctx.log('auth:delete', args);
      return { ok: true, command: 'auth:delete' };
    },
  }),
  defineCommand({
    name: 'auth:sync',
    group: 'auth',
    summary: 'Synchronise authentication sessions with the configured remote',
    aliases: ['auth:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync authentication sessions' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing authentication sessions' },
    ],
    handler(ctx, args) {
      ctx.log('auth:sync', args);
      return { ok: true, command: 'auth:sync' };
    },
  }),
  defineCommand({
    name: 'auth:prune',
    group: 'auth',
    summary: 'Prune stale entries from the authentication sessions',
    aliases: ['auth:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of authentication sessions to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning authentication sessions would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('auth:prune', args);
      return { ok: true, command: 'auth:prune' };
    },
  }),
  defineCommand({
    name: 'snapshot:list',
    group: 'snapshot',
    summary: 'List snapshot history tracked by the workspace',
    aliases: ['snapshot:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing snapshot history' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of snapshot history printed' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:list', args);
      return { ok: true, command: 'snapshot:list' };
    },
  }),
  defineCommand({
    name: 'snapshot:show',
    group: 'snapshot',
    summary: 'Show one record from the snapshot history',
    aliases: ['snapshot:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the snapshot record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the snapshot record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:show', args);
      return { ok: true, command: 'snapshot:show' };
    },
  }),
  defineCommand({
    name: 'snapshot:create',
    group: 'snapshot',
    summary: 'Create a new entry among the snapshot history',
    aliases: ['snapshot:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new snapshot record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new snapshot record' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:create', args);
      return { ok: true, command: 'snapshot:create' };
    },
  }),
  defineCommand({
    name: 'snapshot:delete',
    group: 'snapshot',
    summary: 'Delete one entry from the snapshot history',
    aliases: ['snapshot:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the snapshot record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting snapshot history' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:delete', args);
      return { ok: true, command: 'snapshot:delete' };
    },
  }),
  defineCommand({
    name: 'snapshot:sync',
    group: 'snapshot',
    summary: 'Synchronise snapshot history with the configured remote',
    aliases: ['snapshot:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync snapshot history' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing snapshot history' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:sync', args);
      return { ok: true, command: 'snapshot:sync' };
    },
  }),
  defineCommand({
    name: 'snapshot:prune',
    group: 'snapshot',
    summary: 'Prune stale entries from the snapshot history',
    aliases: ['snapshot:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of snapshot history to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning snapshot history would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('snapshot:prune', args);
      return { ok: true, command: 'snapshot:prune' };
    },
  }),
  defineCommand({
    name: 'queue:list',
    group: 'queue',
    summary: 'List queued jobs tracked by the workspace',
    aliases: ['queue:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing queued jobs' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of queued jobs printed' },
    ],
    handler(ctx, args) {
      ctx.log('queue:list', args);
      return { ok: true, command: 'queue:list' };
    },
  }),
  defineCommand({
    name: 'queue:show',
    group: 'queue',
    summary: 'Show one record from the queued jobs',
    aliases: ['queue:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the queue record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the queue record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('queue:show', args);
      return { ok: true, command: 'queue:show' };
    },
  }),
  defineCommand({
    name: 'queue:create',
    group: 'queue',
    summary: 'Create a new entry among the queued jobs',
    aliases: ['queue:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new queue record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new queue record' },
    ],
    handler(ctx, args) {
      ctx.log('queue:create', args);
      return { ok: true, command: 'queue:create' };
    },
  }),
  defineCommand({
    name: 'queue:delete',
    group: 'queue',
    summary: 'Delete one entry from the queued jobs',
    aliases: ['queue:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the queue record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting queued jobs' },
    ],
    handler(ctx, args) {
      ctx.log('queue:delete', args);
      return { ok: true, command: 'queue:delete' };
    },
  }),
  defineCommand({
    name: 'queue:sync',
    group: 'queue',
    summary: 'Synchronise queued jobs with the configured remote',
    aliases: ['queue:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync queued jobs' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing queued jobs' },
    ],
    handler(ctx, args) {
      ctx.log('queue:sync', args);
      return { ok: true, command: 'queue:sync' };
    },
  }),
  defineCommand({
    name: 'queue:prune',
    group: 'queue',
    summary: 'Prune stale entries from the queued jobs',
    aliases: ['queue:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of queued jobs to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning queued jobs would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('queue:prune', args);
      return { ok: true, command: 'queue:prune' };
    },
  }),
  defineCommand({
    name: 'config:list',
    group: 'config',
    summary: 'List configuration values tracked by the workspace',
    aliases: ['config:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing configuration values' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of configuration values printed' },
    ],
    handler(ctx, args) {
      ctx.log('config:list', args);
      return { ok: true, command: 'config:list' };
    },
  }),
  defineCommand({
    name: 'config:show',
    group: 'config',
    summary: 'Show one record from the configuration values',
    aliases: ['config:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the config record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the config record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('config:show', args);
      return { ok: true, command: 'config:show' };
    },
  }),
  defineCommand({
    name: 'config:create',
    group: 'config',
    summary: 'Create a new entry among the configuration values',
    aliases: ['config:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new config record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new config record' },
    ],
    handler(ctx, args) {
      ctx.log('config:create', args);
      return { ok: true, command: 'config:create' };
    },
  }),
  defineCommand({
    name: 'config:delete',
    group: 'config',
    summary: 'Delete one entry from the configuration values',
    aliases: ['config:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the config record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting configuration values' },
    ],
    handler(ctx, args) {
      ctx.log('config:delete', args);
      return { ok: true, command: 'config:delete' };
    },
  }),
  defineCommand({
    name: 'config:sync',
    group: 'config',
    summary: 'Synchronise configuration values with the configured remote',
    aliases: ['config:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync configuration values' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing configuration values' },
    ],
    handler(ctx, args) {
      ctx.log('config:sync', args);
      return { ok: true, command: 'config:sync' };
    },
  }),
  defineCommand({
    name: 'config:prune',
    group: 'config',
    summary: 'Prune stale entries from the configuration values',
    aliases: ['config:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of configuration values to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning configuration values would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('config:prune', args);
      return { ok: true, command: 'config:prune' };
    },
  }),
  defineCommand({
    name: 'net:list',
    group: 'net',
    summary: 'List network peers tracked by the workspace',
    aliases: ['net:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing network peers' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of network peers printed' },
    ],
    handler(ctx, args) {
      ctx.log('net:list', args);
      return { ok: true, command: 'net:list' };
    },
  }),
  defineCommand({
    name: 'net:show',
    group: 'net',
    summary: 'Show one record from the network peers',
    aliases: ['net:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the net record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the net record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('net:show', args);
      return { ok: true, command: 'net:show' };
    },
  }),
  defineCommand({
    name: 'net:create',
    group: 'net',
    summary: 'Create a new entry among the network peers',
    aliases: ['net:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new net record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new net record' },
    ],
    handler(ctx, args) {
      ctx.log('net:create', args);
      return { ok: true, command: 'net:create' };
    },
  }),
  defineCommand({
    name: 'net:delete',
    group: 'net',
    summary: 'Delete one entry from the network peers',
    aliases: ['net:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the net record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting network peers' },
    ],
    handler(ctx, args) {
      ctx.log('net:delete', args);
      return { ok: true, command: 'net:delete' };
    },
  }),
  defineCommand({
    name: 'net:sync',
    group: 'net',
    summary: 'Synchronise network peers with the configured remote',
    aliases: ['net:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync network peers' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing network peers' },
    ],
    handler(ctx, args) {
      ctx.log('net:sync', args);
      return { ok: true, command: 'net:sync' };
    },
  }),
  defineCommand({
    name: 'net:prune',
    group: 'net',
    summary: 'Prune stale entries from the network peers',
    aliases: ['net:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of network peers to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning network peers would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('net:prune', args);
      return { ok: true, command: 'net:prune' };
    },
  }),
  defineCommand({
    name: 'fs:list',
    group: 'fs',
    summary: 'List workspace files tracked by the workspace',
    aliases: ['fs:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing workspace files' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of workspace files printed' },
    ],
    handler(ctx, args) {
      ctx.log('fs:list', args);
      return { ok: true, command: 'fs:list' };
    },
  }),
  defineCommand({
    name: 'fs:show',
    group: 'fs',
    summary: 'Show one record from the workspace files',
    aliases: ['fs:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the fs record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the fs record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('fs:show', args);
      return { ok: true, command: 'fs:show' };
    },
  }),
  defineCommand({
    name: 'fs:create',
    group: 'fs',
    summary: 'Create a new entry among the workspace files',
    aliases: ['fs:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new fs record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new fs record' },
    ],
    handler(ctx, args) {
      ctx.log('fs:create', args);
      return { ok: true, command: 'fs:create' };
    },
  }),
  defineCommand({
    name: 'fs:delete',
    group: 'fs',
    summary: 'Delete one entry from the workspace files',
    aliases: ['fs:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the fs record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting workspace files' },
    ],
    handler(ctx, args) {
      ctx.log('fs:delete', args);
      return { ok: true, command: 'fs:delete' };
    },
  }),
  defineCommand({
    name: 'fs:sync',
    group: 'fs',
    summary: 'Synchronise workspace files with the configured remote',
    aliases: ['fs:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync workspace files' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing workspace files' },
    ],
    handler(ctx, args) {
      ctx.log('fs:sync', args);
      return { ok: true, command: 'fs:sync' };
    },
  }),
  defineCommand({
    name: 'fs:prune',
    group: 'fs',
    summary: 'Prune stale entries from the workspace files',
    aliases: ['fs:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of workspace files to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning workspace files would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('fs:prune', args);
      return { ok: true, command: 'fs:prune' };
    },
  }),
  defineCommand({
    name: 'log:list',
    group: 'log',
    summary: 'List log streams tracked by the workspace',
    aliases: ['log:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing log streams' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of log streams printed' },
    ],
    handler(ctx, args) {
      ctx.log('log:list', args);
      return { ok: true, command: 'log:list' };
    },
  }),
  defineCommand({
    name: 'log:show',
    group: 'log',
    summary: 'Show one record from the log streams',
    aliases: ['log:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the log record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the log record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('log:show', args);
      return { ok: true, command: 'log:show' };
    },
  }),
  defineCommand({
    name: 'log:create',
    group: 'log',
    summary: 'Create a new entry among the log streams',
    aliases: ['log:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new log record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new log record' },
    ],
    handler(ctx, args) {
      ctx.log('log:create', args);
      return { ok: true, command: 'log:create' };
    },
  }),
  defineCommand({
    name: 'log:delete',
    group: 'log',
    summary: 'Delete one entry from the log streams',
    aliases: ['log:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the log record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting log streams' },
    ],
    handler(ctx, args) {
      ctx.log('log:delete', args);
      return { ok: true, command: 'log:delete' };
    },
  }),
  defineCommand({
    name: 'log:sync',
    group: 'log',
    summary: 'Synchronise log streams with the configured remote',
    aliases: ['log:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync log streams' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing log streams' },
    ],
    handler(ctx, args) {
      ctx.log('log:sync', args);
      return { ok: true, command: 'log:sync' };
    },
  }),
  defineCommand({
    name: 'log:prune',
    group: 'log',
    summary: 'Prune stale entries from the log streams',
    aliases: ['log:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of log streams to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning log streams would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('log:prune', args);
      return { ok: true, command: 'log:prune' };
    },
  }),
  defineCommand({
    name: 'user:list',
    group: 'user',
    summary: 'List user accounts tracked by the workspace',
    aliases: ['user:ls'],
    options: [
      { name: 'format', flag: '--format <kind>', kind: 'string', default: 'table', summary: 'Output format used when listing user accounts' },
      { name: 'limit', flag: '--limit <n>', kind: 'number', default: 50, summary: 'Maximum number of user accounts printed' },
    ],
    handler(ctx, args) {
      ctx.log('user:list', args);
      return { ok: true, command: 'user:list' };
    },
  }),
  defineCommand({
    name: 'user:show',
    group: 'user',
    summary: 'Show one record from the user accounts',
    aliases: ['user:info'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the user record to show' },
      { name: 'json', flag: '--json', kind: 'boolean', default: false, summary: 'Emit the user record as JSON' },
    ],
    handler(ctx, args) {
      ctx.log('user:show', args);
      return { ok: true, command: 'user:show' };
    },
  }),
  defineCommand({
    name: 'user:create',
    group: 'user',
    summary: 'Create a new entry among the user accounts',
    aliases: ['user:new'],
    options: [
      { name: 'name', flag: '--name <name>', kind: 'string', default: null, summary: 'Name for the new user record' },
      { name: 'labels', flag: '--labels <csv>', kind: 'string', default: '', summary: 'Comma-separated labels for the new user record' },
    ],
    handler(ctx, args) {
      ctx.log('user:create', args);
      return { ok: true, command: 'user:create' };
    },
  }),
  defineCommand({
    name: 'user:delete',
    group: 'user',
    summary: 'Delete one entry from the user accounts',
    aliases: ['user:rm'],
    options: [
      { name: 'id', flag: '--id <id>', kind: 'string', default: null, summary: 'Identifier of the user record to delete' },
      { name: 'force', flag: '--force', kind: 'boolean', default: false, summary: 'Skip the confirmation prompt when deleting user accounts' },
    ],
    handler(ctx, args) {
      ctx.log('user:delete', args);
      return { ok: true, command: 'user:delete' };
    },
  }),
  defineCommand({
    name: 'user:sync',
    group: 'user',
    summary: 'Synchronise user accounts with the configured remote',
    aliases: ['user:pull'],
    options: [
      { name: 'remote', flag: '--remote <name>', kind: 'string', default: 'origin', summary: 'Remote used to sync user accounts' },
      { name: 'timeout', flag: '--timeout <s>', kind: 'number', default: 30, summary: 'Seconds to wait while syncing user accounts' },
    ],
    handler(ctx, args) {
      ctx.log('user:sync', args);
      return { ok: true, command: 'user:sync' };
    },
  }),
  defineCommand({
    name: 'user:prune',
    group: 'user',
    summary: 'Prune stale entries from the user accounts',
    aliases: ['user:gc'],
    options: [
      { name: 'keep', flag: '--keep <days>', kind: 'number', default: 7, summary: 'Days of user accounts to retain' },
      { name: 'dryRun', flag: '--dry-run', kind: 'boolean', default: false, summary: 'Report what pruning user accounts would remove without removing it' },
    ],
    handler(ctx, args) {
      ctx.log('user:prune', args);
      return { ok: true, command: 'user:prune' };
    },
  }),
];

export function getCommand(name) {
  return commands.find((cmd) => cmd.name === name || cmd.aliases.includes(name)) ?? null;
}

export function commandsInGroup(group) {
  return commands.filter((cmd) => cmd.group === group);
}

export function groups() {
  return [...new Set(commands.map((cmd) => cmd.group))];
}

export function defaultsFor(cmd) {
  const out = {};
  for (const option of cmd.options) {
    if (option.default !== null) {
      out[option.name] = option.default;
    }
  }
  return out;
}

export function runCommand(name, ctx, args = {}) {
  const cmd = getCommand(name);
  if (cmd === null) {
    throw new Error(`unknown command: ${name}`);
  }
  for (const option of cmd.options) {
    const value = args[option.name];
    if (value === undefined) {
      continue;
    }
    if (option.kind === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`option ${option.flag} expects a number`);
    }
    if (option.kind === 'boolean' && typeof value !== 'boolean') {
      throw new TypeError(`option ${option.flag} expects a boolean`);
    }
  }
  return cmd.handler(ctx, { ...defaultsFor(cmd), ...args });
}
