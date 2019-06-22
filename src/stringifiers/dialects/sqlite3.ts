// @ts-ignore
function quote(str: string) {
  return `"${str}"`;
}

module.exports = {
  ...require('./mixins/pagination-not-supported'),

  name: 'sqlite3',

  quote,

  compositeKey(parent: string, keys: string[]) {
    keys = keys.map((key) => `${quote(parent)}.${quote(key)}`);
    return keys.join(' || ');
  },
};
