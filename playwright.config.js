module.exports = {
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  reporter: [['list']],
};
