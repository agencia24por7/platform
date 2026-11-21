import { register } from 'node:module';

register('../../src/shared/testing/aliasHooks.mjs', import.meta.url);
register('./ganchosDoNext.mjs', import.meta.url);
