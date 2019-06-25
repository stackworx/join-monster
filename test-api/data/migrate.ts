import Knex, {TableBuilder} from 'knex';

export default async function migrate(db: string, knex: Knex) {
  function createdAt(table: TableBuilder) {
    const now =
      db === 'mysql' ? knex.raw('CURRENT_TIMESTAMP(3)') : knex.fn.now();

    table.dateTime('created_at', {precision: 3}).defaultTo(now);
  }

  await knex.schema.dropTableIfExists('accounts');
  await knex.schema.createTable('accounts', (table) => {
    table.increments().primary();
    table.string('email_address', 150);
    table.string('first_name', 255);
    table.string('last_name', 255);
    table.integer('num_legs').defaultTo(2);
    createdAt(table);
  });

  await knex.schema.dropTableIfExists('comments');
  await knex.schema.createTable('comments', (table) => {
    table.increments().primary();
    table.text('body');
    table.integer('post_id').notNullable();
    table.integer('author_id').notNullable();
    table.boolean('archived').defaultTo(false);
    createdAt(table);
  });

  await knex.schema.dropTableIfExists('posts');
  await knex.schema.createTable('posts', (table) => {
    table.increments().primary();
    table.text('body');
    table.integer('author_id').notNullable();
    table.boolean('archived').defaultTo(false);
    createdAt(table);
  });

  await knex.schema.dropTableIfExists('relationships');
  await knex.schema.createTable('relationships', (table) => {
    table.integer('follower_id').notNullable();
    table.integer('followee_id').notNullable();
    table.string('closeness', 255);
    createdAt(table);
  });

  await knex.schema.dropTableIfExists('likes');
  await knex.schema.createTable('likes', (table) => {
    table.integer('account_id').notNullable();
    table.integer('comment_id').notNullable();
    createdAt(table);

    // TODO add unique constraint
    // UNIQUE (account_id, comment_id)
  });

  await knex.schema.dropTableIfExists('sponsors');
  await knex.schema.createTable('sponsors', (table) => {
    table.integer('generation').notNullable();
    table.string('first_name', 255);
    table.string('last_name', 255);
    table.integer('num_legs').defaultTo(2);
    createdAt(table);
  });
}
