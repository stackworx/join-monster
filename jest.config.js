// Ensure we can import ts in testTeardown
require('@babel/register')({
  extensions: ['.js', '.ts'],
});

module.exports = {
  globalTeardown: '<rootDir>/test/testTeardown.js',
};
