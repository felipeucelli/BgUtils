const path = require('path');

module.exports = {
  entry: './index.js',
  output: {
    filename: 'botGuard.js',
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'umd',
  },
  mode: 'production',
  target: 'node',
};
