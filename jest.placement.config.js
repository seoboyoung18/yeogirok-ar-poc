// Pure placement tests need no React Native runtime or native Viro mocks.
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/placement.test.ts',
    '<rootDir>/__tests__/geospatial.test.ts',
    '<rootDir>/__tests__/cloudAnchors.test.ts',
    '<rootDir>/__tests__/localTips.test.ts',
  ],
  transform: { '^.+\\.tsx?$': 'babel-jest' },
};
