/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  transform: {},          // plain JS, no transform needed
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",   // resolves @/ path alias
  },
  collectCoverageFrom: [
    "src/server/**/*.js",
    "!src/server/adminDbConfig.js",   // pure config, no logic to test
  ],
  coverageThreshold: {
    global: {
      lines: 60,
    },
  },
};

module.exports = config;
