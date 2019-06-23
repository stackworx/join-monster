import knexBasic from '../test-api/schema-basic/database.ts';
import knexPaginated from '../test-api/schema-paginated/database.ts';

module.exports = async function testTeardown() {
  await knexBasic.destroy();
  await knexPaginated.destroy();
};
