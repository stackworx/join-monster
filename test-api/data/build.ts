import test1 from './setup/test1';
import test2 from './setup/test2';
import demo from './setup/demo';

(async () => {
  //console.log('building oracle')
  //await test1('oracle')
  //await test2('oracle')

  console.log('building sqlite3');
  await test1('sqlite3');
  await test2('sqlite3');

  console.log('building mysql');
  await test1('mysql');
  await test2('mysql');

  console.log('building postgres');
  await test1('pg');
  await test2('pg');
  await demo('pg');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
