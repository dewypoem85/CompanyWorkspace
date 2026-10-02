export {};
process.env.DEMO_MODE='true';
process.env.COOKIE_SECURE='false';
process.env.APP_ORIGIN='http://localhost:4180';
await import('../src/server/index.js');
