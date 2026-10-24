import base from './playwright.prototype.config';
export default { ...base, use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } } };
