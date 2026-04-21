const { createProxyMiddleware } = require('http-proxy-middleware');

const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const ensureAbsoluteSpinUrl = (value = '') => {
  const normalized = normalizeBaseUrl(value);

  if (!normalized) {
    return 'https://test.spinpos.net';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://${normalized}`;
};

module.exports = function setupProxy(app) {
  const target = ensureAbsoluteSpinUrl(process.env.REACT_APP_SPIN_API_URL);

  app.use(
    '/spin-proxy',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: true,
      pathRewrite: {
        '^/spin-proxy': '/SPIn/cgi.html'
      },
      onProxyReq(proxyReq) {
        proxyReq.setHeader('Accept', 'application/xml, text/xml, text/plain, */*');
      }
    })
  );
};
