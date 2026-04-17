/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  transform: {
    "^.+\\.js$": ["babel-jest", {
      babelrc: false,
      configFile: false,
      presets: [["@babel/preset-env", { targets: { node: "current" } }]],
    }],
  },
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
