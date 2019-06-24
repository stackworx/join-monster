import {DialectModule} from './stringifiers/types';

export type Dialect = 'pg' | 'oracle' | 'mariadb' | 'mysql' | 'sqlite3';
export type JoinMonsterOptions = {
  minify: boolean;
  dialect: Dialect;
  dialectModule: DialectModule;
};
