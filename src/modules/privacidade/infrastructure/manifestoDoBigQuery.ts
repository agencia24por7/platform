import type { EntradaDoManifesto } from '@/../scripts/bq/expurgo.mjs';
import ga4 from '@/../scripts/bq/manifesto/ga4.json';
import gbp from '@/../scripts/bq/manifesto/gbp.json';
import google from '@/../scripts/bq/manifesto/google.json';
import gtm from '@/../scripts/bq/manifesto/gtm.json';
import leadads from '@/../scripts/bq/manifesto/leadads.json';
import meta from '@/../scripts/bq/manifesto/meta.json';
import pixel from '@/../scripts/bq/manifesto/pixel.json';
import rdstation from '@/../scripts/bq/manifesto/rdstation.json';
import searchconsole from '@/../scripts/bq/manifesto/searchconsole.json';
import youtube from '@/../scripts/bq/manifesto/youtube.json';

export const MANIFESTO_DO_BIGQUERY: readonly EntradaDoManifesto[] = [
  ga4,
  gbp,
  google,
  gtm,
  leadads,
  meta,
  pixel,
  rdstation,
  searchconsole,
  youtube,
].flat() as EntradaDoManifesto[];
