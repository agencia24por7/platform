export const PG_CONTAINER =
  process.env.TRIA_TEST_PG ?? process.env.ORLA_PG_CONTAINER ?? process.env.PG_CONTAINER ?? 'orla-postgres';
