module.exports = {
  apps: [
    {
      name: 'cjmarine-receipts-api',
      script: 'server/receipt-email-server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        RECEIPTS_PORT: process.env.RECEIPTS_PORT || 4001,
        RECEIPTS_ALLOWED_ORIGIN: process.env.RECEIPTS_ALLOWED_ORIGIN || '*',
        CJMARINE_RECEIPTS_EMAIL: process.env.CJMARINE_RECEIPTS_EMAIL || 'cjmarinepr@gmail.com',
        CJMARINE_RECEIPTS_NAME: process.env.CJMARINE_RECEIPTS_NAME || 'CJ Marine',
        CJMARINE_RECEIPTS_APP_PASSWORD: process.env.CJMARINE_RECEIPTS_APP_PASSWORD || ''
      }
    }
  ]
};
