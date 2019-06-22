import knex from '../test-api/schema-basic/database';

module.exports = async function testTeardown() {
  await knex.destroy();
};
